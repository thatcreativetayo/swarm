# SWARM - Security and Permissions

**Version:** 0.1
**Status:** Implemented local-first baseline; not a hosted multi-tenant security model
**Last updated:** 2026-10-31
**Related:** [Tool Runtime](TOOL_RUNTIME.md), [MCP Integration](MCP_INTEGRATION.md), [Extension Platform](EXTENSION_PLATFORM.md), [Telegraph Integration](TELEGRAPH_INTEGRATION.md), [Architecture](ARCHITECTURE.md)

---

## 1. Security objectives

SWARM is designed to let a model take real actions without giving it uncontrolled authority.
The security objectives are:

1. **Consequential actions require a human decision.** Purchases, destructive actions, external
   writes, and extension/MCP writes suspend the run.
2. **The backend enforces policy.** The model proposes tool calls; it cannot grant itself tools,
   approvals, or workspace settings.
3. **Credentials stay server-side.** Provider keys, integration tokens, MCP headers/env, and the
   Telegraph burner key never reach the browser, prompts, artifacts, or API responses.
4. **External content is untrusted.** Web pages, MCP responses, extension responses, and model
   output can contain instructions. They are not treated as authority.
5. **State changes are auditable.** Approvals, tool attempts, model calls, jobs, artifacts, and
   run events are persisted.
6. **Failure is honest.** A denied, failed, or timed-out action is recorded and reported; it is
   never presented as success.

This is a **single-user, local-first** security model. It is not a hardened multi-tenant SaaS
control plane. Section 11 lists the gaps explicitly.

## 2. Trust boundaries

```text
Untrusted browser input
        |
        v
  API (bearer token, validation, workspace routes)
        |
        v
  Worker / core (policy, approvals, secrets, tools)
        |
        +--> Model provider (untrusted output)
        +--> Public web / GitHub (untrusted content)
        +--> MCP HTTP / stdio servers (operator-installed, untrusted behavior)
        +--> Extension HTTPS endpoints (untrusted behavior)
        +--> Telegraph node / x402 settlement (untrusted behavior)
        |
        v
  SQLite (local, contains encrypted secrets and run data)
```

The model is untrusted in the sense that its output is validated and its tool calls are
policy-checked. It is not sandboxed as a process; it only produces text and tool-call requests.

## 3. Authentication

- `/api/*` requires `Authorization: Bearer <SWARM_API_TOKEN>` when `SWARM_API_TOKEN` is set.
- Comparison uses `crypto.timingSafeEqual` after a length check.
- `/api/health` is public so supervisors and smoke tests can probe readiness.
- If no token is set, the API is **unauthenticated**. The server logs a warning. The default bind
  address is `127.0.0.1`.
- The API does not itself enforce loopback binding. Setting `SWARM_HOST=0.0.0.0` without a token
  exposes the full control plane to the network. This is an operator error the code warns about
  but does not block.
- The browser stores the token in `localStorage` under `swarm.apiToken`. Any XSS in the app
  origin could read it. The app avoids raw HTML rendering (Section 8), but localStorage is not a
  hardened credential store.
- There is no login, session cookie, SSO, MFA, user table, or token rotation. The token is a
  shared deployment secret.

## 4. Authorization and tenancy

- Resources are scoped by workspace id in route paths. The store verifies workspace ownership for
  server-side operations such as MCP deletion.
- Every valid token holder can access every workspace. There is no per-user or per-workspace
  authorization.
- Artifact detail/download routes are keyed by artifact id rather than a workspace path. A valid
  token can read any artifact if it knows the id.
- `POST /api/mcp/:serverId/connect` is keyed by server id and does not take a workspace path.
- Workspace settings are writable by any authenticated caller:
  `autoApproveReadOnlyMcp`, `allowExternalHttpWrites`, `maxAgents`, `maxTasks`.
- There is no audit of who made a request because there are no user identities.

**Deployment rule:** the bearer token is a single-user control-plane secret. Do not expose SWARM
to untrusted users. A hosted deployment needs real identity, RBAC, row-level tenancy, and
per-tenant key management.

## 5. Secret management

### 5.1 At rest

Integration secrets and MCP header/env maps are stored in the `secrets` table:

- AES-256-GCM with a random 96-bit IV and 128-bit authentication tag;
- plaintext is never stored;
- the key comes from `SWARM_ENCRYPTION_KEY` (base64 32 bytes or 64 hex chars) or is generated to
  `data/.encryption-key`;
- the generated file is written with mode `0600` where the platform supports it;
- decryption failure returns `null`, so secret-dependent tools fail closed.

Losing the key makes stored secrets unrecoverable. Copying the database without the key produces
a system that opens but cannot use integrations or MCP credentials.

### 5.2 In transit and in use

- Secrets are decrypted only inside the API/worker process when a tool or MCP client needs them.
- The API returns integration metadata with `hasSecret` and never returns the value or secret id.
- MCP responses omit header/env secret ids and values.
- `publicConfig()` exposes whether payments are configured, not the key.
- Models receive no integration secrets through the tool context.
- Redaction is applied to approval payloads before persistence and again to API projections.

