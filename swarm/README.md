# SWARM

**A universal, web-first autonomous AI workforce.** You describe an outcome; SWARM interprets the goal, assembles a specialist team from domain packs, executes a dependency-aware task graph, pauses at consequential actions for approval, and produces reviewable artifacts.

SWARM is deliberately **not** a coding assistant. Software is one domain pack, not the product's centre of gravity.

> **Repository note:** this checkout was bootstrapped from an Axle clone so the reuse audit could be performed against a complete source tree. The SWARM product is the `swarm/` subdirectory. Everything outside it remains the copied Axle source and is not used by the SWARM runtime. The original Axle checkout at `C:\Users\Ariyo Eyitayo\Desktop\Axle` was never modified.

## Current status

This is a **runnable local-first MVP**, not a hosted production service. The core workflow is tested end-to-end against a mock OpenAI-compatible model server. Live model providers, live Telegraph payments, remote MCP servers, GitHub writes, and third-party extension endpoints have **not** been verified against real services. See [`IMPLEMENTATION_STATUS.md`](IMPLEMENTATION_STATUS.md) for the exact tested/unverified boundary.

- Backend: TypeScript, Hono, Node 24, SQLite (`node:sqlite`, WAL)
- Frontend: React 19 + Vite, hand-written premium dark CSS
- Runtime: persisted agent loop, leased job queue, append-only run events, SSE with polling fallback
- Storage: local SQLite; secrets encrypted with AES-256-GCM
- Default topology: API with inline worker. A standalone worker is included.

## Quick start

Requirements: Node **24+** (for `node:sqlite`) and pnpm 11.

```powershell
cd "C:\Users\Ariyo Eyitayo\Desktop\swarm\swarm"
pnpm install
Copy-Item .env.example .env
```

Generate an encryption key and put it in `.env`:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Configure a model provider in `.env`. For example:

```dotenv
SWARM_LLM_PROVIDER=openai
SWARM_LLM_API_KEY=sk-your-key
SWARM_LLM_MODEL=gpt-4.1-mini
```

For a local OpenAI-compatible server such as Ollama:

```dotenv
SWARM_LLM_PROVIDER=openai-compatible
SWARM_LLM_BASE_URL=http://127.0.0.1:11434/v1
SWARM_LLM_MODEL=your-model
# SWARM_LLM_API_KEY is optional for openai-compatible
```

Set an API token before exposing the service beyond loopback:

```dotenv
SWARM_API_TOKEN=choose-a-long-random-token
```

Run the production-style build:

```powershell
pnpm build
pnpm start
```

Open <http://127.0.0.1:8787>. If you set `SWARM_API_TOKEN`, paste it into the UI's connection screen; the browser stores it in `localStorage` under `swarm.apiToken`.

For development, with Vite hot reload on port 5173 and the API on 8787:

```powershell
pnpm dev
```

## Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Runs the API and Vite dev server together. |
| `pnpm dev:api` | Runs only the API (inline worker by default). |
| `pnpm dev:web` | Runs only the Vite web app, proxying `/api` to 8787. |
| `pnpm dev:worker` | Runs a standalone worker in watch mode. |
| `pnpm build` | Builds web, API, and standalone worker. |
| `pnpm start` | Starts the built API and serves the built web app. |
| `pnpm worker` | Starts the built standalone worker. |
| `pnpm test` | Runs the Vitest suite in `packages/core`. |
| `pnpm typecheck` | Typechecks every workspace package. |
| `pnpm smoke` | Boots a mock model + isolated API and verifies a full run. Requires `pnpm build`. |

To use a separate worker process, start the API with `SWARM_INLINE_WORKER=false` and run `pnpm worker` in another terminal against the same data directory. Only one worker loop per SQLite database is recommended in the current release.

## Configuration

