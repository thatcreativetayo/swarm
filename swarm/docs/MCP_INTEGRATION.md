# SWARM - MCP Integration

**Version:** 0.1
**Status:** Implemented; unverified against live third-party MCP servers
**Last updated:** 2026-10-31
**Related:** [Tool Runtime](TOOL_RUNTIME.md), [Security](SECURITY_AND_PERMISSIONS.md), [Architecture](ARCHITECTURE.md)

---

## 1. Overview

SWARM can connect to Model Context Protocol (MCP) servers and expose their tools to agents.
MCP is the supported way to add external capabilities without modifying the SWARM runtime:
issue trackers, knowledge bases, databases, internal APIs, and vendor tool servers.

Two transports are supported:

| Transport | Use | Execution model |
| --- | --- | --- |
| `http` | Remote or local HTTP MCP servers | Streamable HTTP POST with JSON-RPC 2.0. |
| `stdio` | Local MCP servers launched as child processes | Newline-delimited JSON over stdin/stdout. |

MCP is **not** a bypass around approval. Every MCP tool is marked external. Write-like tools
always require approval by default, and a workspace can opt into auto-approving only tools whose
server declares `readOnlyHint: true`.

## 2. Lifecycle

```text
Add server (API/UI)
  -> credentials encrypted into secrets table
  -> POST /api/mcp/:serverId/connect
  -> initialize / notifications/initialized
  -> tools/list (paginated)
  -> mcp_tools persisted
  -> every task registry includes workspace MCP tools
  -> tools/call on model request
  -> tool execution audited; policy and approvals apply
```

Discovery is explicit. Adding a server does not contact it. A server can be added while offline
and connected later. If discovery fails, the server's status becomes `error`, the client is
dropped, and the API returns `502` with the failure message.

MCP clients are cached per server for the life of the process:

- successful calls refresh `lastUsed`;
- idle clients are closed after 5 minutes when the worker is idle;
- a failed call drops the cached client and sets status `error`;
- deleting a server closes its client first;
- runtime shutdown closes all clients.

The HTTP transport has no client-side session teardown; streamable HTTP sessions are owned by
the server. The stdio transport ends stdin and kills the child process on close.

## 3. Protocol behavior

The client targets MCP protocol version `2025-06-18`.

Supported JSON-RPC methods:

- `initialize` with client capabilities `{ tools: {} }` and client info `swarm/0.1.0`;
- `notifications/initialized`;
- `tools/list`, following `nextCursor` for up to 10 pages;
- `tools/call`.

Not implemented in v0.1:

- resources, prompts, sampling, roots, and elicitation;
- OAuth discovery or dynamic client registration;
- server-initiated notifications beyond parsing tool results;
- automatic reconnection with backoff;
- tool-list subscriptions or change notifications.

### 3.1 HTTP details

- POSTs JSON-RPC payloads to the configured URL.
- Sends `content-type: application/json` and
  `accept: application/json, text/event-stream`.
- Propagates `mcp-session-id` from responses on later requests.
- Parses either a JSON response or a `text/event-stream` body, matching the JSON-RPC id.
- Uses a 30-second request timeout and supports caller cancellation through an `AbortSignal`.
- Non-2xx responses become `McpError`, with the response body truncated to 1,000 chars.

The connection URL is validated by the API as HTTP or HTTPS and must not embed credentials.
Unlike the public web tools, MCP URLs are **not** passed through the private-address SSRF guard.
This is deliberate for local-first and internal-network servers, but it means an operator who can
add an MCP server can point SWARM at internal addresses. Treat MCP server administration as a
privileged action.

### 3.2 stdio details

- The command is an argv array; `shell: false` is used.
- The process inherits the API/worker environment, with the server's encrypted env map merged in.
- stdout is read as newline-delimited JSON; non-JSON lines are ignored.
- stderr is retained as a bounded tail and included in process-exit errors.
- Requests time out after 30 seconds; pending requests are rejected on exit.
- Stdio is enabled by default (`SWARM_ALLOW_STDIO_MCP=true`) and can be disabled with
  `SWARM_ALLOW_STDIO_MCP=false`.

Stdio servers are arbitrary local processes. They are not sandboxed. Only install servers you
trust, and disable stdio entirely on a shared or hosted deployment. The model cannot add a
server; a human/operator must do it through the authenticated API.

## 4. Adding a server

### 4.1 HTTP example

```http
POST /api/workspaces/ws_.../mcp
Authorization: Bearer <SWARM_API_TOKEN>
Content-Type: application/json

{
  "name": "linear",
  "transport": "http",
  "url": "https://mcp.example.com/mcp",
  "headers": {
    "Authorization": "Bearer lin_api_..."
  }
}
```

Then:

```http
POST /api/mcp/srv_.../connect
Authorization: Bearer <SWARM_API_TOKEN>
```

The response includes the updated server, discovered tools, and a tool count. Tool names are
namespaced as `mcp_<server_slug>_<tool>`, for example `mcp_linear_create_issue`.

### 4.2 stdio example

```http
POST /api/workspaces/ws_.../mcp
Authorization: Bearer <SWARM_API_TOKEN>
Content-Type: application/json

{
  "name": "local-tools",
  "transport": "stdio",
  "command": ["npx", "-y", "some-mcp-server"],
  "env": {
    "SERVICE_API_KEY": "..."
  }
}
```

