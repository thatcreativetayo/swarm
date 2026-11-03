import { useEffect, useState } from "react";
import { useWorkspace, refreshBootstrap } from "../AppContext.js";
import { api, errorMessage, getApiToken, setApiToken } from "../lib/api.js";
import { useApi } from "../lib/useApi.js";
import { formatDateTime, timeAgo } from "../lib/format.js";
import type { Memory, WorkspaceSettings } from "../types.js";
import { Icon } from "../components/Icon.js";
import { useToast } from "../components/Toast.js";
import {
  Badge,
  EmptyState,
  ErrorNote,
  PageHeader,
  SectionTitle,
  Spinner,
} from "../components/ui.js";

function SettingToggle({
  label,
  description,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className={`toggle-row${disabled ? " disabled" : ""}`}>
      <span className="toggle-copy">
        <strong>{label}</strong>
        <span>{description}</span>
      </span>
      <input
        type="checkbox"
        className="toggle-input"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        disabled={disabled}
      />
      <span className="toggle" aria-hidden="true" />
    </label>
  );
}

export function SettingsPage() {
  const { workspace, workspaceId, config, refresh } = useWorkspace();
  const toast = useToast();

  const settingsApi = useApi<{ workspace: { name: string }; settings: WorkspaceSettings }>(
    workspaceId ? `/api/workspaces/${encodeURIComponent(workspaceId)}/settings` : null,
    [workspaceId],
  );
  const memories = useApi<{ memories: Memory[] }>(
    workspaceId ? `/api/workspaces/${encodeURIComponent(workspaceId)}/memories` : null,
    [workspaceId],
  );

  const [name, setName] = useState("");
  const [autoApproveReadOnlyMcp, setAutoApproveReadOnlyMcp] = useState(false);
  const [allowExternalHttpWrites, setAllowExternalHttpWrites] = useState(false);
  const [maxAgents, setMaxAgents] = useState(8);
  const [maxTasks, setMaxTasks] = useState(12);
  const [saving, setSaving] = useState(false);

  const [token, setToken] = useState(getApiToken());
  const [tokenBusy, setTokenBusy] = useState(false);

  const [memoryKey, setMemoryKey] = useState("");
  const [memoryContent, setMemoryContent] = useState("");
  const [memoryTags, setMemoryTags] = useState("");
  const [memoryBusy, setMemoryBusy] = useState(false);

  useEffect(() => {
    if (!settingsApi.data) return;
    setName(settingsApi.data.workspace.name);
    setAutoApproveReadOnlyMcp(settingsApi.data.settings.autoApproveReadOnlyMcp);
    setAllowExternalHttpWrites(settingsApi.data.settings.allowExternalHttpWrites);
    setMaxAgents(settingsApi.data.settings.maxAgents ?? config?.limits.maxAgents ?? 8);
    setMaxTasks(settingsApi.data.settings.maxTasks ?? config?.limits.maxTasks ?? 12);
  }, [settingsApi.data, config]);

  const saveSettings = async () => {
    if (!workspaceId) return;
    setSaving(true);
    try {
      await api(`/api/workspaces/${encodeURIComponent(workspaceId)}/settings`, {
        method: "PATCH",
        body: JSON.stringify({
          name: name.trim(),
          autoApproveReadOnlyMcp,
          allowExternalHttpWrites,
          maxAgents,
          maxTasks,
        }),
      });
      toast("Workspace settings saved.", "success");
      settingsApi.refresh();
      refresh();
      refreshBootstrap();
    } catch (error) {
      toast(errorMessage(error), "error");
    } finally {
      setSaving(false);
    }
  };

  const saveToken = async () => {
    setTokenBusy(true);
    setApiToken(token);
    try {
      await api("/api/settings");
      toast(token.trim() ? "API token saved in this browser." : "API token cleared.", "success");
      refresh();
    } catch (error) {
      toast(errorMessage(error), "error");
    } finally {
      setTokenBusy(false);
    }
  };

  const addMemory = async () => {
    if (!workspaceId) return;
    setMemoryBusy(true);
    try {
      await api(`/api/workspaces/${encodeURIComponent(workspaceId)}/memories`, {
        method: "POST",
        body: JSON.stringify({
          key: memoryKey.trim(),
          content: memoryContent.trim(),
          tags: memoryTags.split(",").map((tag) => tag.trim()).filter(Boolean),
        }),
      });
      toast("Workspace memory saved.", "success");
      setMemoryKey("");
      setMemoryContent("");
      setMemoryTags("");
      memories.refresh();
    } catch (error) {
      toast(errorMessage(error), "error");
    } finally {
      setMemoryBusy(false);
    }
  };

  const checklist = [
    { label: "Model provider configured", ok: Boolean(config?.llm.configured), hint: "SWARM_LLM_PROVIDER + API key" },
    { label: "Encryption key available", ok: true, hint: "Auto-generated under ./data if unset" },
    { label: "API token protection", ok: Boolean(config?.auth.tokenRequired), hint: "Recommended when not loopback-only" },
    { label: "External extensions", ok: Boolean(config?.extensions.enabled), hint: "Disabled by default" },
    { label: "Telegraph payments", ok: Boolean(config?.telegraph.paymentsConfigured), hint: "Purchases always require approval" },
  ];

  return (
    <div className="page">
      <PageHeader
        eyebrow="Workspace control"
        title="Settings"
        description="Configure policy boundaries, model runtime, credentials, and durable workspace memory. All limits are enforced server-side."
      />

      <div className="settings-grid">
        <div className="stack">
          <section className="panel">
            <SectionTitle title="Workspace" hint="Policy changes apply to new and running work." />
            {settingsApi.error ? <ErrorNote message={settingsApi.error} onRetry={settingsApi.refresh} /> : null}
            {settingsApi.loading && !settingsApi.data ? (
              <div className="loading-row"><Spinner label="Loading settings" /></div>
            ) : (
              <div className="form">
                <label className="field">
                  <span>Workspace name</span>
                  <input className="input" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} />
                </label>
                <div className="form-grid">
                  <label className="field">
                    <span>Max agents per run</span>
                    <input
                      className="input"
                      type="number"
                      min={1}
                      max={config?.limits.maxAgents ?? 12}
                      value={maxAgents}
                      onChange={(event) => setMaxAgents(Number(event.target.value))}
                    />
                    <small>Server ceiling: {config?.limits.maxAgents ?? 12}</small>
                  </label>
                  <label className="field">
                    <span>Max tasks per run</span>
                    <input
                      className="input"
                      type="number"
                      min={1}
                      max={config?.limits.maxTasks ?? 24}
                      value={maxTasks}
                      onChange={(event) => setMaxTasks(Number(event.target.value))}
                    />
                    <small>Server ceiling: {config?.limits.maxTasks ?? 24}</small>
                  </label>
                </div>
                <div className="toggle-stack">
                  <SettingToggle
                    label="Auto-approve read-only MCP tools"
                    description="When enabled, MCP tools explicitly annotated read-only can run without a human decision."
                    checked={autoApproveReadOnlyMcp}
                    onChange={setAutoApproveReadOnlyMcp}
                  />
                  <SettingToggle
                    label="Allow external HTTP writes"
                    description="Permits non-GET http_request calls. Every write still requires approval."
                    checked={allowExternalHttpWrites}
                    onChange={setAllowExternalHttpWrites}
                  />
                </div>
                <div className="form-actions">
                  <button type="button" className="btn btn-primary" onClick={() => void saveSettings()} disabled={saving || !name.trim()}>
                    {saving ? <Spinner label="Saving" /> : <><Icon name="check" size={15} /> Save settings</>}
                  </button>
                </div>
              </div>
            )}
          </section>

          <section className="panel">
            <SectionTitle title="Workspace memory" hint="Durable facts and preferences specialists can search during runs." />
            {memories.error ? <ErrorNote message={memories.error} onRetry={memories.refresh} /> : null}
            <div className="form">
              <div className="form-grid">
                <label className="field">
                  <span>Memory key</span>
                  <input className="input" value={memoryKey} onChange={(event) => setMemoryKey(event.target.value)} placeholder="brand-voice" maxLength={160} />
                </label>
                <label className="field">
                  <span>Tags (comma-separated)</span>
                  <input className="input" value={memoryTags} onChange={(event) => setMemoryTags(event.target.value)} placeholder="tone, writing" />
                </label>
              </div>
              <label className="field">
                <span>Content</span>
                <textarea className="input" rows={3} value={memoryContent} onChange={(event) => setMemoryContent(event.target.value)} placeholder="Prefer direct, specific language. Avoid hype." maxLength={20000} />
              </label>
              <div className="form-actions">
                <button type="button" className="btn btn-ghost" onClick={() => void addMemory()} disabled={memoryBusy || !memoryKey.trim() || !memoryContent.trim()}>
                  {memoryBusy ? <Spinner label="Saving" /> : <><Icon name="plus" size={15} /> Add memory</>}
                </button>
              </div>
            </div>
            {memories.data && memories.data.memories.length > 0 ? (
              <div className="memory-list">
                {memories.data.memories.map((memory) => (
                  <div className="memory-card" key={memory.id}>
                    <div className="memory-head">
                      <code>{memory.key}</code>
                      <span>{timeAgo(memory.updatedAt)}</span>
                    </div>
                    <p>{memory.content}</p>
                    {memory.tags.length > 0 ? (
                      <div className="chip-row">
                        {memory.tags.map((tag) => <Badge key={tag} tone="neutral">{tag}</Badge>)}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState icon="database" title="No memories yet" description="Add durable context so specialists do not ask for the same information twice." />
            )}
          </section>
        </div>

        <div className="stack">
          <section className="panel">
            <SectionTitle title="Runtime" hint="Read-only server configuration." />
            <div className="settings-kv">
              <div><span>Model provider</span><strong>{config?.llm.provider ?? "not configured"}</strong></div>
              <div><span>Model</span><strong>{config?.llm.model ?? "—"}</strong></div>
              <div><span>Base URL</span><strong className="mono">{config?.llm.baseUrl ?? "provider default"}</strong></div>
              <div><span>Storage</span><strong>SQLite · WAL · local-first</strong></div>
              <div><span>Worker</span><strong>Inline with API (default)</strong></div>
              <div><span>Workspace</span><strong>{workspace?.slug ?? "—"}</strong></div>
              <div><span>Created</span><strong>{formatDateTime(workspace?.createdAt ?? null)}</strong></div>
            </div>
          </section>

          <section className="panel">
            <SectionTitle title="Guardrails" hint="Environment ceilings; workspace settings may only narrow them." />
            <div className="limits-grid">
              <div><span>Max tool steps</span><strong>{config?.limits.maxToolSteps ?? "—"}</strong></div>
              <div><span>Max model calls</span><strong>{config?.limits.maxModelCalls ?? "—"}</strong></div>
              <div><span>Max tokens</span><strong>{config?.limits.maxTokens.toLocaleString() ?? "—"}</strong></div>
              <div><span>Task attempts</span><strong>{config?.limits.taskMaxAttempts ?? "—"}</strong></div>
              <div><span>Run timeout</span><strong>{Math.round((config?.limits.runTimeoutMs ?? 0) / 60000)}m</strong></div>
              <div><span>Tool timeout</span><strong>{Math.round((config?.limits.toolTimeoutMs ?? 0) / 1000)}s</strong></div>
            </div>
          </section>

          <section className="panel">
            <SectionTitle title="API access" hint={config?.auth.tokenRequired ? "This server requires a bearer token." : "No token configured. Bind the API to loopback only."} />
            <div className="form">
              <label className="field">
                <span>Bearer token (stored in this browser only)</span>
                <input
                  className="input"
                  type="password"
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  placeholder="SWARM_API_TOKEN"
                  autoComplete="off"
                />
              </label>
              <div className="form-actions">
                <button type="button" className="btn btn-ghost" onClick={() => void saveToken()} disabled={tokenBusy}>
                  {tokenBusy ? <Spinner label="Checking" /> : <><Icon name="key" size={15} /> Save token</>}
                </button>
              </div>
            </div>
            <div className="inline-warning">
              <Icon name={config?.auth.tokenRequired ? "lock" : "alert"} size={16} />
              <span>
                {config?.auth.tokenRequired
                  ? "Requests without a valid token are rejected by the API."
                  : "Set SWARM_API_TOKEN before exposing SWARM beyond this machine."}
              </span>
            </div>
          </section>

          <section className="panel">
            <SectionTitle title="Readiness" />
            <div className="checklist">
              {checklist.map((item) => (
                <div className={`check-row ${item.ok ? "ok" : "todo"}`} key={item.label}>
                  <span className="check-icon"><Icon name={item.ok ? "check-circle" : "alert"} size={16} /></span>
                  <div>
                    <strong>{item.label}</strong>
                    <span>{item.hint}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="panel">
            <SectionTitle title="Telegraph" hint="Paid intelligence calls settle over x402. Purchases always pause for approval." />
            <div className="settings-kv">
              <div><span>Node</span><strong className="mono">{config?.telegraph.nodeUrl ?? "—"}</strong></div>
              <div><span>Payments</span><strong>{config?.telegraph.paymentsConfigured ? "burner key configured" : "not configured"}</strong></div>
              <div><span>Policy</span><strong>approval required</strong></div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
