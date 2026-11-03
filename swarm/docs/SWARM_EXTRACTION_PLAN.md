# SWARM — Extraction and Build Plan

**Status:** Executed through v0.1 local-first MVP  
**Last updated:** 2026-10-31  
**Related:** [Axle Reuse Audit](AXLE_REUSE_AUDIT.md), [Build Plan](BUILD_PLAN.md), [Implementation Status](../IMPLEMENTATION_STATUS.md)

---

## 1. Objective

Create an independent, web-first Universal Autonomous AI Workforce from the Axle codebase **without modifying Axle** and without inheriting Axle's desktop/coding constraints.

The extraction was not a mechanical fork. It was a structured port of product capabilities:

- keep the orchestration discipline: agent loop, tools, approvals, provider abstraction, durable state;
- change the product domain: universal knowledge/action work, not repository editing;
- change the surface: web command center, not Electron desktop;
- change the trust model: no shell/filesystem/code execution, declarative extensions only;
- change the persistence model: relational run/task/approval state, not session files;
- keep the original Axle checkout untouched.

## 2. Constraints

| Constraint | Implication |
| --- | --- |
| Axle must remain untouched | All work confined to the SWARM checkout/product directory. No installs, builds, migrations, or Git changes in Axle. |
| No push path to Axle | Remove the upstream remote; set `push.default=nothing`. |
| Web-first TypeScript | API, worker, and core in TypeScript. No Electron or Rust runtime dependency. |
| Universal, not coding-first | Domain packs across business, education, software, career, health, general. |
| Real execution with control | Native/MCP/extension tools, backend policy, approval state machine. |
| Local-first runnable | Node 24 + SQLite; no Docker/Postgres/Redis requirement. |
| Honest verification | Distinguish tested, implemented-unverified, and not built. |
| Preserve provenance | Keep audit docs, source-level evidence, and final Axle status check. |

## 3. Target architecture

```text
apps/web      React command center
apps/api      Hono REST + SSE + static hosting
apps/worker   standalone job processor
packages/core domain, planning, agent runtime, tools, MCP,
              extensions, persistence, security, providers
```

Topology: API + inline worker by default; split worker optional. SQLite is the source of truth. SSE is a projection; polling is the fallback.

## 4. Phase plan and status

### Phase 0 — Isolation and baseline

**Status: Complete**

- Clone Axle with `--no-hardlinks` into the SWARM workspace.
- Remove the Axle upstream remote.
- Set `push.default=nothing`.
- Record Axle HEAD and clean status.
- Decide that the SWARM product lives in a nested `swarm/` workspace while the outer copied tree remains provenance.

**Exit gate:** Axle clean and unchanged; no remote capable of pushing back.

### Phase 1 — Reuse audit

**Status: Complete**

- Read Axle architecture, agent, integration, persistence, frontend, security, testing, and technical-debt dossiers.
- Identify reusable patterns and coupling.
- Record approval, provider, MCP, session, extension, and UI findings.
- Decide against direct Rust/Electron/desktop code reuse.

**Exit gate:** [Axle Reuse Audit](AXLE_REUSE_AUDIT.md) written with evidence and explicit rejection rationale.

### Phase 2 — Contracts and domain model

**Status: Complete**

- Define Zod/TypeScript contracts for workspaces, runs, agents, tasks, approvals, artifacts, activities, integrations, MCP, memory, tool executions, model calls, and jobs.
- Define domain-pack schemas: agent definitions, task templates, workflows, tool requirements, evaluation rules.
- Implement six packs with 24 agents and 22 tasks.
- Implement pack validation and domain resolution.
- Define goal interpretation, workforce plan, agent output, and review schemas.

**Exit gate:** Domain tests pass; packs validate; limits are enforced by plan validation.

### Phase 3 — Persistence and security

**Status: Complete**

- SQLite schema with migrations v1–v2.
- WAL, foreign keys, busy timeout, transaction helper.
- Repository API for all entities and leased jobs.
- Encrypted secret box (AES-256-GCM), auto-generated key, integration/MCP secret access.
- SSRF guard, redaction, tool policy engine, safe ID/slug/JSON/logger utilities.

