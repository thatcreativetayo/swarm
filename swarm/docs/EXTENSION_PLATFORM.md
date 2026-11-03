# SWARM - Extension Platform

**Version:** 0.1
**Status:** Implemented; disabled by default; unverified against live endpoints
**Last updated:** 2026-10-31
**Related:** [Tool Runtime](TOOL_RUNTIME.md), [Security](SECURITY_AND_PERMISSIONS.md), [MCP Integration](MCP_INTEGRATION.md)

---

## 1. What an extension is

A SWARM extension is a declarative JSON manifest that maps tool names to HTTPS endpoints. It is
data, not code. SWARM never evaluates JavaScript, loads a native addon, or imports extension
modules. The only thing an extension can do is cause an outbound HTTP request after a user has
approved the call.

This is intentionally narrower than Axle's JavaScript extension engine. The tradeoff is less
power for third-party integrations in exchange for a much smaller execution surface: no
arbitrary code, no filesystem access, no process spawning, no package installation.

Extensions are **disabled by default**. They load only when both conditions are true:

```dotenv
SWARM_ENABLE_EXTERNAL_EXTENSIONS=true
SWARM_EXTENSION_DIR=./data/extensions
```

The directory is scanned at process startup for `*.json` files. New or edited manifests require
a restart. There is no hot reload and no extension-management API in v0.1.

## 2. Manifest schema

The loader validates every manifest with Zod:

```json
{
  "id": "example_crm",
  "name": "Example CRM",
  "version": "1.0.0",
  "description": "Read and update customer records in an example CRM.",
  "baseUrl": "https://api.example.com",
  "tools": [
    {
      "name": "search_contacts",
      "description": "Search contacts by name or email.",
      "method": "GET",
      "path": "/v1/contacts",
      "inputSchema": {
        "type": "object",
        "additionalProperties": false,
        "required": ["query"],
        "properties": {
          "query": { "type": "string", "minLength": 1, "maxLength": 200 },
          "limit": { "type": "integer", "minimum": 1, "maximum": 25 }
        }
      },
      "timeoutMs": 15000
    },
    {
      "name": "create_note",
      "description": "Attach a note to a contact.",
      "method": "POST",
      "path": "/v1/contacts/{contactId}/notes",
      "inputSchema": {
        "type": "object",
        "additionalProperties": false,
        "required": ["contactId", "body"],
        "properties": {
          "contactId": { "type": "string", "minLength": 1, "maxLength": 120 },
          "body": { "type": "string", "minLength": 1, "maxLength": 5000 }
        }
      }
    }
  ]
}
```

### 2.1 Manifest fields

| Field | Rules |
| --- | --- |
| `id` | Lowercase letters, digits, `_`, `-`; 1-48 chars. Used in tool names. |
| `name` | Display name, 1-120 chars. |
| `version` | Non-empty string, max 32 chars. Informational. |
| `description` | Optional string, max 2,000 chars; defaults to empty. |
| `baseUrl` | URL. Execution requires HTTPS and blocks private addresses. |
| `tools` | 1-50 tool definitions. |

### 2.2 Tool fields

| Field | Rules |
| --- | --- |
| `name` | Lowercase letters, digits, `_`; 1-48 chars. Unique within the manifest. |
| `description` | 1-1,000 chars. Shown to the model. |
| `method` | `GET`, `POST`, `PUT`, `PATCH`, or `DELETE`; defaults to `GET`. |
| `path` | Starts with `/`, max 500 chars. May contain `{placeholder}` segments. |
| `inputSchema` | JSON object, defaults to an empty object schema. Advertised to the model. |
| `timeoutMs` | Integer 1,000-60,000; defaults to 20,000. |

The generated tool name is `ext_<manifest.id>_<tool.name>`, sanitized and truncated to 64
characters. Collisions get a numeric suffix. Tools are registered with:

```ts
{
  risk: "external",
  source: "extension",
  requiresApproval: true,          // always
  isWrite: method !== "GET"
}
```

A `DELETE` is treated as a write. A `GET` still requires approval because every extension call
is gated. There is no workspace setting that turns extension approval off.

## 3. Request mapping

At execution time the loader builds:

```text
<baseUrl without trailing slashes><path with placeholders replaced>
```

Path placeholders are replaced with `encodeURIComponent(String(value))`. A missing placeholder,
`null`, or an object/array value throws a tool input error.

For `GET` and `DELETE`:

- primitive inputs not used in the path become URL query parameters;
- the body is empty.

