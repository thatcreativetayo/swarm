# SWARM — Axle Reuse Audit

**Audit date:** 2026-10-31  
**Audit type:** Source-level architecture and capability audit. No Axle build, test, install, migration, or runtime command was executed.  
**Original Axle path:** `C:\Users\Ariyo Eyitayo\Desktop\Axle`  
**SWARM product path:** `C:\Users\Ariyo Eyitayo\Desktop\swarm\swarm`

---

## 1. Purpose

SWARM began from an Axle source checkout so the team could decide, from evidence, what was worth carrying into a universal web-first workforce and what was irreducibly Axle-specific. This document records:

- what Axle is and how it is structured;
- which capabilities were candidates for reuse;
- which were reused as **product patterns**, which were reimplemented, and which were rejected;
- why no Axle runtime code is imported into the SWARM product;
- the safety findings that directly shaped SWARM's permission model;
- how isolation and non-modification were verified.

This is not a line-by-line code provenance report. SWARM's implementation is new TypeScript code; the audit is the design input.

## 2. Isolation and non-modification

Axle was treated as read-only evidence.

- SWARM was bootstrapped with `git clone --no-hardlinks` from Axle into `Desktop\swarm`. The clone prevents hardlink writes from crossing repositories.
- The `axle-upstream` remote was removed from the SWARM checkout and `push.default` was set to `nothing`, so no accidental push path back to Axle exists.
- The SWARM product is confined to the nested `swarm/` directory. The copied Axle tree at the repository root is retained only as provenance and is not part of the SWARM runtime.
- A final verification against the original checkout was performed with:

```powershell
git -C "C:\Users\Ariyo Eyitayo\Desktop\Axle" status --short --branch
```

Result at the end of this phase: clean `main...origin/main`, HEAD `9bcedfb3839979c4bb3c0390a47d99c57030a516`. No files were modified, deleted, renamed, installed into, formatted, built, or migrated in the original Axle checkout.

## 3. What Axle is

Axle is an AI engineering workspace: a desktop app paired with a Rust agent runtime, a TypeScript orchestration server, web/mobile clients, and cloud services. The codebase-intelligence dossier in `docs/codebase-intelligence/` is the primary evidence base.

Key structural facts:

- The **Rust agent plane** (`crates/axle_*`) owns prompt assembly, provider calls, tool execution, approvals, sessions, compaction, and memory.
- The **TypeScript orchestration plane** (`axle-desktop/source/apps/server`) owns threads, turns, checkpoints, Git/VCS, terminals, schedules, MCP toolkits, projections, and desktop IPC.
- The planes meet at an NDJSON process protocol. The desktop server spawns `axle --json-stream` per turn and communicates approvals through a file-watch channel.
- Clients include Electron desktop, React web, and Expo mobile.
- Axle's domain assumptions are coding: repositories, worktrees, diffs, terminals, Playwright previews, pull requests, and local developer environments.

The audit found substantial engineering strength in the Rust core: complete agent loop, provider coverage, MCP transports, session JSONL, compaction, and a tested approval path. It also found architecture that would be actively harmful to copy wholesale into a web-first universal workforce:

- desktop process and filesystem coupling;
- terminal/Git/browser tools that conflict with SWARM's no-arbitrary-code boundary;
- fail-open tool approval defaults for unknown tools;
- shell tools that inherit the agent environment;
- no repository-level turn/token budget in the agent plane;
- approval-file trust and local-path assumptions;
- context compaction and session formats tuned to long coding sessions.

## 4. Reuse decision matrix

Legend:

- **Pattern reused** — the concept informed SWARM's design; the implementation is new.
- **Reimplemented** — the capability exists in SWARM in TypeScript, with different semantics.
- **Rejected** — deliberately excluded.
- **Not applicable** — Axle-specific surface with no SWARM equivalent.

