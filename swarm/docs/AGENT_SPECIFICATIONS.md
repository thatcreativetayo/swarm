# SWARM — Agent and Workforce Specifications

**Version:** 0.1  
**Last updated:** 2026-10-31  
**Related:** [Architecture](ARCHITECTURE.md), [Tool Runtime](TOOL_RUNTIME.md), [Data Model](DATA_MODEL.md)

---

## 1. Workforce model

A SWARM workforce is created per run. It is not a fixed roster and it is not a chat persona. The model acts as a **workforce architect** using declarative domain packs; the backend validates and materializes the plan.

```text
Goal
  → Goal interpretation (domains, deliverables, constraints, risks)
  → Workforce plan (agents + task DAG)
  → Validation (packs, limits, DAG, coverage)
  → Materialized agents/tasks in SQLite
  → Agent loop per ready task
  → Independent review
  → Lead synthesis
```

The plan is constrained by:

- `SWARM_MAX_AGENTS` (default 8, max 12) and workspace `maxAgents`;
- `SWARM_MAX_TASKS` (default 12, max 24) and workspace `maxTasks`;
- four domain packs maximum;
- known pack/agent definitions;
- unique keys;
- backward-only dependencies, no cycles;
- at least one task for every working agent, except an optional reviewer.

## 2. Domain pack contract

Each pack is a validated `DomainPack`:

```ts
{
  key, name, description, keywords,
  agents: AgentDefinition[],
  taskTemplates: TaskTemplate[],
  workflows: Workflow[],
  toolRequirements: ToolRequirement[],
  evaluationRules: string[]
}
```

An `AgentDefinition` contains:

| Field | Purpose |
| --- | --- |
| `key` | Stable role id within the pack. |
| `name`, `role` | Display and prompt identity. |
| `responsibilities` | Role contract injected into the prompt. |
| `capabilities`, `skills` | Planning/context description. |
| `allowedTools` | Native tool allowlist. Must reference registered tool names. |
| `requiredContext` | Human-readable context needs. |
| `inputSchema`, `outputSchema` | Declared contracts (descriptive; the runtime output schema is enforced in code). |
| `evaluationCriteria` | Quality expectations used by prompts and plan templates. |
| `permissionBoundaries` | Role-specific constraints injected into the prompt. |
| `defaultModel` | Optional model override. |
| `maxSteps` | Per-agent turn cap, further bounded by `SWARM_MAX_TOOL_STEPS`. |

Non-native tools (MCP and extensions) are added to every agent regardless of `allowedTools`; policy still gates them. Native tools are filtered strictly.

## 3. Pack catalogue

### 3.1 Business & Entrepreneurship (`business`)

Tasks: `market_scan`, `strategy`, `financial_model`, `go_to_market`  
Workflow: `business_launch`: market scan → strategy → financial model → go-to-market

| Agent | Role | Native tools | Steps |
| --- | --- | --- | ---: |
| `market_researcher` | Evidence-first market and competitor researcher | web_fetch, http_request, memory search/write, artifact_write, Telegraph discover/quote/purchase/signal | 6 |
| `business_strategist` | Strategy and business-model architect | memory search/write, artifact_write, web_fetch | 5 |
| `financial_analyst` | Financial modelling and unit-economics analyst | memory search/write, artifact_write | 5 |
| `marketing_strategist` | Go-to-market and content strategist | web_fetch, memory search/write, artifact_write | 5 |
| `operations_specialist` | Operating-model and execution designer | memory search/write, artifact_write | 5 |

Boundary: research and drafting; no external contact; paid Telegraph intelligence only through explicit purchase approval.

### 3.2 Education & Learning (`education`)

Tasks: `learning_plan`, `core_lesson`, `resources`, `practice_assessment`  
Workflow: `learning_sprint`: plan → lesson → resources → assessment

| Agent | Role | Native tools | Steps |
| --- | --- | --- | ---: |
| `learning_planner` | Curriculum and learning-path designer | memory search/write, artifact_write, web_fetch | 5 |
| `tutor` | Patient subject tutor and explainer | memory search/write, artifact_write, web_fetch | 5 |
| `research_assistant` | Source-finding and synthesis assistant | web_fetch, http_request, memory search/write, artifact_write | 6 |
| `assessment_coach` | Practice and assessment designer | memory search/write, artifact_write | 5 |

### 3.3 Software Development (`software`)

Tasks: `requirements`, `ux_spec`, `implementation`, `test_plan`, `delivery_plan`  
Workflow: `software_build`: requirements → UX spec → implementation → test plan → delivery plan

| Agent | Role | Native tools | Steps |
| --- | --- | --- | ---: |
| `product_manager` | Product definition and scope owner | memory search/write, artifact_write, web_fetch | 5 |
| `ux_designer` | User-experience and interface designer | memory search/write, artifact_write, web_fetch | 5 |
| `software_engineer` | Implementation and architecture engineer | memory search/write, artifact_write, web_fetch, GitHub repo read, GitHub issue create | 6 |
| `qa_engineer` | Quality and test strategy engineer | memory search/write, artifact_write, web_fetch | 5 |
| `devops_specialist` | Delivery, operations, and reliability planner | memory search/write, artifact_write, web_fetch | 5 |