### 5.3 Gaps

- No key rotation, envelope encryption, KMS, or per-workspace keys.
- The environment key and generated key file are process-readable by the OS account.
- Secrets can still leak through a tool's own error text or an endpoint's response. Redaction is
  pattern-based and cannot recognize every credential format.
- An operator who can read the SQLite file and key file has all secrets.
- `pnpm audit` and dependency provenance review were not performed as part of this build.

## 6. Tool policy

Policy is enforced in `packages/core/src/security/policy.ts`, not in prompts or the UI.

### 6.1 Evaluation order

1. Unconditionally deny `bash`, `shell`, `exec`, `code_exec`, `file_write`,
   `filesystem_write`, `process_spawn`.
2. Deny `purchase` and `destructive` risks in health workflows.
3. Require approval for any `purchase` or `destructive` risk.
4. Require approval when the tool declares `requiresApproval`.
5. Allow `read` and `internal_write`.
6. For MCP: allow only read-only tools when the workspace opted in; otherwise approve.
7. Require approval for every extension call.
8. For `http_request` writes: deny when workspace external writes are disabled; approve when
   enabled.
9. Require approval for all other external actions.

### 6.2 Important properties

- A tool cannot be made read-only by the model. Risk is declared in code and, for
  `http_request`, recomputed from the actual method.
- A workspace can auto-approve only MCP tools whose server marked them read-only. It cannot
  auto-approve purchases, destructive actions, extensions, GitHub issue creation, or arbitrary
  external writes.
- Health workflows cannot purchase or perform destructive actions.
- Unknown or unexpectedly registered destructive tools still require approval.
- There is no generic JSON Schema validation before execution; each tool validates its own
  inputs. This is an input-integrity gap, not a permission bypass.

## 7. Approval security

- A gated call creates a `tool_executions` row and an `approvals` row in one engine step.
- The task, run, and agent enter `awaiting_approval`; the persisted agent state includes the
  pending call and remaining calls.
- Approval payloads contain the tool, source, risk, task/agent ids, and redacted arguments.
- Approvals expire after 24 hours. The worker sweeps at startup and every 30 seconds.
- A decision moves the task back to `running` and enqueues a `resume_task` job with an idempotency
  key.
- Approval resumes exactly the persisted call. If the execution already succeeded, its output is
  replayed rather than repeating the external action.
- Denial and expiry never execute the action; the agent receives a tool error and must adapt.

Limits:

- A human can approve a harmful action. The approval UI shows risk and redacted arguments, but
  the user must read them.
- There is no second approver, quorum, spend ledger, or per-day budget.
- The approval payload for an extension call does not show the resolved endpoint.
- For Telegraph purchases, an omitted `maxPriceUsd` falls back to $0.02; the UI may not surface
  the implicit default.

## 8. Browser and artifact security

- The web app is React and renders model output as React text/elements. It does not use
  `dangerouslySetInnerHTML`.
- The custom markdown renderer emits React nodes and only links `http:`/`https:` URLs with
  `rel="noreferrer noopener"`. Raw HTML in markdown is displayed as text.
- HTML artifacts are shown as source code, never executed in an iframe or the app origin.
- Built static assets are served with a Content Security Policy:
  `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:;
  font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none';
  form-action 'self'`.
- Static and API responses set `x-content-type-options: nosniff`, `x-frame-options: DENY`, and
  `referrer-policy: no-referrer`; static responses also set `cross-origin-opener-policy`.
- Artifact downloads use `Content-Disposition: attachment`, a sanitized filename, `nosniff`, and
  `cache-control: no-store`. The artifact MIME type is preserved, but attachment disposition
  prevents normal in-origin rendering.
- There is no CSRF token because authentication is a bearer header, not a cookie. A malicious
  site cannot read the token from localStorage or attach it automatically.
- Residual XSS risk remains in any browser app; the token in localStorage raises the impact of a
  successful script injection.

## 9. Network and SSRF controls

### 9.1 Public web tools

`web_fetch` and `http_request` call `assertSafeUrl` before every request and before every
redirect:

- only `http` and `https`;
- no embedded username/password;
- blocks `localhost`, `.localhost`, `.local`, `metadata`, `metadata.google.internal`,
  `instance-data`;
- resolves DNS and rejects private, loopback, link-local, carrier-grade NAT, multicast, and
  reserved IPv4/IPv6 ranges;
- revalidates up to four redirects;
- strips `host`, `content-length`, `connection`, `transfer-encoding`, `upgrade`,
  `proxy-authorization`, and `cookie` headers; drops `x-forwarded-*`;
- caps responses at 500,000 bytes (`web_fetch`) or 1,000,000 bytes (`http_request`);
- allowlists content types for `web_fetch`;
- enforces a 20-second or caller-specified timeout.

