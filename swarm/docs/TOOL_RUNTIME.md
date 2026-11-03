# SWARM - Tool Runtime

**Version:** 0.1
**Status:** Implemented; native tools covered by tests, external tools unverified live
**Last updated:** 2026-10-31
**Related:** [Architecture](ARCHITECTURE.md), [Agent Specifications](AGENT_SPECIFICATIONS.md), [MCP Integration](MCP_INTEGRATION.md), [Extension Platform](EXTENSION_PLATFORM.md), [Security](SECURITY_AND_PERMISSIONS.md)

---

## 1. Purpose

The tool runtime is how SWARM moves from generating text to performing work. It provides a
single execution path for native tools, MCP tools, and declarative extension tools, with
backend-enforced policy, durable approvals, timeouts, idempotency, and audit records.

The design invariants are:

1. **The model can propose, not permit.** A model can only emit a tool call. The backend
   resolves the tool, evaluates policy, and decides whether to run it.
2. **Every attempt is recorded.** Allowed, denied, failed, timed-out, and approval-gated calls
   create a `tool_executions` row.
3. **Approval is durable state.** A gated call suspends the task and resumes from persisted
   runtime state. It is not an in-memory callback or a prompt instruction.
4. **No arbitrary execution surface.** SWARM has no shell, filesystem-write, process-spawn, or
   arbitrary-code tool. Those names are denied even if a future tool accidentally registers them.
5. **Credentials stay server-side.** Tool context exposes an integration-secret accessor only
   inside the worker process. No secret is written to a prompt or returned by the API.
6. **Failure is visible.** A tool error is returned to the model as an error. The agent is told
   not to claim success, and the run trace records the failure.

## 2. Tool contract

Every tool, regardless of source, implements `SwarmTool` in
`packages/core/src/tools/types.ts`:

```ts
interface SwarmTool {
  name: string;                       // 1-64 chars, [a-zA-Z0-9_-]
  description: string;                // shown to the model
  inputSchema: JsonSchema;            // JSON Schema shown to the model
  risk: "read" | "internal_write" | "external" | "purchase" | "destructive";
  requiresApproval: boolean;          // tool-declared gate
  source: "native" | "mcp" | "extension";
  readOnlyHint?: boolean;
  isWrite?: boolean;
  execute(input, context): Promise<ToolResult>;
}
```

`ToolResult` contains `content` (what the model sees) and optional structured `data`
(what is persisted as the execution output).

`ToolContext` supplies the store, config, workspace/run/task/agent identifiers, domain pack,
an `AbortSignal`, an optional idempotency key, and two integration accessors:

```ts
getIntegrationSecret(provider: string): string | null
getIntegrationConfig(provider: string): Record<string, unknown> | null
```

The accessors decrypt secrets on demand. Tools never receive the encryption key.

`ToolRegistry` rejects invalid or duplicate names. Its `filter()` method applies an agent's
native allowlist; the agent loop separately adds every non-native tool to the candidate set.

## 3. Registry composition

For each task, `SwarmEngine.registryFor(workspaceId)` builds a fresh registry:

1. all native tools;
2. extension tools loaded at process startup;
3. MCP tools persisted for the workspace.

The agent loop then filters native tools by `AgentDefinition.allowedTools`. MCP and extension
tools are made available to every agent, but policy still treats them as external and gates
them. This lets a user connect a new integration without editing every domain pack while keeping
the "external actions require approval" boundary.

Names are stable and namespaced:

| Source | Form | Example |
| --- | --- | --- |
| Native | fixed name | `web_fetch` |
| MCP | `mcp_<server_slug>_<tool>` (max 64) | `mcp_linear_create_issue` |
| Extension | `ext_<manifest_id>_<tool>` (max 64) | `ext_notion_search` |

MCP name collisions get a short server-id suffix; extension collisions get a numeric suffix.

## 4. Native tool catalogue

Native tools live in `packages/core/src/tools/` and are registered by
`createNativeToolRegistry()`.

| Tool | Risk | Approval | Purpose |
| --- | --- | --- | --- |
| `artifact_write` | `internal_write` | No | Save a supporting document to the workspace (max 400,000 chars). |
| `workspace_memory_search` | `read` | No | Keyword search over durable workspace memory. |
| `workspace_memory_write` | `internal_write` | No | Upsert a reusable fact/decision (max 20,000 chars). |
| `web_fetch` | `read` | No | Fetch a public page/document as text, subject to SSRF and size limits. |
| `http_request` | `external` | Dynamic | Public API request. GET/HEAD are reads; POST/PUT/PATCH/DELETE are writes. |
| `github_get_repo` | `read` | No | Read public repository metadata; optional integration token raises rate limits. |
| `github_create_issue` | `external` | Yes | Create an issue; requires a connected GitHub token. |
| `telegraph_discover` | `read` | No | List Telegraph miners and intents. |
| `telegraph_quote` | `read` | No | Request x402 payment terms without paying. |
| `telegraph_purchase` | `purchase` | Yes, always | Buy one Telegraph answer with x402, with a price ceiling. |
| `telegraph_signal` | `read` | No | Look up a Telegraph signal by hash. |