Important: this pack produces **plans, specifications, and optional GitHub issues**, not code changes in the user's repository. There is no shell, filesystem write, Git push, or pull-request tool. The GitHub issue tool always requires approval.

### 3.4 Career Development (`career`)

Tasks: `opportunity_scan`, `cv_tailoring`, `application_plan`, `interview_prep`  
Workflow: `job_search`: scan → CV tailoring → application plan → interview prep

| Agent | Role | Native tools | Steps |
| --- | --- | --- | ---: |
| `opportunity_researcher` | Job-market and opportunity researcher | web_fetch, http_request, memory search/write, artifact_write | 6 |
| `cv_specialist` | Resume and application-material writer | memory search/write, artifact_write | 5 |
| `application_strategist` | Application and outreach strategist | memory search/write, artifact_write | 5 |
| `interview_coach` | Interview preparation and practice coach | memory search/write, artifact_write | 5 |

Boundary: drafting and preparation; no automated outreach or applications.

### 3.5 Health Information (`health`)

Tasks: `health_information`, `appointment_brief`  
Workflow: `appointment_prep`: health information → appointment brief

| Agent | Role | Native tools | Steps |
| --- | --- | --- | ---: |
| `health_information_specialist` | Evidence-based general health information guide | web_fetch, memory search/write, artifact_write | 6 |
| `appointment_prep_coach` | Clinician-appointment preparation assistant | memory search/write, artifact_write | 4 |

Hard safeguards:

- Information and appointment preparation only.
- No diagnosis, prescribing, or emergency-care claims.
- Policy denies `purchase` and `destructive` risk in this pack.
- Prompts explicitly prohibit diagnosis, prescribing, and emergency care.
- Web sources should be reputable; citations are expected.

This is not a medical device or clinical service.

### 3.6 General Execution (`general`)

Tasks: `research`, `analysis`, `final_deliverable`  
Workflow: `general_execution`: research → analysis → final deliverable

| Agent | Role | Native tools | Steps |
| --- | --- | --- | ---: |
| `researcher` | General-purpose evidence researcher | web_fetch, http_request, memory search/write, artifact_write, Telegraph discover/quote/purchase/signal | 6 |
| `analyst` | Structured problem analyst | memory search/write, artifact_write, web_fetch | 5 |
| `writer` | Clear, audience-aware deliverable writer | memory search/write, artifact_write | 4 |
| `reviewer` | Independent quality and risk reviewer | memory search, artifact_write | 4 |

The reviewer is an optional plan member and is also used conceptually by the global review stage. The global review always runs, even if no reviewer agent was materialized.

## 4. Planning behavior

### 4.1 Model planner

The planner prompt:

- states SWARM is universal and must not default to a coding team;
- supplies the entire pack catalog with agent capabilities, tools, task templates, and dependencies;
- requires the smallest specialist team;
- gives hard agent/task limits;
- requires every working agent to have at least one task;
- permits one independent reviewer with no task;
- requires backward-only dependencies and no cycles;
- includes workspace policy (external HTTP writes, read-only MCP auto-approval).

The model returns `WorkforcePlan`: agents (`key`, `definitionKey`, `domainPack`, `name`, `role`, `rationale`) and tasks (`key`, title, description, `agentKey`, `dependsOn`, deliverable, criteria, priority), plus notes.

### 4.2 Validation

`validateWorkforcePlan` rejects:

- unknown domain pack;
- unknown agent definition for a pack;
- duplicate plan agent/task keys;
- task referencing an unknown plan agent;
- forward/unknown dependency;
- duplicate dependency;
- working agent with no task;
- limits exceeded;
- empty plan members.

A valid plan gets materialized. Invalid plans get one corrective retry with the validation errors in the prompt.

### 4.3 Deterministic fallback

If the model cannot produce a valid plan:

1. Select up to three requested domains that exist, otherwise `general`.
2. Prefer the pack's longest workflow that fits the remaining task/agent budget.
3. Otherwise select task templates in order, respecting remaining agents.
4. Add a synthesis task (general writer) when there is task budget and more than two task slots.
5. Add a general reviewer when agent budget allows.
6. Enforce both `maxAgents` and `maxTasks` exactly.

Fallbacks are labelled in the run activity as `planning_warning` and `plan_created` with `fallback: true`.

## 5. Agent runtime contract

### 5.1 Inputs

Each task gets:

- original goal and interpreted objective/deliverables;
- assigned task title, description, deliverable, evaluation criteria;
- role responsibilities, capabilities, permission boundaries;
- relevant workspace memories (keyword search, max 8);
- dependency outputs (bounded to ~30,000 characters total, each deliverable excerpt ≤6,000);
- allowed tools with risk and approval flags;
- turn limit.

### 5.2 System prompt

The system prompt establishes:

- specialist identity and domain;
- run goal and task contract;
- prior work and memory (content, not instructions);
- available tools;
- operating rules: evidence discipline, no invented sources/numbers/actions, use tools only when useful, approvals pause the run, denied calls must be adapted to, no secrets, health limits;
- output JSON schema;
- maximum turns.