`http_request` still allows an `authorization` header supplied by the model. The model does not
know integration secrets, but it may have seen sensitive content in prior tool output. Treat any
GET with custom headers as a potential exfiltration path if the model is prompt-injected.

### 9.2 MCP

MCP HTTP URLs are validated only as HTTP/HTTPS without embedded credentials. They are **not**
passed through the private-address SSRF guard, because local-first users need private MCP
servers. stdio servers execute arbitrary local processes and are not sandboxed. MCP
administration is therefore a privileged capability.

### 9.3 Extensions

Extensions require HTTPS, reject embedded credentials, run `assertSafeUrl` on the resolved URL,
refuse redirects, and cap responses at 200,000 characters. DNS rebinding remains possible between
validation and fetch.

### 9.4 Telegraph and GitHub

Telegraph requests go to the configured node URL; the node URL is not SSRF-filtered and should
be set only by a trusted operator. GitHub requests go to `https://api.github.com`. Neither
service is trusted to return safe content.

## 10. Prompt injection and model output

SWARM assumes retrieved content may contain adversarial instructions. Mitigations:

- no shell, filesystem-write, process-spawn, or arbitrary-code tool;
- external actions are approval-gated;
- fetched content is labeled with its URL and treated as data in prompts;
- tool results are bounded;
- the model cannot change policy, approvals, workspace settings, or the tool registry;
- final artifacts are reviewed and stored, not automatically executed.

Residual risk:

- a model can be persuaded to request a harmful but allowed action, or to draft a misleading
  deliverable;
- a user can approve that action without reading the arguments;
- read-only tools can still leak data through URLs and headers;
- MCP/extension descriptions are untrusted text and can influence planning;
- there is no content-security classifier or injection detector.

## 11. Availability and abuse controls

| Control | Current state |
| --- | --- |
| Request body limit | 1 MB for `/api/*`. |
| Model budgets | Per-run model calls, tokens, wall-clock, task attempts, turns, tool calls. |
| Tool timeout | Global 60s default; per-tool internal limits. |
| Response caps | Web 0.5-1 MB; extensions 200 KB; model tool output 30 K chars. |
| Artifact cap | 400,000 characters per `artifact_write`; deliverables are bounded by model output. |
| Worker concurrency | One job at a time per worker loop. |
| API rate limiting | **None.** |
| Per-IP lockout | **None.** |
| Concurrent run cap | **None** beyond serialized job processing. |
| Request timeout | No explicit API-level timeout; SSE streams are long-lived. |
| Retention | No automatic pruning; artifact content grows the database. |

A public deployment needs rate limiting, request timeouts, a reverse proxy, and resource quotas.
SQLite is a single-writer store and is not a multi-tenant capacity plan.

## 12. Audit and integrity

- `run_events` is append-only by application convention and carries a monotonic sequence.
- `activities` provides a human-readable feed.
- `tool_executions` records every attempt, including denials and timeouts.
- `model_calls` records provider, model, tokens, cost estimate, status, and error.
- `approvals` records the decision, reason, and timestamps.
- Artifacts are immutable after creation.

Limits:

- The SQLite file is writable by the operator; there is no hash chain, signature, or external
  audit sink. An attacker with database access can alter history.
- There is no export API or retention policy.
- Logs are structured but local; there is no SIEM/OTel integration.

## 13. Deployment checklist

For a local single-user deployment:

- [ ] Set a long random `SWARM_API_TOKEN`.
- [ ] Keep `SWARM_HOST=127.0.0.1` unless a reverse proxy and network controls are in place.
- [ ] Set `SWARM_ENCRYPTION_KEY` and back it up separately from the database.
- [ ] Keep `SWARM_ENABLE_EXTERNAL_EXTENSIONS=false` unless needed.
- [ ] Set `SWARM_ALLOW_STDIO_MCP=false` if local MCP processes are not intended.
- [ ] Use a dedicated, low-balance Telegraph burner key.
- [ ] Review `data/` permissions; it contains the database and possibly the key file.
- [ ] Back up `swarm.db` and the encryption key together.

For any shared or hosted deployment, do not use v0.1 as-is. Add identity, RBAC, tenant
isolation, TLS termination, rate limiting, egress control, KMS, and centralized audit first.

## 14. Verification boundary

Tested:

- encryption/decryption and tamper rejection;
- secret storage and API non-exposure at the repository level;
- redaction of secret-like values and sensitive keys;
- SSRF host/IP/DNS/redirect rules;
- the full policy matrix, including health, purchase, destructive, MCP, extension, and HTTP
  writes;
- approval denial and expiry paths;
- artifact download headers in the smoke test;
- bearer-token rejection in the smoke test.

Not verified:

- a professional penetration test or threat-model review;
- live OAuth/MCP/extension/GitHub/Telegraph security behavior;
- dependency vulnerability audit;
- multi-tenant isolation (not implemented);
- resistance to a determined prompt-injection campaign;
- DNS-rebinding resistance at the network layer.

See [IMPLEMENTATION_STATUS](../IMPLEMENTATION_STATUS.md).
