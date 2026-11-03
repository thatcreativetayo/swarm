import { useMemo, useState } from "react";
import { useWorkspace } from "../AppContext.js";
import { navigate } from "../lib/router.js";
import { useApi } from "../lib/useApi.js";
import { timeAgo } from "../lib/format.js";
import type { Agent } from "../types.js";
import { Icon, type IconName } from "../components/Icon.js";
import { Badge, EmptyState, ErrorNote, Metric, PageHeader, SectionTitle, Spinner, StatusPill } from "../components/ui.js";

const PACK_ICONS: Record<string, IconName> = {
  business: "layers",
  education: "file",
  software: "terminal",
  career: "sparkles",
  health: "shield",
  general: "globe",
};

export function WorkforcePage() {
  const { workspaceId, domainPacks } = useWorkspace();
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>("business");

  const roster = useApi<{ agents: Agent[] }>(
    workspaceId ? `/api/workspaces/${encodeURIComponent(workspaceId)}/workforce` : null,
    [workspaceId],
    { pollMs: 8000 },
  );

  const filteredPacks = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return domainPacks;
    return domainPacks.filter(
      (pack) =>
        pack.name.toLowerCase().includes(term) ||
        pack.description.toLowerCase().includes(term) ||
        pack.keywords.some((keyword) => keyword.toLowerCase().includes(term)) ||
        pack.agents.some((agent) => `${agent.name} ${agent.role}`.toLowerCase().includes(term)),
    );
  }, [domainPacks, search]);

  const agents = roster.data?.agents ?? [];
  const working = agents.filter((agent) => agent.status === "working").length;
  const done = agents.filter((agent) => agent.status === "done").length;
  const specialists = domainPacks.reduce((total, pack) => total + pack.agentCount, 0);

  return (
    <div className="page">
      <PageHeader
        eyebrow="Dynamic workforce"
        title="Specialists, composed per goal"
        description="SWARM selects from domain packs and can extend the roster with MCP and extension tools. The planner only materializes the specialists a run actually needs."
        actions={
          <div className="search-wrap">
            <Icon name="search" size={15} />
            <input
              className="input"
              placeholder="Search domains or roles…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        }
      />

      <section className="metric-grid">
        <Metric label="Domain packs" value={domainPacks.length} sub="Business, education, software, career, health, general" icon="layers" tone="accent" />
        <Metric label="Specialist definitions" value={specialists} sub="Available to the planner" icon="users" tone="info" />
        <Metric label="Agents on runs" value={agents.length} sub={`${working} working · ${done} done`} icon="zap" tone={working > 0 ? "accent" : "neutral"} />
        <Metric label="Workflows" value={domainPacks.reduce((total, pack) => total + pack.workflows.length, 0)} sub="Reusable execution patterns" icon="activity" />
      </section>

      <SectionTitle
        title="Domain packs"
        hint="Each pack contributes specialist definitions, task templates, workflows, and evaluation rules."
      />

      {filteredPacks.length === 0 ? (
        <EmptyState icon="search" title="No matching domains" description="Try a broader search, or clear the filter to see all packs." />
      ) : (
        <div className="pack-grid">
          {filteredPacks.map((pack) => {
            const open = expanded === pack.key;
            return (
              <div className={`pack-card${open ? " open" : ""}`} key={pack.key}>
                <button
                  type="button"
                  className="pack-head"
                  onClick={() => setExpanded(open ? null : pack.key)}
                  aria-expanded={open}
                >
                  <span className="pack-icon">
                    <Icon name={PACK_ICONS[pack.key] ?? "layers"} size={20} />
                  </span>
                  <span className="pack-title">
                    <strong>{pack.name}</strong>
                    <small>{pack.agentCount} specialists · {pack.taskCount} task templates</small>
                  </span>
                  <Icon name={open ? "chevron-down" : "chevron-right"} size={17} />
                </button>
                <p className="pack-description">{pack.description}</p>
                <div className="pack-keywords">
                  {pack.keywords.slice(0, 6).map((keyword) => (
                    <span key={keyword}>{keyword}</span>
                  ))}
                </div>

                {open ? (
                  <div className="pack-body">
                    <div className="pack-section">
                      <span className="field-label">Specialists</span>
                      <div className="pack-agent-list">
                        {pack.agents.map((agent) => (
                          <div className="pack-agent" key={agent.key}>
                            <span className="pack-agent-avatar">
                              {agent.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("")}
                            </span>
                            <div>
                              <strong>{agent.name}</strong>
                              <p>{agent.role}</p>
                              <div className="pack-agent-tools">
                                {agent.allowedTools.slice(0, 5).map((tool) => (
                                  <code key={tool}>{tool}</code>
                                ))}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    {pack.workflows.length > 0 ? (
                      <div className="pack-section">
                        <span className="field-label">Workflows</span>
                        <div className="workflow-list">
                          {pack.workflows.map((workflow) => (
                            <div className="workflow-row" key={workflow.key}>
                              <Icon name="link" size={14} />
                              <div>
                                <strong>{workflow.name}</strong>
                                <p>{workflow.description}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    <div className="pack-section">
                      <span className="field-label">Evaluation rules</span>
                      <ul className="plain-list compact">
                        {pack.evaluationRules.map((rule) => (
                          <li key={rule}>{rule}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      <section className="panel roster-panel">
        <SectionTitle
          title="Active roster"
          hint="Specialists materialized across every run in this workspace."
          action={
            <button type="button" className="btn btn-ghost btn-sm" onClick={roster.refresh}>
              <Icon name="refresh" size={14} /> Refresh
            </button>
          }
        />
        {roster.error ? <ErrorNote message={roster.error} onRetry={roster.refresh} /> : null}
        {roster.loading && !roster.data ? (
          <div className="loading-row"><Spinner label="Loading roster" /></div>
        ) : agents.length === 0 ? (
          <EmptyState icon="users" title="No specialists deployed yet" description="Start a run from the Command page and the planner will assemble the first workforce." />
        ) : (
          <div className="table-wrap">
            <table className="data-table roster-table">
              <thead>
                <tr>
                  <th>Specialist</th>
                  <th>Domain</th>
                  <th>Status</th>
                  <th>Model</th>
                  <th>Run</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {agents.slice(0, 100).map((agent) => (
                  <tr key={agent.id}>
                    <td>
                      <div className="table-person">
                        <span className="agent-avatar small">
                          {agent.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("")}
                        </span>
                        <div>
                          <strong>{agent.name}</strong>
                          <span>{agent.role}</span>
                        </div>
                      </div>
                    </td>
                    <td><Badge tone="accent">{agent.domainPack}</Badge></td>
                    <td><StatusPill status={agent.status} subtle /></td>
                    <td><code className="muted-code">{agent.model ?? "default"}</code></td>
                    <td>
                      <button type="button" className="link-button" onClick={() => navigate(`/run/${agent.runId}`)}>
                        open run <Icon name="arrow-right" size={13} />
                      </button>
                    </td>
                    <td>{timeAgo(agent.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