**Exit gate:** Store, crypto, SSRF, redaction, and policy tests pass.

### Phase 4 — Providers and planning

**Status: Complete**

- OpenAI-compatible and Anthropic adapters.
- Retry/timeout behavior and structured JSON extraction.
- Model-call accounting and pricing estimates.
- Goal interpretation with deterministic fallback.
- Workforce plan generation with validation, retry, and deterministic fallback.
- Interpretation and planning calls counted against run budgets.

**Exit gate:** Provider and planner tests pass; fallback plans respect both agent and task limits.

### Phase 5 — Agent runtime and orchestration

**Status: Complete**

- Persisted multi-turn agent loop.
- Tool calls, output correction, artifact creation, memory writes.
- Approval suspension/resume with persisted pending tool calls.
- Cancellation and budget checks.
- Leased job queue and worker loop.
- Interpret/execute/resume/review/finalize handlers.
- Run failure, retry, blocked-workflow detection, agent status refresh.
- Review and final fallbacks.

**Exit gate:** End-to-end engine tests pass for completion, approval denial, cancellation, and invalid-output failure.

### Phase 6 — Tools, MCP, extensions, Telegraph

**Status: Complete (live integrations unverified)**

- Native tools: artifacts, memory, web fetch/HTTP, GitHub, Telegraph.
- MCP HTTP/stdio client and manager with encrypted secrets.
- Declarative HTTP extension loader.
- Telegraph x402 discovery/quote/purchase/signal with approval and price ceiling.
- Policy matrix covering all risk classes and sources.

**Exit gate:** Policy tests and typecheck pass; external calls remain unverified by design.

### Phase 7 — API and web command center

**Status: Complete**

- Hono API with health, settings, bootstrap, workspaces, runs, SSE/poll events, approvals, artifacts/download, activity, workforce, tasks, tools, memories, integrations, MCP.
- Auth bearer token, body limits, security headers, validation, redacted run detail.
- Inline worker startup and graceful shutdown.
- React UI with hash routing, boot/token gate, command, run tabs, workforce, tasks, approvals, artifacts, activity, integrations, settings.
- Hand-written premium dark CSS, markdown renderer, artifact viewer, approval cards, toasts.
- Vite proxy and built static serving.

**Exit gate:** Web and API build; browser-level smoke is manual and not automated. API smoke covers the contract.

### Phase 8 — Verification and documentation

**Status: In progress at the time this document was written; see [IMPLEMENTATION_STATUS](../IMPLEMENTATION_STATUS.md) for final recorded results.**

- Vitest suite: 86 tests across configuration, domain, planning, providers, structured JSON, security, store, engine.
- Smoke: mock model + isolated API + auth + run + artifacts + download.
- Typecheck all packages.
- Build web/API/worker.
- Write 12 required docs + README + status.
- Re-verify Axle.

**Exit gate:** All commands pass; documented unverified integrations; Axle clean.

## 5. Extraction mapping

| Axle concern | SWARM concern | Transformation |
| --- | --- | --- |
| Thread / turn | Run / task | A run owns a DAG of tasks, not a conversation. |
| Coding agent profile | Domain agent definition | Six packs, role-specific tools, evaluation criteria, output schema. |
| Rust CLI loop | TypeScript `AgentRunner` | Persisted runtime state; no process per turn. |
| Local approval file | Approval + tool execution rows | API decision; durable resume; redacted payload. |
| SQLite projections | Relational `Store` | Same SQLite discipline, new schema and contracts. |
| Rust provider adapters | TS provider adapters | OpenAI-compatible/Anthropic, accounting, structured JSON. |
| Rust MCP client | TS MCP client | HTTP/stdio, encrypted secrets, discovery persistence. |
| JS extensions | Declarative HTTP manifests | No code execution; disabled by default; approval-gated. |
| Desktop/web/mobile clients | Web command center | One React app, no Electron, no mobile. |
| Git/terminal/browser tools | Native knowledge/action tools | No code execution; optional GitHub issue and public web. |
| Session compaction | Budgeted tasks | Small task contexts; no compaction engine. |
| Cloud auth/DPoP | Local bearer token | Single-user MVP; hosted auth is future work. |