`http_request` is declared `external` and `isWrite: true`, but the runtime recomputes its risk
from the actual method. A GET is treated as a read; a POST is a write. This prevents an agent
from bypassing the external-write setting by choosing a different HTTP verb.

The runtime passes JSON Schema to the model, but it does not run a generic JSON Schema
validator before calling `execute()`. Each native tool validates its required fields and bounds
at execution. MCP arguments are forwarded to the MCP server, and extension arguments are mapped
by the loader. A generic validator is a worthwhile hardening step, not a current guarantee.

## 5. Execution lifecycle

For a model response containing one or more tool calls:

1. **Resolve.** The agent loop looks up the call name in the task registry. Unknown names are
   returned to the model as unavailable tools.
2. **Recompute risk.** `http_request` uses the actual method; all other tools use declared risk.
3. **Policy.** `decideToolPolicy()` receives tool name, risk, declared approval, source,
   read-only/write hints, domain pack, and workspace policy. It returns `allow`, `approval`, or
   `deny`.
4. **Idempotency.** For non-read calls, the runtime hashes `{taskId, callId, tool, input}`.
   If a prior execution exists:
   - `succeeded`: its stored output is replayed to the model and the action is not repeated;
   - any other status: the model is told the prior attempt was not repeated automatically.
5. **Deny.** The runtime records a `denied` execution with the policy reason, returns a tool
   message, and continues the loop.
6. **Approval.** The runtime creates an `awaiting_approval` execution and a pending approval,
   marks task/run/agent as awaiting approval, persists the remaining calls and loop state, and
   returns from the worker job.
7. **Execute.** Allowed calls create a `running` execution and invoke `execute()` under a global
   timeout and cancellation signal.
8. **Record.** Success stores structured output, duration, and a `tool_completed` run event.
   Failure stores the error and status `failed` or `timeout`.
9. **Return.** The model receives `result.content` (truncated to 30,000 characters) or a clear
   error message and must adapt.

Multiple tool calls in one model response are processed in order. If one requires approval,
the remaining calls wait in the persisted runtime state so ordering is preserved.

## 6. Policy matrix

Policy is implemented in `packages/core/src/security/policy.ts`. The evaluation order matters:

1. Names in `ALWAYS_DENIED` (`bash`, `shell`, `exec`, `code_exec`, `file_write`,
   `filesystem_write`, `process_spawn`) are denied.
2. Health workflows deny `purchase` and `destructive` risks.
3. `purchase` and `destructive` always require approval.
4. A tool that declares `requiresApproval` requires approval.
5. `read` and `internal_write` are allowed (subject to prior checks).
6. MCP tools are allowed only when the server marked them read-only **and** the workspace
   opted into `autoApproveReadOnlyMcp`; otherwise they require approval.
7. Extension tools always require approval.
8. `http_request` writes are denied when `allowExternalHttpWrites` is false; when true they
   require approval.
9. All remaining external actions require approval.

| Case | Result |
| --- | --- |
| `artifact_write`, memory write | Allow |
| `web_fetch`, `http_request` GET/HEAD | Allow |
| `http_request` POST/PUT/PATCH/DELETE, external writes disabled | Deny |
| `http_request` write, external writes enabled | Approval |
| `github_create_issue` | Approval |
| `telegraph_purchase` | Approval (always) |
| Telegraph purchase in health workflow | Deny |
| Any extension call | Approval (always) |
| MCP read-only, auto-approval off (default) | Approval |
| MCP read-only, auto-approval on | Allow |
| MCP write/unknown annotations | Approval |
| Unknown/destructive tool | Approval or deny per rules |

Workspace defaults are conservative:

```json
{
  "autoApproveReadOnlyMcp": false,
  "allowExternalHttpWrites": false
}
```

## 7. Approval state and resume

On an approval decision, the engine:

1. marks the approval `approved`, `denied`, or `expired`;
2. updates the tool execution (`requested` for approval, `denied` for denial);
3. returns the task to `running`, the run to `executing`, and the agent to `working`;
4. enqueues `resume_task` with an idempotency key derived from the approval.

On approval, the runtime resumes the same pending call once. If the execution already
succeeded, the stored result is replayed instead of repeating the action. On denial or expiry,
it marks the execution `denied`/`timeout`, injects a tool error, and lets the agent adapt.