| Axle capability | Evidence | Decision | SWARM implementation / rationale |
| --- | --- | --- | --- |
| Agent turn loop | `crates/axle_agent/src/loop_runner.rs`; `docs/codebase-intelligence/04-ai-and-agent-systems.md` | **Reimplemented** | `packages/core/src/runtime/agent-loop.ts`: persisted multi-turn loop, tool-call handling, JSON correction, artifact output, approval suspension. |
| Provider abstraction | `crates/axle_ai/*`; `04` §5 | **Reimplemented** | `packages/core/src/providers/*`: OpenAI-compatible + Anthropic, retries, timeouts, structured JSON, usage accounting. |
| Tool registry and risk gating | `crates/axle_tools/src/registry.rs`; `04` §3 | **Pattern reused + hardened** | `SwarmTool` contract and `decideToolPolicy()`. SWARM uses explicit risk classes and fails closed for external/unknown paths. |
| Approval gate | `loop_runner.rs` approval file protocol; `04` §2 | **Reimplemented with durable state** | Database-backed `approvals` + `tool_executions` + persisted task runtime. No local approval-file trust. |
| Session JSONL and crash repair | `crates/axle_session`; `04` §6 | **Rejected for SWARM** | SWARM uses relational run/task state and an append-only `run_events` log. Long coding-session compaction is out of scope. |
| Context compaction | `crates/axle_compaction` | **Not applicable** | SWARM tasks are bounded by turn/token budgets and small deliverables. No compaction engine in v0.1. |
| Memory | `crates/axle_memory`; `04` §7 | **Pattern reused** | Workspace memory table + keyword search/write tools. Secret-shape rejection was not copied; SWARM relies on tool policy and redaction rather than content classification. |
| MCP client (HTTP/stdio) | `crates/axle_tools/src/mcp.rs`; `04` §9 | **Reimplemented** | `packages/core/src/mcp/*`: JSON-RPC initialize, paginated discovery, calls, session ids, encrypted auth, idle eviction. |
| MCP server exposing internal toolkits | `apps/server/src/mcp/*` | **Rejected** | SWARM is an MCP **client** only. Exposing previews/plugins/PR toolkits would reintroduce desktop/coding scope. |
| JS extension engine | `crates/axle_extensions`; `04` §8 | **Rejected** | Arbitrary code is outside SWARM's trust model. Extensions are declarative HTTP manifests, disabled by default, always approval-gated. |
| Event-sourced orchestration | `apps/server/src/orchestration`, 32 migrations | **Pattern reused** | Relational state + append-only run events + projections in `Store`/API. Not a full event-sourcing framework. |
| SQLite projections | `apps/server/src/persistence` | **Pattern reused** | `node:sqlite` with migrations, WAL, foreign keys, indexes, repository API. |
| Auth/DPoP/scopes | `apps/server`, auth worker | **Rejected for MVP** | Single-user local-first bearer token; no account system, OAuth, DPoP, or RBAC. |
| Electron desktop shell | `axle-desktop/source/apps/desktop` | **Rejected** | Web-first requirement. No Electron, IPC, auto-updater, or native menus. |
| Terminal / node-pty | `apps/server/src/terminal/*` | **Rejected** | No shell/terminal tools. `bash`, `shell`, `exec`, and process-spawn names are denied unconditionally. |
| Git manager / worktrees | `apps/server/src/git/*` | **Rejected** | Not a coding workspace. GitHub issue creation is an optional external tool, not a Git surface. |
| Playwright preview automation | `apps/server/src/mcp` preview toolkits | **Rejected** | Browser automation is outside v0.1. Public `web_fetch` is read-only and SSRF-guarded. |
| Scheduled tasks | `apps/server/src/schedules/Service.ts` | **Not built in v0.1** | Only manual/API-triggered runs. A schedule surface is future work. |
| Mobile client | `apps/mobile` | **Rejected** | Web only. |
| Marketing/analytics/cloud workers | `axle-landing`, `axle-analytics`, workers | **Rejected** | No cloud dependency in the MVP. |
| Domain profiles | `.axle/agents.toml` | **Pattern reused, generalized** | Six domain packs with 24 declarative agent definitions, rather than coding profiles. |

## 5. Why direct code reuse was not appropriate

### 5.1 Runtime mismatch

Axle's execution core is Rust with a local-process, file-backed, coding-session model. SWARM's state is web-facing and relational. Porting the Rust loop would have required either:

- embedding a Rust binary into a Node service while preserving the NDJSON/file approval protocol, which retains desktop assumptions; or
- rewriting the loop anyway to support durable database approvals, universal tools, and budget accounting.

Neither path buys enough to justify the coupling. A new TypeScript core keeps one language across API, worker, and orchestration and makes the persisted approval state native.

### 5.2 Domain mismatch

Axle's tools and prompts are optimized for editing repositories: `bash`, `write`, `edit`, `read`, `ls`, `grep`, `find`, plan mode, and Git. SWARM explicitly refuses arbitrary code and filesystem access. Its tools are knowledge/action APIs: artifacts, memory, public web, GitHub issues, MCP, Telegraph, and declarative HTTP extensions.

### 5.3 Trust-model mismatch

Axle's source comments state that the local execution target inherits the agent environment and that the approval gate is the confinement boundary. SWARM's product requirement is stronger: no shell at all, no filesystem-write tool, and all external effects approval-gated. Reusing Axle's tool layer would import a boundary that does not match SWARM's threat model.