## 6. Key architectural decisions

1. **Independent TypeScript core.** No Rust/FFI, no Electron, no shared code. The interface is re-derived from product requirements.
2. **SQLite with a repository seam.** Local-first now; Postgres migration later behind `Store`.
3. **Database-backed jobs.** A leased queue supports crash recovery and an optional separate worker without Redis.
4. **Approval is durable state.** It is not an in-memory callback or a prompt instruction.
5. **Deterministic fallbacks for human-critical stages.** Invalid interpretation/plan/output does not silently invent success.
6. **No shell/filesystem tools.** This is a deliberate product boundary, not missing work.
7. **Extensions are data, not code.** Declarative HTTP is the only third-party execution surface.
8. **Telegraph is optional and spend-gated.** Discovery/quote are free; purchase requires approval and a price ceiling.
9. **One UI token.** No account system in v0.1. Token required for any non-loopback deployment.
10. **Inline worker by default.** Optimizes the one-command local experience; split mode remains available.

## 7. Risks and responses

| Risk | Response | Residual |
| --- | --- | --- |
| Desktop/coding assumptions leak into SWARM | Explicit audit table; no code reuse; product boundaries in docs and policy. | Copied outer tree can confuse readers; README points to nested product. |
| Approval bypass | Backend policy, tests across risk matrix, always-gated purchase/destructive/extension, denial test. | New tool registrations must correctly declare risk; no registry-invariant test yet. |
| Model output invalid | Zod validation, retries, correction turns, fallbacks. | Fallbacks are lower quality but labelled. |
| SQLite contention | WAL, short writes, one worker recommended. | No load test / multi-worker benchmark. |
| Secret leakage | Server-side secrets, AES-GCM, redaction, no secret return API. | Logs could still contain unexpected provider error text not covered by patterns. |
| Prompt injection | No code execution; external actions gated; untrusted content framing. | A user can still approve a malicious action; approval UI must be read carefully. |
| Live integration drift | Timeouts, errors recorded, unverified status. | No contract tests against live services. |
| Telegraph spend | Approval + max price + testnet default + server-side key. | No live x402 settlement test; wallet funding/network handling unverified. |

## 8. Deployment and migration path

### Current

- Node 24 process(es), local SQLite, browser on loopback.
- Default inline worker.
- `.env` for provider and token.

### Near-term hardening

- Add API rate limiting and an explicit non-loopback token requirement.
- Add backup/restore guidance for `data/swarm.db` and `data/.encryption-key`.
- Add live provider and MCP contract tests behind opt-in env flags.
- Add tool-registry invariants (every tool has a risk; unknown tools cannot be read-allowed).
- Add artifact retention and size limits.

### Hosted path

1. Replace `Store` with a Postgres-backed repository while preserving contracts.
2. Replace SQLite jobs with a managed queue or BullMQ/Redis.
3. Move artifact content to object storage.
4. Add tenant RBAC, per-tenant KMS keys, SSO, audit export.
5. Add egress proxy/allowlist and rate limiting.
6. Run API replicas and independent workers.

This path is intentionally not presented as implemented.

## 9. Definition of done for v0.1

- [x] Axle untouched and verified.
- [x] No Axle identifiers or code in product.
- [x] Six domain packs, dynamic planning, deterministic fallback.
- [x] Persisted execution, budgets, cancellation, retries, idempotency.
- [x] Approval-gated external actions with durable resume.
- [x] Artifacts, review, final synthesis.
- [x] Web command center with all primary surfaces.
- [x] Native tools, MCP, extensions, Telegraph tools.
- [x] Encrypted secrets, SSRF guard, policy engine, redaction.
- [x] Tests, typecheck, builds, smoke.
- [ ] Live model verification.
- [ ] Live Telegraph settlement.
- [ ] Live remote MCP, GitHub write, extension verification.

The unchecked items are external-credential gates, not hidden implementation claims.