All settings are environment variables. `.env` is loaded by the API; the standalone worker also loads `.env`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `SWARM_PORT` | `8787` | API port. |
| `SWARM_HOST` | `127.0.0.1` | Bind address. Keep loopback unless a token and network controls are in place. |
| `SWARM_DATA_DIR` | `./data` | SQLite database, generated encryption key, extension directory. |
| `SWARM_API_TOKEN` | unset | Bearer token for `/api/*`. `/api/health` stays public. If unset, the API is unauthenticated. |
| `SWARM_ENCRYPTION_KEY` | auto-generated | 32-byte base64 or 64-char hex key for integration/MCP secrets. Auto-generated to `data/.encryption-key` when unset. |
| `SWARM_LLM_PROVIDER` | unset | `openai`, `openrouter`, `anthropic`, or `openai-compatible`. |
| `SWARM_LLM_API_KEY` | unset | Provider key. Not required for `openai-compatible`. |
| `SWARM_LLM_MODEL` | provider default | Model id. |
| `SWARM_LLM_BASE_URL` | provider default | Base URL override. |
| `SWARM_MAX_AGENTS` | `8` | Per-run agent cap, clamped to 1–12. |
| `SWARM_MAX_TASKS` | `12` | Per-run task cap, clamped to 1–24. |
| `SWARM_MAX_TOOL_STEPS` | `6` | Per-agent turn cap, clamped to 1–12. |
| `SWARM_MAX_MODEL_CALLS` | `40` | Per-run model-call budget. |
| `SWARM_MAX_TOKENS` | `120000` | Per-run token budget. |
| `SWARM_RUN_TIMEOUT_MS` | `1800000` | Per-run wall-clock limit. |
| `SWARM_INLINE_WORKER` | `true` | Set `false` when running a separate worker. |
| `TELEGRAPH_NODE_URL` | testnet node | Telegraph engine node. |
| `TELEGRAPH_EVM_PRIVATE_KEY` | unset | Server-side burner wallet key for x402 payments. Prefer the encrypted Telegraph integration for production use. |
| `SWARM_ALLOW_STDIO_MCP` | `true` | Allow local stdio MCP processes. Set `false` for HTTP-only. |
| `SWARM_ENABLE_EXTERNAL_EXTENSIONS` | `false` | Load declarative HTTP extension manifests. |
| `SWARM_EXTENSION_DIR` | `./data/extensions` | Directory scanned for extension manifests. |

Workspace settings can further constrain a workspace: name, `maxAgents`, `maxTasks`, `allowExternalHttpWrites`, and `autoApproveReadOnlyMcp`. External writes remain approval-gated even when enabled.

## How a run works

1. **Goal interpretation** — the model converts the request into a bounded objective, domains, deliverables, constraints, and risk flags. Invalid model output falls back to a deterministic interpretation.
2. **Workforce planning** — the model proposes agents and a DAG of tasks using the domain-pack catalogue. Invalid plans are retried once, then replaced by a deterministic template plan within the agent/task limits.
3. **Execution** — each ready task runs a persisted agent loop. Agents can call native tools, connected MCP tools, and enabled extension tools. Tool risk is evaluated by backend policy.
4. **Approval** — purchases, destructive actions, declared-sensitive tools, external writes, MCP writes, and (by default) all extension calls suspend the task. The runtime state is persisted. Approving resumes from the same tool call; denying lets the agent adapt without performing the action.
5. **Review** — an independent reviewer checks completed work. If the reviewer model fails, a visible fallback review is produced rather than pretending the review succeeded.
6. **Finalization** — the lead synthesizes specialist outputs into a final markdown artifact. If synthesis fails, the fallback concatenates specialist deliverables with an explicit warning.
7. **Audit** — every state change, tool call, candidate approval, model call, artifact, and job is stored. The UI streams run events over SSE and falls back to polling.

Every run enforces model-call, token, time, task-attempt, and tool-call limits. Cancellation marks pending work cancelled and blocks new jobs.

## Domain packs

SWARM ships with six declarative packs:

| Pack | Specialists | Tasks | Workflow |
| --- | ---: | ---: | --- |
| Business & Entrepreneurship | 5 | 4 | market scan → strategy → financial model → go-to-market |
| Education & Learning | 4 | 4 | learning plan → core lesson → resources → practice |
| Software Development | 5 | 5 | requirements → UX → implementation → test plan → delivery |
| Career Development | 4 | 4 | opportunity scan → CV tailoring → application plan → interview prep |
| Health Information | 2 | 2 | health information → appointment brief |
| General Execution | 4 | 3 | research → analysis → final deliverable |

Health is information and appointment-preparation support only. Its policy forbids purchases, destructive actions, diagnosis, prescribing, and emergency-care claims. It is not a medical service.