### 5.4 Product identity mismatch

SWARM is not a rebranded Axle. It has a different primary object (run, not thread), a different default surface (web command center, not desktop IDE), a different workforce model (domain packs and dynamic planning, not coding profiles), and a different action model (knowledge/API tools, not code editing). Sharing a name would be misleading; copying code would make the difference harder to reason about.

## 6. Safety findings carried forward as design constraints

The audit produced concrete constraints rather than code:

| Axle finding | Evidence | SWARM constraint |
| --- | --- | --- |
| Fail-open approval default for unknown tools | `registry.rs` default `requires_approval=false`; dossier SEC-1 | Every SWARM tool declares a risk and approval flag; unknown external tools fall through to approval; shell/exec names are hard-denied. |
| Shell inherits agent env; approval is the only sandbox | `execution.rs`; dossier SEC-2 | SWARM has no shell or process-spawn tool. Stdio MCP is the only local process and is explicitly configurable. |
| Approval file trust | `AxleAdapter.ts` + `loop_runner.rs`; dossier SEC-5 | Approvals are database records with workspace/run/task scoping and API authentication, not writable local files. |
| No per-request turn/token cap | dossier SEC-9 | Per-run model-call, token, time, task-attempt, turn, and tool-call limits. |
| Extension tools can default to no approval | `04` §8 | All extension tools require approval; arbitrary extension code is rejected. |
| MCP tool timeout unverified | dossier `04` §11 | SWARM applies a 30s MCP request timeout and the agent tool timeout; cancellation is propagated to the MCP request. |
| Broad prompt-injection surface | dossier SEC-8 | Least-privilege tools, untrusted content framing, redacted approvals, no code execution. |
| Dead CI / failing gates | dossier REL-1/REL-2 | SWARM's own tests/typecheck/build/smoke are run and recorded; no inherited CI is claimed. |

## 7. What SWARM did reuse

SWARM reused **architecture lessons**, not source files:

1. Separate the agent loop from orchestration and persistence.
2. Make tool calls first-class, auditable objects.
3. Treat approvals as a protocol between execution and a human, not as a prompt hint.
4. Keep provider adapters behind a narrow interface.
5. Use MCP as an interoperability boundary rather than building every integration natively.
6. Persist enough state to resume after a pause.
7. Validate model output instead of trusting it.
8. Keep credentials server-side.

These are generic engineering patterns. The SWARM implementation is independently written, with its own schemas, state machine, policy engine, queue, API, and UI.

## 8. What was explicitly not reused

- No Rust crates, binaries, or FFI.
- No Electron, React web code, Tailwind design system, or mobile code from Axle.
- No Axle database migrations or schemas.
- No Axle prompts, skills, AGENTS.md hierarchy, or coding tool instructions.
- No Axle session/JSONL/compaction formats.
- No Axle extension runtime.
- No Axle name, branding, package identifiers, storage keys, or remote configuration.
- No path back to Axle's Git remote.

A repository-wide search for `Axle`, `axle`, `t3code`, and `T3CODE` across the SWARM product sources, tests, docs, and manifests returns no matches.

## 9. Verification checklist

| Check | Result |
| --- | --- |
| Original Axle status clean | Verified at start and end of the build phase. |
| Original Axle HEAD unchanged | `9bcedfb3839979c4bb3c0390a47d99c57030a516`. |
| SWARM product isolated in `swarm/` | Yes; root Axle copy retained only as provenance. |
| Remotes removed from SWARM checkout | Yes; no `axle-upstream`. |
| No push path | `push.default=nothing`. |
| No Axle identifiers in product | Search returned no matches. |
| SWARM builds/tests independently | `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm smoke` pass. |
| No Axle builds/tests run | Audit was source-level only; no Axle command was executed. |

## 10. Residual concerns

- The copied Axle root still exists in the outer repository. It is not part of the SWARM runtime, but it can confuse a reader who opens the outer README. The product README explicitly points to the nested workspace.
- SWARM has not been legally reviewed for license obligations. Because no Axle source was copied into `swarm/`, the immediate concern is low, but a distribution review should confirm this and preserve the audit trail.
- The audit is source-level. It does not prove Axle runtime behavior, nor does it prove SWARM equivalence. SWARM's own tests and smoke are the evidence for SWARM.
- Live provider, Telegraph, MCP, GitHub, and extension behavior remains unverified. See [IMPLEMENTATION_STATUS](../IMPLEMENTATION_STATUS.md).