Approvals expire 24 hours after creation. The worker expires overdue approvals at startup and
sweeps again every 30 seconds while running. Expiry is treated as a denial with a timeout
reason, so a task does not remain suspended indefinitely.

The approval payload stores a redacted copy of the arguments. The underlying tool execution
stores the arguments in the database; API projections redact them again before serialization.

## 8. Timeouts, cancellation, retries, and budgets

| Control | Behavior |
| --- | --- |
| Global tool timeout | `SWARM_TOOL_TIMEOUT_MS`, default 60,000 ms. Applies to every tool call. |
| Web fetch timeout | 20,000 ms internally; also capped by the global timeout. |
| `http_request` timeout | Caller may request 1,000-60,000 ms; capped by the global timeout. |
| Telegraph purchase timeout | Inner 90,000 ms, but effectively capped by the global tool timeout. |
| Extension timeout | Manifest value 1,000-60,000 ms; capped by the global timeout. |
| Cancellation | The run's abort signal and cancellation flag stop calls; tools receive an `AbortSignal`. |
| Tool retry | No automatic per-call retry. The model may retry, and task/job retry may replay work. |
| Idempotency | Write-like calls are keyed by content hash; replays do not repeat a successful action. |
| Turn limit | `max(2, min(agent.maxSteps, SWARM_MAX_TOOL_STEPS))` model turns per task. |
| Tool-call limit | Three tool calls per allowed turn; exceeding it fails the task/run. |
| Run budgets | Model calls, tokens, wall-clock time, task attempts, and tool calls are bounded. |

Run timeout is checked before each model call. A long-running tool may finish after the run's
wall-clock budget has elapsed; the next model call will then fail the run. This is a known
granularity limit, not an unlimited budget.

## 9. Errors and result handling

Tools throw `ToolError(message, code)` for expected failures. The runtime maps:

| Condition | Execution status | Model message |
| --- | --- | --- |
| Policy denied | `denied` | "denied by policy: reason" |
| Approval denied | `denied` | "not executed: approval denied" |
| Approval expired | `timeout` | "not executed: approval expired" |
| Tool threw | `failed` | "Tool error (...): ... The action did not complete." |
| Global timeout | `timeout` | "Tool ... timed out after ...ms." |
| MCP `isError` | `failed` | MCP tool returned an error. |

Tool output returned to the model is capped at 30,000 characters. This protects the context
window; the full structured output remains available in the execution record and run detail.

## 10. Audit and redaction

Every attempt produces:

- a `tool_executions` row with tool name, source, status, approval id, input, output, error,
  timing, and idempotency key;
- an activity entry for successful, failed, or denied calls;
- a `tool_completed` run event for completed calls;
- an approval row with a redacted payload for gated calls.

Redaction removes secret-looking string patterns and masks object keys that look like
credentials (`key`, `token`, `secret`, `password`, `authorization`, `credential`, `cookie`,
`header`). It is defense in depth, not a guarantee that arbitrary provider error text contains
no sensitive data. Integrations should avoid echoing secrets in error messages.

## 11. Adding a tool

Checklist for a new native tool:

1. Implement `SwarmTool` in `packages/core/src/tools/` and register it in
   `createNativeToolRegistry()`.
2. Declare the narrowest correct risk and `requiresApproval`. Purchases and destructive
   actions must never be declared as reads.
3. Validate all required inputs and enforce output/response size limits inside `execute()`.
4. Propagate `context.signal` to network calls and enforce an internal timeout.
5. Use `context.getIntegrationSecret()` for credentials; never accept secrets in tool input.
6. Return concise `content` for the model and structured `data` for audit.
7. Add the tool to relevant domain-pack allowlists. `domain.test.ts` checks that every
   allowlist entry resolves to a registered native tool.
8. Add policy and execution tests, especially for denial and approval paths.
9. Document the tool and its live-verification status.

A new external source must not execute arbitrary code. MCP is the supported process/network
bridge; extensions are declarative HTTP only.

## 12. Verification boundary

Tested:

- the policy matrix, including health, purchase, destructive, MCP, extension, and HTTP-write
  cases;
- approval suspension, denial, resume, and expiry at the engine/store level;
- idempotent write execution at the repository level;
- tool allowlists resolving to registered native tools;
- web SSRF guards, redaction, and artifact creation.

Unverified live:

- GitHub API reads/writes against github.com;
- Telegraph x402 quotes, payment settlement, and signal lookup;
- remote MCP servers and extension endpoints;
- behavior of third-party services under rate limits or schema drift.

See [IMPLEMENTATION_STATUS](../IMPLEMENTATION_STATUS.md).