For `POST`, `PUT`, and `PATCH`:

- the whole input object is sent as a JSON body;
- `content-type: application/json` is set;
- path placeholders remain in the body as well as in the URL.

Every call sends:

```http
accept: application/json, text/plain, text/markdown
user-agent: SWARM/0.1 extension
```

There is no extension authentication mechanism in v0.1. Manifests cannot declare headers,
tokens, or environment variables. An extension endpoint must therefore be reachable without
credentials, or be fronted by a proxy that applies authentication. Do not put secrets in query
strings or manifests.

## 4. Response handling

- Redirects are refused (`redirect: "error"`).
- Responses are read as text and capped at 200,000 characters.
- A non-2xx status becomes a failed tool execution with a truncated error body.
- The response is not parsed as JSON; the model receives the text as-is.
- The execution data records the status and resolved URL.
- The global tool timeout can shorten a manifest's timeout; it cannot lengthen it.

If the endpoint returns a huge or malicious payload, the response cap and approval gate are the
only protections. Treat extension output as untrusted content.

## 5. Loading and errors

`loadExtensions(dir, enabled)` returns:

```ts
{
  tools: SwarmTool[];
  manifests: Array<{ id, name, version, tools }>;
  errors: Array<{ file, error }>;
}
```

- A malformed manifest is rejected; the error is logged at startup and the file contributes no
  tools.
- Other valid manifests still load.
- A missing directory is not an error; it produces an empty result.
- Load errors are not exposed through the API in v0.1. Check server logs.
- The loader sorts files by name, so tool registration is deterministic.

Because extensions are loaded once at engine construction, changing a manifest while the API is
running has no effect. Restart the API and worker after edits.

## 6. Security model

### 6.1 Controls

| Control | Implementation |
| --- | --- |
| No code execution | JSON schema only; no JS, native modules, or shell. |
| Disabled by default | Requires `SWARM_ENABLE_EXTERNAL_EXTENSIONS=true`. |
| Explicit approval | Every extension tool has `requiresApproval: true`; policy returns approval. |
| HTTPS only | `assertSafeUrl(..., { allowHttp: false })` at execution. |
| SSRF guard | Blocks localhost, `.local`, metadata hostnames, private IPv4/IPv6, and DNS results resolving to private addresses. |
| No embedded credentials | URLs with username/password are rejected. |
| No redirects | Prevents redirect-based SSRF pivots. |
| Timeouts | Manifest timeout, capped by global tool timeout. |
| Response cap | 200,000 characters. |

### 6.2 Residual risks

- **DNS rebinding:** the guard resolves and validates the hostname, then `fetch` resolves it
  again. A hostile DNS server could change the answer between checks. A production deployment
  should pin the validated IP or use an egress proxy.
- **Approval context:** the approval payload shows the tool, risk, redacted input, and source,
  but not the resolved URL or HTTP method. A user must trust the manifest. A future UI should
  show the destination before approval.
- **No endpoint authentication:** manifests cannot attach credentials. Integrations that need
  auth should use a server-side proxy or an MCP server.
- **Prompt injection:** extension descriptions and responses are untrusted text. A malicious
  response can try to steer the agent; consequential actions still require approval.
- **Operator trust:** anyone who can write to `SWARM_EXTENSION_DIR` can add a tool that
  exfiltrates approved arguments. Protect the directory and run the API as a least-privilege
  user.
- **No signature or provenance check:** manifests are not signed or verified against a registry.

## 7. Operational guidance

1. Keep extensions disabled unless they are needed.
2. Review every manifest before placing it in the extension directory.
3. Use a dedicated hostname and a narrow API surface for each extension.
4. Avoid endpoints that mutate data unless the approval flow is genuinely meaningful.
5. Keep manifests out of version control if they contain sensitive internal hostnames.
6. Restart the API and worker after changing manifests.
7. Check logs for `extension manifest rejected` after startup.

## 8. Verification boundary

Implemented and typechecked:

- manifest validation, deterministic loading, namespacing, and collision handling;
- URL/path/query/body mapping;
- HTTPS enforcement, SSRF checks, redirect refusal, timeout, and response cap;
- always-approval policy for extension tools (covered by the policy matrix test).

Not verified:

- any live third-party extension endpoint;
- loader behavior with a real manifest directory in an automated test;
- authentication patterns (not supported in v0.1);
- DNS-rebinding resistance under an adversarial resolver.

See [IMPLEMENTATION_STATUS](../IMPLEMENTATION_STATUS.md).