On Windows, the command is spawned directly without a shell. Use an executable or a command
that resolves on `PATH`; avoid shell syntax such as pipes and `&&`.

### 4.3 API surface

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/workspaces/:workspaceId/mcp` | List servers with persisted tools. |
| `POST` | `/api/workspaces/:workspaceId/mcp` | Create a server; secrets encrypted. |
| `POST` | `/api/mcp/:serverId/connect` | Initialize and rediscover tools. |
| `DELETE` | `/api/workspaces/:workspaceId/mcp/:serverId` | Drop client and delete server. |

Create input is validated by `CreateMcpServerInputSchema`:

```ts
{
  name: string;                    // 1-80 chars, unique per workspace
  transport: "http" | "stdio";
  url?: string;                    // required for http
  command?: string[];              // required for stdio, 1-20 arguments
  headers?: Record<string, string>;
  env?: Record<string, string>;
}
```

Headers and environment variables are stored as encrypted JSON secrets, not as plaintext
columns. The API returns the server id, name, transport, URL or command, status, last error, and
timestamps. It does not return header or env values, or even their secret ids.

## 5. Tool exposure and approval

On discovery, each remote tool is persisted with:

- remote name and description;
- JSON input schema;
- `requiresApproval = !readOnlyHint`.

The runtime exposes it as:

```ts
{
  name: "mcp_<server>_<tool>",
  risk: "external",
  source: "mcp",
  readOnlyHint: !requiresApproval,
  isWrite: requiresApproval
}
```

`destructiveHint` is parsed by the client but is not persisted separately in v0.1. A server that
marks a write tool as read-only could therefore receive auto-approval if the workspace opts in.
Only enable `autoApproveReadOnlyMcp` for servers whose annotations you trust.

Policy order:

1. MCP tools are never native allowlist entries.
2. Workspace `autoApproveReadOnlyMcp=false` (default): all MCP calls require approval.
3. Workspace `autoApproveReadOnlyMcp=true`: a tool is allowed without approval only when
   discovery recorded `readOnlyHint: true`; all other MCP tools require approval.
4. Health workflows still deny purchase/destructive risks before MCP policy is considered.

MCP tool results containing `isError: true` become a failed tool execution. Text and resource
blocks are flattened into readable content. Structured content is preserved as the execution
data when present. A malicious MCP server can return prompt-injection text; the agent is
instructed to treat external content as untrusted, and all consequential actions remain gated.

## 6. Secrets and redaction

- Header and env maps are serialized as JSON, encrypted with AES-256-GCM, and stored in the
  `secrets` table.
- Decryption happens only in the server process when a client is created.
- The encryption key comes from `SWARM_ENCRYPTION_KEY` or `data/.encryption-key`.
- Losing the key makes stored MCP credentials unusable; tools fail closed.
- MCP server names and tool descriptions are stored in plaintext and shown in the UI.
- Tool inputs and outputs are stored on execution rows; API projection applies redaction.

## 7. Failure behavior

| Failure | Result |
| --- | --- |
| Invalid URL / embedded credentials | `422` on create. |
| stdio disabled by config | `403` on create. |
| Missing command or URL | `422` on create. |
| Initialize/list fails | `502`, status `error`, last error stored. |
| Request exceeds 30s | `McpError` timeout; execution failed/timeout. |
| Process exits | Pending requests rejected with stderr tail. |
| Malformed JSON on stdout | Line ignored; request eventually times out. |
| Tool returns `isError` | Tool execution failed; model receives an error. |
| Run cancelled | Caller `AbortSignal` cancels the request. |
| Server deleted | Client closed; tools cascade-deleted. |

## 8. Operational guidance

- Prefer HTTP MCP servers for remote services and stdio only for trusted local tooling.
- Use a dedicated service account and least-privilege token for each server.
- Keep `autoApproveReadOnlyMcp` off unless the server is trusted and genuinely read-only.
- Test a new server with `connect`, inspect the discovered schemas, then run a narrowly scoped
  goal before using it in consequential workflows.
- Do not put secrets in URLs; use encrypted headers/env.
- Set `SWARM_ALLOW_STDIO_MCP=false` on any deployment where local process execution is not
  explicitly intended.
- MCP clients are process-local. In split API/worker mode, the worker performs calls and must
  have the same encryption key and data directory.

## 9. Verification boundary

Implemented and typechecked:

- HTTP and stdio JSON-RPC clients;
- initialize, paginated `tools/list`, `tools/call`;
- session-id propagation and SSE response parsing;
- encrypted header/env storage and secret access;
- discovery persistence, namespacing, idle close, and error status;
- policy behavior for read-only and write MCP tools (unit-tested at the policy layer).

Not verified:

- any live third-party MCP server;
- OAuth-protected servers (static headers are the only auth mechanism);
- Windows-specific stdio server compatibility beyond the generic spawn path;
- large tool catalogues, server-initiated notifications, or reconnection under network failure;
- destructive-hint enforcement (the hint is parsed but not persisted).

See [IMPLEMENTATION_STATUS](../IMPLEMENTATION_STATUS.md) for the live-verification checklist.
