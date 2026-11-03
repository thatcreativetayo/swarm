# SWARM — Product Requirements Document

**Version:** 0.1  
**Status:** Implemented local-first MVP  
**Last updated:** 2026-10-31  
**Related documents:** [Architecture](ARCHITECTURE.md), [Build Plan](BUILD_PLAN.md), [Implementation Status](../IMPLEMENTATION_STATUS.md)

---

## 1. Product definition

SWARM is a universal autonomous AI workforce delivered through a web command center. A user states an outcome in natural language. SWARM then:

1. interprets the goal and its constraints;
2. designs a small team of specialist agents;
3. creates and executes a dependency-aware task graph;
4. performs real actions through explicitly permitted tools;
5. pauses before consequential actions and asks the user;
6. produces specialist artifacts, an independent review, and a final deliverable;
7. leaves a complete, inspectable audit trail.

SWARM is **not** a coding assistant, an IDE, or a chat wrapper around a single agent. Coding is one domain among several. The product's core object is a **run**, not a conversation or repository.

## 2. Problem

General-purpose AI assistants are strong at generating text but weak at owning an outcome:

- They do not reliably decompose a goal into a team and a work plan.
- They lose state when work pauses or a process restarts.
- They take consequential actions without a clear permission boundary.
- They do not preserve a trustworthy record of what was attempted, approved, or failed.
- They collapse every domain into a generic "assistant" rather than using domain-specific roles, criteria, and guardrails.
- Desktop-first coding agents bind orchestration to a local machine, a repository, and a developer workflow.

SWARM addresses these gaps with a web-first, domain-neutral orchestration layer: dynamic workforce planning, a persisted task runtime, backend-enforced permissions, artifacts, and auditable execution.

## 3. Target users

| User | Need |
| --- | --- |
| Founder / operator | Turn a business question into research, strategy, financials, and a launch plan without assembling a team by hand. |
| Knowledge worker / analyst | Delegate a multi-step research or decision task and receive traceable deliverables. |
| Educator / learner | Build a structured learning sprint with lessons, resources, and assessment. |
| Software product team | Produce requirements, UX, implementation plans, test strategy, and delivery plans as coordinated artifacts. |
| Job seeker | Run a focused job-search sprint from opportunity research through interview preparation. |
| Health-information user | Prepare questions and an appointment brief from reputable information, without diagnosis or prescribing. |
| Developer / operator | Extend the workforce with MCP servers and declarative HTTP tools while retaining approval control. |

## 4. Product principles

1. **Outcome first.** The run is the unit of work. Chat is an input, not the product.
2. **Universal by design.** The planner selects from multiple domain packs and may combine up to four. Coding must never be the default team.
3. **Smallest sufficient team.** The planner is instructed to design the smallest specialist team that can meet the goal, within hard caps.
4. **Real execution, bounded authority.** Agents can act through tools, but the backend — not the prompt or UI — decides what is allowed.
5. **Approval is a first-class state.** Consequential actions suspend work durably and resume only after a decision.
6. **Nothing important is hidden.** Jobs, model calls, tool calls, approvals, artifacts, and errors are recorded and visible.
7. **Honest failure.** Fallbacks are labelled. Failed tools are reported as failures. Unverified integrations are documented as unverified.
8. **Local-first and portable.** One command starts a complete system with SQLite. No Docker, Postgres, Redis, or cloud account is required for the MVP.
9. **No arbitrary code execution in the product runtime.** There is no shell, filesystem-write, process-spawn, or arbitrary-code tool. Extensions are declarative HTTP manifests.
10. **Server-side credentials only.** Model keys, integration tokens, MCP headers, and payment keys never reach the browser.

## 5. Jobs to be done

- "I need a market-entry brief with evidence, a strategy, and a financial view."
- "I need a four-week learning plan with lessons, resources, and a practice assessment."
- "I need a product requirements document, UX flows, implementation plan, and QA plan."
- "I need my CV tailored to this role and a realistic interview-prep plan."
- "I need to prepare for a medical appointment without being diagnosed by a chatbot."
- "I need a custom workflow that calls my internal HTTP service, but only after I approve each call."
- "I need to buy one piece of specialist intelligence, with a visible price and an explicit approval."

## 6. Functional requirements

Status legend:

- **Tested** — covered by automated tests or the mock-model smoke test.
- **Implemented, unverified** — code exists and typechecks, but no live external service was exercised.
- **Partial** — a usable subset exists with known gaps.
- **Not built** — explicitly out of the current release.

### 6.1 Goal intake and interpretation

