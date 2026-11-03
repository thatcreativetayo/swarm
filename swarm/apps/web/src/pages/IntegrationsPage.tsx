import { useMemo, useState } from "react";
import { useWorkspace } from "../AppContext.js";
import { api, errorMessage } from "../lib/api.js";
import { useApi } from "../lib/useApi.js";
import { prettyJson, timeAgo } from "../lib/format.js";
import type { Integration, McpServer, ToolInfo } from "../types.js";
import { Icon, type IconName } from "../components/Icon.js";
import { useToast } from "../components/Toast.js";
import {
  Badge,
  EmptyState,
  ErrorNote,
  Metric,
  Modal,
  PageHeader,
  SectionTitle,
  Spinner,
  StatusPill,
} from "../components/ui.js";

const PROVIDERS = ["github", "slack", "google", "notion", "linear", "figma", "calendar", "telegraph", "custom"] as const;

const PROVIDER_ICON: Record<string, IconName> = {
  github: "terminal",
  slack: "activity",
  google: "globe",
  notion: "file",
  linear: "tasks",
  figma: "layers",
  calendar: "clock",
  telegraph: "zap",
  custom: "link",
};

const RISK_TONE = {
  read: "neutral",
  internal_write: "info",
  external: "warning",
  purchase: "danger",
  destructive: "danger",
} as const;