The planner is not limited to these templates: the model can combine up to four packs and propose a goal-specific team. The packs supply role definitions, tools, output contracts, and a safe deterministic fallback.

## Tools, MCP, extensions, and Telegraph

- **Native tools:** artifacts, workspace memory, public web fetch/HTTP, GitHub read/issue creation, and Telegraph discovery/quote/purchase/signal.
- **MCP:** HTTP and stdio JSON-RPC clients with initialize, paginated `tools/list`, and `tools/call`. Headers and environment variables are encrypted at rest. MCP tools are external and approval-gated by default; a workspace can opt into auto-approving tools the server marks read-only. See [`docs/MCP_INTEGRATION.md`](docs/MCP_INTEGRATION.md).
- **Extensions:** declarative JSON manifests that map tool calls to HTTP endpoints. No arbitrary code executes inside SWARM. Disabled by default, and every extension call requires approval. See [`docs/EXTENSION_PLATFORM.md`](docs/EXTENSION_PLATFORM.md).
- **Telegraph:** free miner discovery and x402 quotes; paid answers use the x402 challenge/response flow with a server-side burner key. Every purchase requires explicit approval and a price ceiling. See [`docs/TELEGRAPH_INTEGRATION.md`](docs/TELEGRAPH_INTEGRATION.md).

## Security baseline

- API authentication is an explicit bearer token with timing-safe comparison.
- Integration and MCP secrets are AES-256-GCM encrypted at rest; plaintext is never returned by the API.
- Public web tools enforce SSRF guards, redirect re-validation, content-type allowlists, response size limits, and timeouts.
- Tool policy is enforced in the backend, not in prompts or the UI.
- Every external action has a visible approval record with redacted arguments.
- The runtime has no shell, filesystem-write, process-spawn, or arbitrary-code tool. Those names are denied unconditionally if ever registered.
- Artifacts are served with `nosniff` and `Content-Disposition`; the UI renders markdown with a custom React renderer that never injects raw HTML.

Details and residual risks: [`docs/SECURITY_AND_PERMISSIONS.md`](docs/SECURITY_AND_PERMISSIONS.md).

## Verification

Run these from this directory:

```powershell
pnpm test
pnpm typecheck
pnpm build
pnpm smoke
```

The current suite covers configuration, all 24 domain agents, plan validation, fallback planning, structured JSON extraction, OpenAI-compatible and Anthropic adapters, encryption/tamper resistance, redaction, SSRF, the full policy matrix, SQLite repositories, leased jobs, approvals, artifacts, memory, secrets, idempotency, and four end-to-end orchestration scenarios. The smoke script verifies a full run against a mock model through the built API, including token auth, SSE-independent run completion, review/final artifacts, accounting, and artifact download.

Exact evidence and the unverified list: [`IMPLEMENTATION_STATUS.md`](IMPLEMENTATION_STATUS.md).

## Documentation

- [PRD](docs/PRD.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Axle reuse audit](docs/AXLE_REUSE_AUDIT.md)
- [SWARM extraction plan](docs/SWARM_EXTRACTION_PLAN.md)
- [Data model](docs/DATA_MODEL.md)
- [Agent specifications](docs/AGENT_SPECIFICATIONS.md)
- [Tool runtime](docs/TOOL_RUNTIME.md)
- [MCP integration](docs/MCP_INTEGRATION.md)
- [Extension platform](docs/EXTENSION_PLATFORM.md)
- [Telegraph integration](docs/TELEGRAPH_INTEGRATION.md)
- [Security and permissions](docs/SECURITY_AND_PERMISSIONS.md)
- [Build plan](docs/BUILD_PLAN.md)
- [Implementation status](IMPLEMENTATION_STATUS.md)

## Known limitations

- No hosted multi-tenant deployment, email invites, SSO, or billing.
- SQLite and the in-process worker are intentional local-first choices. There is no Postgres/BullMQ implementation yet, only a documented migration path.
- No per-IP rate limiting or lockout in the API.
- No artifact versioning, comments, or collaborative editing.
- No scheduled runs, triggers, or recurring workflows.
- Live provider behavior, live Telegraph settlement, live remote MCP, GitHub writes, and extension endpoints are unverified.
- Browser automation, shell execution, local filesystem tools, and arbitrary extension code are intentionally absent.