| ID | Requirement | Status |
| --- | --- | --- |
| FR-1 | Accept a natural-language goal of 10–20,000 characters. | Tested |
| FR-2 | Interpret title, objective, domains, deliverables, constraints, risks, complexity, and research/action flags. | Tested |
| FR-3 | Validate model interpretation and fall back deterministically on invalid output. | Tested |
| FR-4 | Count interpretation model calls against the run budget. | Tested |
| FR-5 | Show interpretation and planning activity in the UI. | Tested via API/UI implementation |

### 6.2 Dynamic workforce planning

| ID | Requirement | Status |
| --- | --- | --- |
| FR-6 | Build a goal-specific plan from six domain packs, combining up to four packs. | Tested |
| FR-7 | Enforce per-run and per-workspace agent/task caps. | Tested |
| FR-8 | Validate unique keys, known agents/packs, acyclic dependencies, dependency ordering, and every working agent having work. | Tested |
| FR-9 | Retry an invalid plan once with validation feedback. | Tested |
| FR-10 | Fall back to a deterministic domain-template plan within limits. | Tested |
| FR-11 | Allow a reviewer agent without an assigned task. | Tested |

### 6.3 Execution runtime

| ID | Requirement | Status |
| --- | --- | --- |
| FR-12 | Materialize agents and tasks with durable statuses. | Tested |
| FR-13 | Schedule only dependency-ready tasks; detect blocked workflows. | Tested |
| FR-14 | Persist the agent loop state across process restarts and approval suspensions. | Tested for approval suspension; restart recovery is implemented via SQLite task runtime and job leases |
| FR-15 | Support tool calling with per-tool input validation, result truncation, and error feedback to the model. | Tested for native tools; external tool arguments are passed through to the provider/MCP server |
| FR-16 | Enforce per-run model-call, token, wall-clock, task-attempt, and tool-call limits. | Tested for the main paths; budget errors are scripted |
| FR-17 | Support cancellation at run, task, and approval boundaries. | Tested |
| FR-18 | Retry failed tasks up to a configured limit with backoff. | Tested at repository/engine level |
| FR-19 | Preserve idempotency for write-like tool calls. | Tested at repository level; live external deduplication depends on the provider |
| FR-20 | Deduplicate jobs by idempotency key and recover expired leases. | Tested |

### 6.4 Approvals and permissions

| ID | Requirement | Status |
| --- | --- | --- |
| FR-21 | Suspend on purchases, destructive actions, declared-approval tools, external writes, MCP writes, and extension calls. | Tested by policy matrix and end-to-end approval scenario |
| FR-22 | Always require approval for purchases and destructive actions. | Tested |
| FR-23 | Deny all purchases/destructive actions in health workflows. | Tested |
| FR-24 | Deny shell, exec, filesystem-write, and process-spawn tools unconditionally. | Tested |
| FR-25 | Expire overdue approvals and resume the agent with a denial. | Tested at store/engine level |
| FR-26 | Let the agent adapt after a denial without executing the action. | Tested (approval denial scenario) |
| FR-27 | Persist approval arguments with sensitive keys redacted. | Tested |
| FR-28 | Allow a workspace to auto-approve only MCP tools the server marks read-only. | Tested |
| FR-29 | Keep external HTTP writes disabled unless a workspace enables them; still require approval when enabled. | Tested |

### 6.5 Artifacts, review, and completion

| ID | Requirement | Status |
| --- | --- | --- |
| FR-30 | Store each completed specialist deliverable as an artifact with title, format, filename, MIME type, and content. | Tested |
| FR-31 | Support markdown, text, JSON, CSV, and HTML artifacts. | Partially tested (markdown end-to-end; other formats are implemented but not exercised end-to-end) |
| FR-32 | Produce an independent review artifact with verdict, criteria, issues, and next actions. | Tested |
| FR-33 | Use a visible fallback review when the reviewer model fails. | Implemented |
| FR-34 | Produce a final synthesized markdown artifact. | Tested |
| FR-35 | Use a clearly labelled fallback when final synthesis fails. | Implemented |
| FR-36 | Allow artifact download with safe filename and content headers. | Tested in smoke |
| FR-37 | Mark the run completed only after the final artifact is stored. | Tested |

### 6.6 Memory and context

| ID | Requirement | Status |
| --- | --- | --- |
| FR-38 | Provide workspace memory search and write tools. | Tested at repository level |
| FR-39 | Inject goal, memories, dependencies, role definition, tools, and limits into the agent prompt. | Implemented |
| FR-40 | Write a compact run/task summary to workspace memory after each deliverable. | Implemented |
| FR-41 | Avoid embedding-based semantic memory. | Intentional limitation (keyword search) |