function parseJsonObject(value: string, label: string): Record<string, unknown> {
  if (!value.trim()) return {};
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

function IntegrationForm({
  workspaceId,
  onDone,
}: {
  workspaceId: string;
  onDone: () => void;
}) {
  const toast = useToast();
  const [provider, setProvider] = useState<(typeof PROVIDERS)[number]>("github");
  const [name, setName] = useState("GitHub");
  const [secret, setSecret] = useState("");
  const [config, setConfig] = useState("{}");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const parsed = parseJsonObject(config, "Configuration");
      await api(`/api/workspaces/${encodeURIComponent(workspaceId)}/integrations`, {
        method: "POST",
        body: JSON.stringify({
          provider,
          name: name.trim() || provider,
          config: parsed,
          ...(secret.trim() ? { secret: secret.trim() } : {}),
        }),
      });
      toast("Integration saved. Credentials are encrypted at rest.", "success");
      onDone();
    } catch (error) {
      toast(errorMessage(error), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="form">
      <div className="form-grid">
        <label className="field">
          <span>Provider</span>
          <select className="input" value={provider} onChange={(event) => setProvider(event.target.value as typeof provider)}>
            {PROVIDERS.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Display name</span>
          <input className="input" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} />
        </label>
      </div>
      <label className="field">
        <span>Credential {provider === "telegraph" ? "(burner EVM private key)" : "(API token / key)"}</span>
        <input
          className="input"
          type="password"
          value={secret}
          onChange={(event) => setSecret(event.target.value)}
          placeholder="Stored encrypted server-side; never returned to the browser"
          autoComplete="off"
        />
      </label>
      <label className="field">
        <span>Configuration JSON</span>
        <textarea
          className="input code-input"
          rows={4}
          value={config}
          onChange={(event) => setConfig(event.target.value)}
          placeholder='{"defaultOwner":"acme"}'
        />
      </label>
      <div className="inline-warning">
        <Icon name="lock" size={16} />
        <span>Secrets are encrypted with AES-256-GCM. Tool calls resolve them on the server only.</span>
      </div>
      <div className="form-actions">
        <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={busy || !name.trim()}>
          {busy ? <Spinner label="Saving" /> : <><Icon name="plus" size={15} /> Save integration</>}
        </button>
      </div>
    </div>
  );
}

function McpForm({ workspaceId, allowStdio, onDone }: { workspaceId: string; allowStdio: boolean; onDone: () => void }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [transport, setTransport] = useState<"http" | "stdio">("http");
  const [url, setUrl] = useState("");
  const [command, setCommand] = useState("");
  const [headers, setHeaders] = useState("{}");
  const [env, setEnv] = useState("{}");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        transport,
        headers: parseJsonObject(headers, "Headers"),
        env: parseJsonObject(env, "Environment"),
      };
      if (transport === "http") body.url = url.trim();
      else body.command = command.trim().split(/\s+/).filter(Boolean);
      await api(`/api/workspaces/${encodeURIComponent(workspaceId)}/mcp`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      toast("MCP server saved. Connect it to discover tools.", "success");
      onDone();
    } catch (error) {
      toast(errorMessage(error), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="form">
      <div className="form-grid">
        <label className="field">
          <span>Server name</span>
          <input className="input" value={name} onChange={(event) => setName(event.target.value)} placeholder="Filesystem tools" maxLength={80} />
        </label>
        <label className="field">
          <span>Transport</span>
          <select className="input" value={transport} onChange={(event) => setTransport(event.target.value as "http" | "stdio")}>
            <option value="http">HTTP (streamable)</option>
            <option value="stdio" disabled={!allowStdio}>stdio {allowStdio ? "" : "(disabled)"}</option>
          </select>
        </label>
      </div>
      {transport === "http" ? (
        <label className="field">
          <span>MCP endpoint URL</span>
          <input className="input" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://mcp.example.com/mcp" />
        </label>
      ) : (
        <label className="field">
          <span>Command (space-separated executable and arguments)</span>
          <input className="input code-input" value={command} onChange={(event) => setCommand(event.target.value)} placeholder="npx -y @modelcontextprotocol/server-filesystem ./data" />
        </label>
      )}
      <div className="form-grid">
        <label className="field">
          <span>Headers JSON (optional)</span>
          <textarea className="input code-input" rows={3} value={headers} onChange={(event) => setHeaders(event.target.value)} placeholder='{"Authorization":"Bearer …"}' />
        </label>
        <label className="field">
          <span>Environment JSON (stdio only)</span>
          <textarea className="input code-input" rows={3} value={env} onChange={(event) => setEnv(event.target.value)} placeholder='{"API_KEY":"…"}' />
        </label>
      </div>
      <div className="inline-warning">
        <Icon name="shield" size={16} />
        <span>Discovered MCP tools require approval unless the server marks them read-only and the workspace policy allows auto-approval.</span>
      </div>
      <div className="form-actions">
        <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={busy || !name.trim() || (transport === "http" ? !url.trim() : !command.trim())}>
          {busy ? <Spinner label="Saving" /> : <><Icon name="plus" size={15} /> Save server</>}
        </button>
      </div>
    </div>
  );
}

export function IntegrationsPage() {
  const { workspaceId, config } = useWorkspace();
  const toast = useToast();
  const [integrationOpen, setIntegrationOpen] = useState(false);
  const [mcpOpen, setMcpOpen] = useState(false);
  const [busyServer, setBusyServer] = useState<string | null>(null);
  const [expandedServer, setExpandedServer] = useState<string | null>(null);

  const integrations = useApi<{ integrations: Integration[] }>(
    workspaceId ? `/api/workspaces/${encodeURIComponent(workspaceId)}/integrations` : null,
    [workspaceId],
  );
  const mcp = useApi<{ servers: McpServer[] }>(
    workspaceId ? `/api/workspaces/${encodeURIComponent(workspaceId)}/mcp` : null,
    [workspaceId],
    { pollMs: 12000 },
  );
  const tools = useApi<{ tools: ToolInfo[] }>(
    workspaceId ? `/api/workspaces/${encodeURIComponent(workspaceId)}/tools` : null,
    [workspaceId],
  );

  const integrationList = integrations.data?.integrations ?? [];
  const servers = mcp.data?.servers ?? [];
  const toolList = tools.data?.tools ?? [];
  const mcpToolCount = servers.reduce((total, server) => total + server.tools.length, 0);

  const groupedTools = useMemo(() => {
    const groups = new Map<string, ToolInfo[]>();
    for (const tool of toolList) {
      const list = groups.get(tool.source) ?? [];
      list.push(tool);
      groups.set(tool.source, list);
    }
    return [...groups.entries()];
  }, [toolList]);

  const connect = async (server: McpServer) => {
    setBusyServer(server.id);
    try {
      const result = await api<{ toolCount: number }>(`/api/mcp/${encodeURIComponent(server.id)}/connect`, { method: "POST" });
      toast(`Connected. Discovered ${result.toolCount} tool${result.toolCount === 1 ? "" : "s"}.`, "success");
      mcp.refresh();
      tools.refresh();
    } catch (error) {
      toast(errorMessage(error), "error");
      mcp.refresh();
    } finally {
      setBusyServer(null);
    }
  };

  const removeServer = async (server: McpServer) => {
    if (!workspaceId) return;
    if (!window.confirm(`Remove MCP server "${server.name}" and its discovered tools?`)) return;
    try {
      await api(`/api/workspaces/${encodeURIComponent(workspaceId)}/mcp/${encodeURIComponent(server.id)}`, { method: "DELETE" });
      toast("MCP server removed.", "info");
      mcp.refresh();
      tools.refresh();
    } catch (error) {
      toast(errorMessage(error), "error");
    }
  };

  const removeIntegration = async (integration: Integration) => {
    if (!workspaceId) return;
    if (!window.confirm(`Remove integration "${integration.name}"? Its encrypted secret will be deleted.`)) return;
    try {
      await api(`/api/workspaces/${encodeURIComponent(workspaceId)}/integrations/${encodeURIComponent(integration.id)}`, { method: "DELETE" });
      toast("Integration removed.", "info");
      integrations.refresh();
    } catch (error) {
      toast(errorMessage(error), "error");
    }
  };

  return (
    <div className="page">
      <PageHeader
        eyebrow="Connected systems"
        title="Integrations & tools"
        description="Bring your own credentials, MCP servers, and declarative extensions. Every external action stays behind backend policy and approval gates."
        actions={
          <>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMcpOpen(true)}>
              <Icon name="plus" size={14} /> MCP server
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setIntegrationOpen(true)}>
              <Icon name="plus" size={14} /> Integration
            </button>
          </>
        }
      />

      <section className="metric-grid">
        <Metric label="Integrations" value={integrationList.length} sub={`${integrationList.filter((entry) => entry.hasSecret).length} with credentials`} icon="integrations" tone="accent" />
        <Metric label="MCP servers" value={servers.length} sub={`${servers.filter((server) => server.status === "connected").length} connected`} icon="link" tone="info" />
        <Metric label="MCP tools" value={mcpToolCount} sub="Discovered and policy-gated" icon="terminal" />
        <Metric label="Native tools" value={toolList.filter((tool) => tool.source === "native").length} sub="Built into the runtime" icon="cpu" />
      </section>

      <div className="two-panel-grid">
        <section className="panel">
          <SectionTitle title="Credentials & integrations" hint="Server-side secrets for GitHub, Slack, Telegraph, and custom providers." />
          {integrations.error ? <ErrorNote message={integrations.error} onRetry={integrations.refresh} /> : null}
          {integrations.loading && !integrations.data ? (
            <div className="loading-row"><Spinner label="Loading integrations" /></div>
          ) : integrationList.length === 0 ? (
            <EmptyState icon="integrations" title="No integrations connected" description="Add a credential to let specialists read repositories, send messages, or call paid services." action={<button type="button" className="btn btn-ghost btn-sm" onClick={() => setIntegrationOpen(true)}>Add integration</button>} />
          ) : (
            <div className="integration-list">
              {integrationList.map((integration) => (
                <div className="integration-card" key={integration.id}>
                  <span className="integration-icon">
                    <Icon name={PROVIDER_ICON[integration.provider] ?? "link"} size={18} />
                  </span>
                  <div className="integration-main">
                    <div className="integration-title">
                      <strong>{integration.name}</strong>
                      <Badge tone="neutral">{integration.provider}</Badge>
                      <StatusPill status={integration.status} subtle />
                    </div>
                    <div className="integration-meta">
                      <span><Icon name={integration.hasSecret ? "lock" : "alert"} size={13} /> {integration.hasSecret ? "encrypted credential" : "no credential"}</span>
                      <span>updated {timeAgo(integration.updatedAt)}</span>
                    </div>
                    {Object.keys(integration.config).length > 0 ? (
                      <details className="payload-details">
                        <summary>Configuration</summary>
                        <pre className="code-block small">{prettyJson(integration.config)}</pre>
                      </details>
                    ) : null}
                  </div>
                  <button type="button" className="icon-button danger" onClick={() => void removeIntegration(integration)} title="Remove integration">
                    <Icon name="trash" size={15} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="panel">
          <SectionTitle title="MCP servers" hint="Model Context Protocol servers extend the workforce with external tools." />
          {mcp.error ? <ErrorNote message={mcp.error} onRetry={mcp.refresh} /> : null}
          {mcp.loading && !mcp.data ? (
            <div className="loading-row"><Spinner label="Loading MCP servers" /></div>
          ) : servers.length === 0 ? (
            <EmptyState icon="link" title="No MCP servers" description="Connect an HTTP or stdio MCP server to discover tools for the workforce." action={<button type="button" className="btn btn-ghost btn-sm" onClick={() => setMcpOpen(true)}>Add MCP server</button>} />
          ) : (
            <div className="integration-list">
              {servers.map((server) => {
                const open = expandedServer === server.id;
                return (
                  <div className="mcp-card" key={server.id}>
                    <div className="mcp-head">
                      <span className="integration-icon"><Icon name="link" size={18} /></span>
                      <div className="integration-main">
                        <div className="integration-title">
                          <strong>{server.name}</strong>
                          <Badge tone="neutral">{server.transport}</Badge>
                          <StatusPill status={server.status} subtle />
                        </div>
                        <div className="integration-meta">
                          <span><Icon name="terminal" size={13} /> {server.tools.length} tools</span>
                          <span>{server.url ?? server.command?.join(" ") ?? "no endpoint"}</span>
                        </div>
                        {server.lastError ? <div className="task-error"><Icon name="alert" size={14} /> {server.lastError}</div> : null}
                      </div>
                      <div className="mcp-actions">
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void connect(server)} disabled={busyServer === server.id}>
                          {busyServer === server.id ? <Spinner /> : <><Icon name="refresh" size={13} /> Connect</>}
                        </button>
                        <button type="button" className="icon-button danger" onClick={() => void removeServer(server)} title="Remove MCP server">
                          <Icon name="trash" size={15} />
                        </button>
                      </div>
                    </div>
                    {server.tools.length > 0 ? (
                      <button type="button" className="mcp-tools-toggle" onClick={() => setExpandedServer(open ? null : server.id)}>
                        {open ? "Hide" : "Show"} {server.tools.length} discovered tools
                        <Icon name={open ? "chevron-down" : "chevron-right"} size={14} />
                      </button>
                    ) : null}
                    {open ? (
                      <div className="mcp-tools">
                        {server.tools.map((tool) => (
                          <div className="mcp-tool" key={tool.id}>
                            <code>{tool.name}</code>
                            <span>{tool.description}</span>
                            <Badge tone={tool.requiresApproval ? "warning" : "neutral"}>
                              {tool.requiresApproval ? "approval" : "read-only"}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      <section className="panel">
        <SectionTitle title="Tool catalog" hint="Tools available to specialists, filtered by domain pack permissions and workspace policy." />
        {tools.error ? <ErrorNote message={tools.error} onRetry={tools.refresh} /> : null}
        {tools.loading && !tools.data ? (
          <div className="loading-row"><Spinner label="Loading tools" /></div>
        ) : (
          <div className="tool-groups">
            {groupedTools.map(([source, entries]) => (
              <div className="tool-group" key={source}>
                <div className="tool-group-head">
                  <Badge tone="neutral">{source}</Badge>
                  <span>{entries.length} tools</span>
                </div>
                <div className="tool-grid">
                  {entries.map((tool) => (
                    <div className="tool-card" key={`${source}-${tool.name}`}>
                      <div className="tool-card-head">
                        <code>{tool.name}</code>
                        <Badge tone={RISK_TONE[tool.risk]}>{tool.risk}</Badge>
                      </div>
                      <p>{tool.description}</p>
                      <span className={`tool-gate ${tool.requiresApproval ? "gated" : "open"}`}>
                        <Icon name={tool.requiresApproval ? "shield" : "check"} size={12} />
                        {tool.requiresApproval ? "approval required" : "auto-approved by policy"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <Modal open={integrationOpen} onClose={() => setIntegrationOpen(false)} title="Add integration" subtitle="Credentials are encrypted server-side and never returned to the browser.">
        {workspaceId ? <IntegrationForm workspaceId={workspaceId} onDone={() => { setIntegrationOpen(false); integrations.refresh(); }} /> : null}
      </Modal>
      <Modal open={mcpOpen} onClose={() => setMcpOpen(false)} title="Add MCP server" subtitle="SWARM supports streamable HTTP and local stdio MCP servers." wide>
        {workspaceId ? <McpForm workspaceId={workspaceId} allowStdio={config?.mcp.allowStdio ?? true} onDone={() => { setMcpOpen(false); mcp.refresh(); tools.refresh(); }} /> : null}
      </Modal>
    </div>
  );
}