The user prompt asks the agent to complete the task and return only the JSON.

### 5.3 Output schema

```json
{
  "summary": "string",
  "findings": ["string"],
  "deliverable": {
    "title": "string",
    "format": "markdown | text | json | csv | html",
    "content": "string"
  },
  "citations": [{ "title": "string", "url": "string (optional)" }],
  "confidence": 0.0,
  "openQuestions": ["string"],
  "needsHumanReview": false
}
```

Validation failure triggers a correction prompt. After two correction attempts the task fails with a clear error.

On success the runtime:

- creates a `deliverable` artifact;
- stores the output JSON on the task;
- upserts a compact memory summary;
- deletes the task runtime checkpoint;
- records activity and run events.

### 5.4 Turns and tool calls

- `maxTurns = clamp(agentDefinition.maxSteps, 2, serverMaxToolSteps)`.
- Each model response with tool calls consumes a turn; tools execute sequentially.
- Tool calls are capped at `maxTurns * 3` to prevent runaway tool loops.
- Model calls are budget-checked before each turn.
- Tool execution has a server-side timeout (`SWARM_TOOL_TIMEOUT_MS`, default 60s) and receives the task's abort signal.
- Tool output sent back to the model is truncated to 30,000 characters.

### 5.5 Approvals and denials

- On approval, the loop resumes from the persisted pending call, not from a fresh plan.
- The approved call is executed once.
- A denied/expired call is reported to the model as a failed tool with instructions to adapt.
- The model cannot retry the exact write call automatically because the idempotency key prevents a duplicate execution.

### 5.6 Cancellation and failure

- Cancellation is checked before model calls and each tool call.
- Budget errors are classified (`model_call_limit`, `token_limit`, `timeout`, `turn_limit`, `tool_call_limit`, `cancelled`).
- Limit failures fail the run; ordinary task errors may retry within `maxAttempts`.
- A blocked workflow with no runnable tasks fails the run rather than hanging.

## 6. Review and synthesis

### 6.1 Review

The reviewer receives:

- original goal and interpretation;
- every completed task's summary and deliverable excerpt;
- tool activity statuses and errors;
- approval titles/statuses.

It returns `pass | revise | fail`, criteria results, issues, and recommended actions. The review is stored as `quality-review.md`.

Fallback if the reviewer call/parse fails:

- verdict `pass` (to avoid falsely failing a completed run);
- summary explicitly says the automated reviewer could not complete;
- issue names the reviewer error;
- recommended action is manual review.

This fallback is intentionally visible and recorded as `review_fallback`.

### 6.2 Final synthesis

The lead synthesizer receives every completed output and is told to integrate rather than concatenate, resolve contradictions, make recommendations explicit, avoid hidden reasoning/model names, and produce a self-contained markdown document.

Fallback if synthesis fails or returns empty:

- a markdown document that concatenates specialist deliverables;
- a visible blockquote saying automated synthesis was unavailable.

The run is completed only after the final artifact is stored.

## 7. Agent status and lifecycle

| Agent status | Meaning |
| --- | --- |
| `idle` | Created, waiting for work or reset after a retry. |
| `working` | At least one assigned task is running. |
| `awaiting_approval` | At least one assigned task is suspended. |
| `done` | All assigned tasks completed/skipped. |
| `failed` | Assigned task failed or run failed before completion. |

Agent status is derived from its tasks by `refreshAgentStatuses()` after task settlement and approval.

## 8. Model selection

- Provider/model defaults come from config.
- An agent definition may set `defaultModel`; otherwise the run model is used.
- The current packs do not set per-agent models, so all agents use `SWARM_LLM_MODEL`.
- Interpretation, planning, review, and finalization use the run model.
- Per-agent model overrides are supported by the schema and prompt construction.

## 9. Extending the workforce

To add a domain pack:

1. Copy the `DomainPack` shape in `packages/core/src/domain/types.ts`.
2. Add agents with valid tool names and evaluation criteria.
3. Add tasks with backward-only dependencies.
4. Add an optional workflow.
5. Register the pack in `packages/core/src/domain/index.ts`.
6. Run `pnpm test`; the domain validator and allowlist test catch broken references.

To add a native tool:

1. Implement `SwarmTool` with an explicit `risk`, `source`, approval flag, schema, and timeout-aware execution.
2. Register it in `createNativeToolRegistry()`.
3. Add it to relevant agent allowlists if it should be usable.
4. Add policy tests for its risk class.
5. Document live-verification status.

Planner prompts automatically include pack agents/tasks; no separate prompt registry is required.

## 10. Limitations

- The model chooses the team; it can choose an inefficient or mismatched roster. Plan validation only enforces structural safety, not quality.
- No human editing of the plan before execution.
- No mid-run chat or task reassignment.
- No parallel task execution within a single worker loop.
- No vector memory; keyword overlap only.
- No formal agent evaluation harness against live outputs.
- Health pack is intentionally narrow and non-clinical.
- Software pack does not edit code.