### 6.7 Integrations and extensions

| ID | Requirement | Status |
| --- | --- | --- |
| FR-42 | Register encrypted integration credentials by workspace and provider. | Tested |
| FR-43 | Provide GitHub repository read and issue creation. | Implemented, unverified live |
| FR-44 | Provide MCP over HTTP and stdio with discovery and calls. | Implemented, unverified against remote servers |
| FR-45 | Encrypt MCP headers and environment secrets at rest. | Tested at repository level |
| FR-46 | Load declarative HTTP extension manifests, disabled by default. | Implemented |
| FR-47 | Require approval for every extension call. | Tested by policy matrix |
| FR-48 | Provide Telegraph miner discovery, quote, paid request, and signal verification. | Implemented, unverified live |
| FR-49 | Require approval and a price ceiling for every Telegraph purchase. | Tested at policy/tool code level; no live settlement |

### 6.8 Command center

| ID | Requirement | Status |
| --- | --- | --- |
| FR-50 | Provide a web UI for goals, runs, workforce, tasks, approvals, artifacts, activity, integrations, and settings. | Implemented and built |
| FR-51 | Stream run events with SSE and fall back to polling. | Implemented |
| FR-52 | Show pending approvals with redacted arguments and a decision reason. | Implemented |
| FR-53 | Render markdown safely. | Implemented |
| FR-54 | Support an optional bearer token and preserve it locally. | Implemented and smoke-tested |
| FR-55 | Show unconfigured model state instead of pretending the system can execute. | Implemented |

### 6.9 Operations

| ID | Requirement | Status |
| --- | --- | --- |
| FR-56 | Run API plus inline worker with one command. | Tested via smoke |
| FR-57 | Support a separate worker process against the same database. | Built and typechecked; concurrent-worker behavior not load-tested |
| FR-58 | Expose health, settings, bootstrap, and domain-pack discovery endpoints. | Tested/implemented |
| FR-59 | Recover expired job leases and expire approvals on a sweep. | Tested at store level; worker sweep implemented |
| FR-60 | Provide honest startup warnings for missing model, missing token, and unconfigured payments. | Implemented |

## 7. User journeys

### 7.1 Knowledge-work run

1. User opens Command and enters: "Build an evidence-based market entry brief for a new product."
2. SWARM interprets the goal as business research with medium complexity.
3. The planner selects a Market Researcher and perhaps a strategist, with a research task.
4. The researcher calls `web_fetch` for public sources and writes a deliverable artifact.
5. A reviewer checks completeness and assumptions.
6. The lead synthesizes a final brief.
7. The user reviews the workforce, tasks, tool calls, review, and final artifact.

### 7.2 Approval-gated external action

1. An agent proposes an external write, purchase, or extension call.
2. Backend policy creates an approval and suspends the task; the run becomes `awaiting_approval`.
3. The UI shows the tool, risk, redacted arguments, and reason.
4. **Approve:** SWARM resumes the same persisted tool call once, records the result, and continues.
5. **Deny:** the tool never runs; the agent receives a denial message and must adapt.
6. Expiry is treated as a timeout/denial and resumes the agent so the run does not hang forever.

### 7.3 Telegraph intelligence purchase

1. A research agent discovers miners (free) and requests a quote (free).
2. It requests `telegraph_purchase` with a `maxPriceUsd` ceiling.
3. Policy requires approval; the UI displays the requested action.
4. On approval, the x402 client checks the current quote against the ceiling and pays with the server-side burner key.
5. The result and payment/receipt headers are stored; failed calls are not charged.
6. The signal hash can be checked later with `telegraph_signal`.

## 8. UX requirements

- Chat-first command surface with a premium, dark, high-contrast visual language.
- One obvious primary action: describe the outcome and launch the workforce.
- Run detail separates overview, workforce, tasks, approvals, artifacts, activity, and trace views.
- Approval decisions are prominent and cannot be mistaken for routine activity.
- Status language is explicit: interpreting, planning, executing, awaiting approval, reviewing, completed, failed, cancelled.
- Artifacts are readable in-app and downloadable.
- Setup problems (no model, no token) are surfaced as actionable states.
- The UI does not expose provider keys, integration secrets, MCP headers, or payment keys.

## 9. Non-functional requirements

