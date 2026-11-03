# SWARM - Build Plan

**Version:** 0.1  
**Status:** Local-first MVP complete; live external-service verification pending  
**Last updated:** 2026-10-31  
**Related:** [PRD](PRD.md), [Architecture](ARCHITECTURE.md), [Extraction Plan](SWARM_EXTRACTION_PLAN.md), [Implementation Status](../IMPLEMENTATION_STATUS.md)

---

## 1. Purpose

This document is both the execution plan and the completion record for SWARM v0.1. It describes:

- the milestones used to build the product;
- the dependencies between them;
- the commands and evidence used to verify the build;
- the external integrations that remain unverified;
- the hardening work required before a shared or hosted deployment.

SWARM v0.1 is a **local-first, single-user MVP**. It is not a hosted multi-tenant service. The distinction matters: the local workflow is implemented and tested, while live provider, payment, MCP, GitHub, and extension traffic has not been exercised against real services.

## 2. Definition of done for v0.1

v0.1 is complete when:

- [x] The product builds and starts from this workspace with Node 24 and pnpm.
- [x] A goal can be interpreted, planned, executed, reviewed, and finalized end-to-end with a mock model.
- [x] Consequential actions suspend durably for approval, and denial prevents execution.
- [x] Runs, tasks, jobs, approvals, artifacts, tool calls, model calls, and events are persisted.
- [x] The web command center exposes the full run lifecycle.
- [x] Native tools, MCP, declarative extensions, GitHub, and Telegraph tools are registered behind backend policy.
- [x] Automated tests, typecheck, build, and the mock-model smoke test pass.
- [x] The required product and engineering documents exist.
- [x] The original Axle checkout remains unchanged.

The following are **not** part of the v0.1 done definition because they require external accounts, services, or a hosted environment:

- a live commercial model completing a real goal;
- a live Telegraph testnet purchase;
- a live remote MCP server;
- a live GitHub issue write;
- a live third-party extension endpoint;
- a hosted multi-tenant deployment.

They are tracked as external verification gates in Section 7.

## 3. Milestones

| Milestone | Scope | Status |
| --- | --- | --- |
| M0 | Isolation, provenance, and repository safety | Complete |
| M1 | Axle source-level reuse audit | Complete |
| M2 | Contracts, domain packs, and workforce model | Complete |
| M3 | SQLite persistence, jobs, and security primitives | Complete |
| M4 | Model providers, structured output, and planning | Complete |
| M5 | Persisted agent runtime and orchestration | Complete |
| M6 | Native tools, MCP, extensions, and Telegraph | Complete; live calls unverified |
| M7 | API, SSE, auth, and standalone worker | Complete |
| M8 | React command center | Complete; browser E2E not automated |
| M9 | Verification, documentation, and status reporting | Complete |

### M0 - Isolation and provenance

**Delivered**

- Cloned Axle with `git clone --no-hardlinks` into `Desktop/swarm`.
- Removed the Axle upstream remote from the SWARM checkout.
- Set `push.default=nothing` so no accidental push path to Axle exists.
- Confined the product to the nested `swarm/` pnpm workspace; the outer copied Axle tree is provenance only.
- Recorded the original Axle HEAD and clean status.

**Evidence:** [Axle Reuse Audit](AXLE_REUSE_AUDIT.md#2-isolation-and-non-modification).

### M1 - Reuse audit

**Delivered**

- Read Axle architecture, agent, provider, MCP, approval, persistence, client, security, and technical-debt documentation.
- Recorded which patterns were reused, reimplemented, or rejected.
- Rejected Axle's Rust/Electron runtime, desktop process protocol, shell and filesystem tools, fail-open approval defaults, and coding-specific surfaces.

**Evidence:** [Axle Reuse Audit](AXLE_REUSE_AUDIT.md).

### M2 - Contracts, domain packs, and workforce model

**Delivered**

- Zod and TypeScript contracts for workspaces, runs, agents, tasks, approvals, artifacts, activities, integrations, MCP servers, memories, tool executions, model calls, and jobs.
- Six domain packs: business, education, software, career, health, and general.
- 24 specialist definitions and 22 task templates across the packs.
- Goal interpretation, workforce plan, agent output, and review schemas.
- Plan validation for unique keys, known agents and packs, acyclic dependencies, dependency order, and agents without work.
- Workspace and per-run agent/task caps.

**Evidence:** `packages/core/src/domain/`, `packages/core/src/workforce/`, `packages/core/test/domain.test.ts`, `packages/core/test/planner.test.ts`, [Agent Specifications](AGENT_SPECIFICATIONS.md).

### M3 - Persistence, jobs, and security primitives

**Delivered**

- SQLite schema with migrations, WAL, foreign keys, busy timeout, and a transaction helper.
- Repository API for every persisted entity and a leased, idempotent job queue.
- Append-only run events plus relational activity, tool, model-call, approval, and artifact records.
- AES-256-GCM secret storage with an auto-generated local key.
- SSRF guard, secret redaction, and a backend tool-policy engine.
- Safe ID, slug, JSON, environment, and logging utilities.

**Evidence:** `packages/core/src/db/`, `packages/core/src/security/`, `packages/core/test/store.test.ts`, `packages/core/test/security.test.ts`, [Data Model](DATA_MODEL.md), [Security and Permissions](SECURITY_AND_PERMISSIONS.md).

### M4 - Providers, structured output, and planning

**Delivered**

- OpenAI, OpenRouter, Anthropic, and generic OpenAI-compatible adapters.
- Retry, timeout, and error normalization for retryable HTTP failures.
- Structured JSON extraction with a correction turn.
- Model-call accounting, token usage, and local pricing estimates.
- Goal interpretation with a deterministic fallback.
- Plan generation with one validation retry and a deterministic domain-template fallback.
- Interpretation and planning calls counted against run budgets.

**Evidence:** `packages/core/src/providers/`, `packages/core/src/workforce/`, `packages/core/test/providers.test.ts`, `packages/core/test/structured.test.ts`.

### M5 - Persisted agent runtime and orchestration

**Delivered**

- Multi-turn agent loop with tool calling, output correction, artifact creation, and memory writes.
- Durable approval suspension and resume from the persisted tool call.
- Approval expiry, denial adaptation, cancellation, retries, and budget enforcement.
- Leased worker loop with interpret, execute, resume, review, and finalize job handlers.
- Blocked-workflow detection, agent status refresh, and run failure handling.
- Independent review and final synthesis, each with a labelled fallback.

**Evidence:** `packages/core/src/runtime/`, `packages/core/src/orchestrator/`, `packages/core/test/engine.e2e.test.ts`, [Architecture](ARCHITECTURE.md).

### M6 - Tools, MCP, extensions, and Telegraph

**Delivered**

- Eleven native tools: artifact write, workspace memory search/write, public web fetch, HTTP request, GitHub repository read and issue creation, and four Telegraph tools.
- MCP HTTP and stdio JSON-RPC clients with initialize, paginated `tools/list`, `tools/call`, encrypted headers/environment, and discovery persistence.
- Declarative HTTP extension manifests, disabled by default, with HTTPS, SSRF, redirect, timeout, and response-size controls.
- Telegraph discovery, quote, x402 purchase, and signal verification with server-side payment credentials.
- Approval requirements for purchases, destructive actions, external writes, MCP writes, and every extension call.
- A payment-time x402 spend cap that rechecks the current quote against the approved price ceiling.

**Evidence:** `packages/core/src/tools/`, `packages/core/src/mcp/`, `packages/core/src/extensions/`, [Tool Runtime](TOOL_RUNTIME.md), [MCP Integration](MCP_INTEGRATION.md), [Extension Platform](EXTENSION_PLATFORM.md), [Telegraph Integration](TELEGRAPH_INTEGRATION.md).

**Boundary:** no live third-party service was called. See Section 7.

### M7 - API, SSE, auth, and standalone worker

**Delivered**

- Hono API with health, settings, bootstrap, domain-pack, workspace, run, approval, artifact, activity, workforce, task, tool, memory, integration, and MCP routes.
- Bearer-token authentication with timing-safe comparison; `/api/health` is public.
- Request body limits, security headers, validation, and redacted run detail.
- SSE run events with sequence-based polling fallback.
- Artifact download with safe filename and content headers.
- API-with-inline-worker default and a standalone worker process.
- Graceful worker shutdown and a periodic approval-expiry sweep.

**Evidence:** `apps/api/`, `apps/worker/`, `scripts/smoke.mjs`, [Architecture](ARCHITECTURE.md#3-request-and-execution-lifecycle).

### M8 - React command center

**Delivered**

- React 19 + Vite app with a custom hash router and hand-written dark CSS.
- Command, Run (overview/workforce/tasks/approvals/artifacts/activity/trace), Workforce, Tasks, Approvals, Artifacts, Activity, Integrations, and Settings surfaces.
- Boot/token gate, authenticated API client, toasts, approval cards, and live run updates.
- Custom markdown renderer that emits React nodes and never injects raw HTML.
- Artifact viewer for markdown, text, JSON, CSV, and HTML. HTML is shown as escaped source, not executed.
- Built assets served by the API; Vite proxies `/api` during development.

**Evidence:** `apps/web/`, [Architecture](ARCHITECTURE.md#11-web-application).

**Boundary:** the API contract is covered by the smoke test. Browser interactions and accessibility are implemented by inspection but have no automated browser test.

### M9 - Verification, documentation, and status reporting

**Delivered**

- Seven Vitest files with 86 tests.
- A mock-model smoke test that builds, boots the API, authenticates, creates a run, waits for completion, verifies review/final artifacts, checks accounting, and downloads an artifact.
- All required documents: PRD, architecture, Axle reuse audit, extraction plan, data model, agent specifications, tool runtime, MCP integration, extension platform, Telegraph integration, security and permissions, and this build plan.
- README, implementation status, and Axle re-verification.

**Evidence:** Section 5 and [Implementation Status](../IMPLEMENTATION_STATUS.md).

## 4. Build dependency order

```text
M0 isolation
  -> M1 reuse audit
  -> M2 contracts + domain packs
  -> M3 persistence + security primitives
  -> M4 providers + planning
  -> M5 runtime + orchestration
  -> M6 tools + MCP + extensions + Telegraph
  -> M7 API + worker
  -> M8 web command center
  -> M9 verification + docs
```

The order is intentional. Policy and persistence exist before tools; the runtime exists before the API exposes it; the API contract exists before the web UI consumes it. This keeps authority in the backend and prevents the UI from becoming the source of truth.

## 5. Verification protocol and latest evidence

### Environment

- Windows development machine
- Node `v24.10.0`
- pnpm `11.8.0`
- SQLite through `node:sqlite` (experimental warning expected)

### Latest recorded run: 2026-10-31

| Command | Result | Evidence |
| --- | --- | --- |
| `pnpm test` | PASS | 7 test files, 86 tests passed |
| `pnpm typecheck` | PASS | `apps/web`, `packages/core`, `apps/api`, `apps/worker` |
| `pnpm build` | PASS | Web JS 326.87 kB (gzip 96.07 kB), CSS 61.47 kB (gzip 11.31 kB), API bundle 2.3 MB, worker bundle 2.2 MB |
| `pnpm smoke` | PASS | `modelCalls=5 tokens=250 artifacts=3 mockRequests=5` |
| Axle status check | CLEAN | `main...origin/main`, HEAD `9bcedfb3839979c4bb3c0390a47d99c57030a516` |

Test breakdown: security 29, store 14, domain/config/validation 14, providers 9, planner 9, structured JSON 7, engine end-to-end 4. Full inventory: [Implementation Status](../IMPLEMENTATION_STATUS.md#4-test-inventory).

### What the evidence proves

- The core runtime works with a scripted provider and an in-memory SQLite database.
- The built API works end-to-end with a mock OpenAI-compatible server over HTTP.
- Authentication, run completion, review, final artifact creation, accounting, and artifact download work through the built server.
- Every workspace package compiles and bundles.

### What it does not prove

- A live commercial model provider works with the current prompts.
- Telegraph x402 settlement succeeds on a funded testnet wallet.
- A remote MCP server or GitHub write succeeds.
- A third-party extension endpoint succeeds.
- Browser interactions, responsive layout, and accessibility meet a formal standard.
- SQLite or the worker loop performs under concurrent load.
- Restart recovery has been exercised with a file-backed database across a real process restart. The persistence and lease logic are tested at repository/engine level, not as a crash test.

## 6. v0.1 release gates

- [x] Product workspace installs and builds.
- [x] All 86 automated tests pass.
- [x] Typecheck passes for every package.
- [x] Production bundles build.
- [x] Mock-model API smoke passes.
- [x] No consequential action bypasses backend policy in the tested matrix.
- [x] Approval denial and expiry paths are covered.
- [x] Documentation matches implemented behavior; known gaps are stated.
- [x] Original Axle checkout is unchanged.

## 7. External verification gates

These gates are deliberately outside the locally testable boundary. Each must be completed before making a corresponding production claim.

| Gate | Blocked on | Acceptance evidence |
| --- | --- | --- |
| Live model run | A commercial or local model endpoint and key | A real goal completes with recorded token usage, artifacts, review, and final output |
| Telegraph purchase | A funded testnet burner wallet and a live devnode quote | An approved purchase settles, receipt headers are stored, and the price stays within the approved ceiling |
| Remote MCP server | A reachable HTTP MCP server, or a known stdio server | `connect` discovers tools, a read call succeeds, a write call requires approval |
| GitHub write | A GitHub token with issue-create permission | A test issue is created in a disposable repository and recorded in the audit trail |
| Extension endpoint | A controlled HTTPS endpoint | An enabled manifest loads, an approval is shown, and the call records the response |
| Browser end-to-end | A Playwright (or equivalent) harness | Create, observe, approve, and download flows pass in a real browser |
| Load and concurrency | A benchmark environment | Documented latency, SQLite contention behavior, and worker lease behavior under load |

Do not report a gate as passing based on unit tests, typecheck, or the mock smoke test.

## 8. Hardening roadmap

### P0 - Before any shared or non-loopback deployment

1. **Fail closed on bind address.** Refuse to start on a non-loopback host when `SWARM_API_TOKEN` is unset. The current server warns but does not block.
2. **Rate limiting and auth throttling.** Add per-IP request limits and failed-token lockout at the API or reverse proxy.
3. **Tool-registry invariants.** Add a startup/test invariant that every registered tool declares a valid risk, source, and approval requirement, and that unknown tools can never be treated as read-allowed.
4. **MCP egress policy.** HTTP MCP URLs currently bypass the private-address SSRF guard by design for local-first use. Add an explicit host allowlist or opt-in for hosted deployments, and keep stdio MCP disabled by default outside local use.
5. **Extension authentication.** v0.1 supports no extension auth. Either add encrypted header injection or keep extensions disabled for all shared deployments.
6. **Artifact and database growth.** Add artifact size limits, retention policy, and backup/restore guidance that keeps `swarm.db` and the encryption key together.
7. **Key lifecycle.** Add key rotation and a documented recovery procedure for a lost encryption key.
8. **Dependency and penetration review.** Run a dependency audit and an external security review before exposing the control plane.

### P1 - Scale and operations

- Implement the Postgres `Store` behind the existing repository seam and test migrations against it.
- Add a Redis/BullMQ or managed queue for multi-worker deployments; define cross-worker idempotency and lease semantics.
- Move artifact content to object storage with signed downloads.
- Add OpenTelemetry traces and metrics, plus structured log shipping.
- Add workspace-level cost budgets and provider failover.
- Add backup automation and restore drills.

### P2 - Product depth

- Add identity, organizations, RBAC, SSO, and per-tenant row isolation.
- Add scheduled runs and event triggers.
- Add artifact versioning, comments, and collaborative review.
- Add a domain-pack authoring and validation surface.
- Add formal accessibility (WCAG) review and localization.
- Add richer approval policies, such as amount thresholds, allowed-recipient lists, and time windows.

### P3 - Verification depth

- Add API route contract tests for auth, validation, and error shapes.
- Add a Playwright browser suite for the command, run, approval, and artifact flows.
- Add a file-backed restart test and a worker-crash/lease-recovery test.
- Add an opt-in live integration suite behind environment flags, with recorded fixtures for CI.
- Add a prompt-injection corpus and artifact XSS regression tests.
- Benchmark SQLite writes and worker throughput under concurrent runs.

## 9. Release checklist

Run from `swarm/`:

```powershell
pnpm test
pnpm typecheck
pnpm build
pnpm smoke
```

Then:

- [ ] Confirm `docs/` and `IMPLEMENTATION_STATUS.md` reflect the commands actually run.
- [ ] Confirm `.env` is not committed and `data/` is ignored.
- [ ] Confirm the Axle checkout is still clean and at the recorded HEAD.
- [ ] Confirm no live integration is described as verified without evidence.
- [ ] Record the exact commit or working-tree state used for the release.
- [ ] Back up the encryption key separately from the database.

## 10. Non-goals for v0.1

- Hosted multi-tenant SaaS, billing, organizations, RBAC, or SSO.
- Shell, terminal, browser automation, local filesystem writes, or arbitrary code execution.
- Git push, pull requests, or deployments.
- RAG/vector memory or long-term autonomous schedules.
- Mid-run human chat; approvals are the only mid-run interaction.
- Postgres/Redis deployment. Only the migration path is documented.
- Desktop or mobile clients.

These are product boundaries, not hidden gaps. Any change to them needs an explicit architecture and security review.