| Area | Requirement | Current state |
| --- | --- | --- |
| Security | Backend-enforced authorization and approval; encrypted secrets; SSRF protection. | Implemented; residual risks documented |
| Reliability | Durable state, retries, leases, cancellation, idempotency. | Implemented at MVP level |
| Auditability | Append-only run events plus relational activity, tool, model-call, approval, and artifact records. | Implemented |
| Portability | Node 24 + SQLite; no Docker required. | Verified on Windows |
| Performance | A small team and small task graph should complete within configured budgets. | Not benchmarked under load |
| Accessibility | Keyboard-operable controls, labels, focus states, contrast. | Implemented by inspection; no formal WCAG audit |
| Observability | Health/settings endpoints, structured logs, run trace. | Implemented; no OpenTelemetry export |
| Privacy | Local data by default; no telemetry. | Implemented (no analytics code) |

## 10. Success metrics

For the MVP, success is measured by correctness and trust, not scale:

- A valid goal completes end-to-end with every task settled and a final artifact. **Verified with mock model.**
- No consequential tool runs without a policy decision. **Covered by policy matrix and approval tests.**
- A denied approval never executes the underlying action. **Verified.**
- Model and token usage are accounted per call and per run. **Verified.**
- Every run can be explained from persisted jobs, events, tool calls, approvals, and artifacts. **Implemented.**
- A failed reviewer/synthesizer produces a labelled fallback, never a silent claim of success. **Implemented.**
- The system starts from a clean checkout with documented commands. **Verified on the development machine.**
- Live-provider completion rate, cost per successful run, and time-to-artifact remain to be measured once a real key is available.

## 11. Release scope

### In scope for v0.1

- Six domain packs and dynamic planning.
- Persisted task execution with native tools.
- Approval-gated external actions.
- Artifacts, review, final synthesis.
- Web command center with SSE/polling.
- MCP HTTP/stdio, declarative HTTP extensions, GitHub, Telegraph tools.
- SQLite persistence, local-first setup, standalone worker.
- Automated tests and mock-model smoke.

### Explicitly out of scope

- Hosted multi-tenant SaaS, organizations, RBAC, SSO, billing.
- Mobile and desktop clients.
- Shell, terminal, browser automation, local filesystem writes, arbitrary code execution.
- Git push, pull requests, deployments.
- RAG/vector databases and long-term autonomous schedules.
- Human chat mid-run (approvals are the only mid-run interaction).
- Postgres/Redis deployment; only a migration path is documented.

## 12. Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Prompt injection through fetched web/MCP content | Agent attempts unsafe action | Tools are least-privilege; external actions require approval; no shell/filesystem tools; content is treated as untrusted. |
| Model produces invalid plans or deliverables | Run fails or degrades | Schema validation, one plan retry, deterministic plan fallback, two output-correction turns, labelled review/final fallbacks. |
| Approval fatigue | User rubber-stamps actions | Clear risk labels, redacted arguments, per-workspace constraints, price ceilings; read-only MCP auto-approval is opt-in only. |
| Live integration drift | Unverified integrations break | Explicit unverified status, bounded timeouts, error capture, no claim of success on failure. |
| SQLite single-writer limits | Throughput ceiling | WAL, short transactions, leased jobs; Postgres/BullMQ path documented. |
| Secret leakage in logs/prompts | Credential compromise | Server-side secrets, AES-GCM, redaction, no secrets in public config, no secret-return API. |
| Over-automation in health | Harm | Health pack is information-only; policy denies purchases/destructive actions; prompts prohibit diagnosis, prescribing, and emergency care. |

## 13. Acceptance criteria

The MVP is acceptable when:

- [x] A clean install builds all packages and serves the web app.
- [x] A run can be created, interpreted, planned, executed, reviewed, and finalized end-to-end with a mock model.
- [x] Pending approvals suspend and resume the persisted task, and denial prevents execution.
- [x] The policy matrix covers read, internal write, external, purchase, destructive, MCP, extension, and health cases.
- [x] Artifacts can be listed, read, and downloaded.
- [x] The run exposes jobs, tool executions, model calls, approvals, activities, and usage.
- [x] The UI has command, run, workforce, task, approval, artifact, activity, integration, and settings surfaces.
- [x] The test suite, typecheck, build, and smoke pass.
- [x] Axle's original checkout is unchanged.
- [ ] A live commercial model completes a real goal. Blocked on an API key.
- [ ] A live Telegraph testnet purchase settles. Blocked on a funded burner wallet.
- [ ] A real remote MCP server and GitHub issue creation are exercised. Blocked on external credentials/services.
