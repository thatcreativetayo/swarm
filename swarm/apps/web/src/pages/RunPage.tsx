import { useMemo, useState } from "react";
import { refreshBootstrap, useWorkspace } from "../AppContext.js";
import { api, errorMessage } from "../lib/api.js";
import {
  extractDeliverable,
  formatBytes,
  formatClock,
  formatDateTime,
  formatDuration,
  isTerminal,
  prettyJson,
  runTitle,
  shortId,
  statusTone,
  taskAgentName,
  timeAgo,
  truncate,
} from "../lib/format.js";
import { navigate } from "../lib/router.js";
import { useRunLive } from "../lib/useRunLive.js";
import type { Activity, Artifact, RunDetail, Task, ToolExecution } from "../types.js";
import { ApprovalCard } from "../components/ApprovalCard.js";
import { ArtifactCard } from "../components/ArtifactCard.js";
import { ArtifactViewer } from "../components/ArtifactViewer.js";
import { Icon } from "../components/Icon.js";
import { Markdown } from "../components/Markdown.js";
import { useToast } from "../components/Toast.js";
import {
  Badge,
  CopyButton,
  EmptyState,
  ErrorNote,
  Metric,
  ProgressBar,
  SectionTitle,
  Spinner,
  StatusPill,
} from "../components/ui.js";

type Tab = "overview" | "workforce" | "tasks" | "approvals" | "artifacts" | "activity" | "trace";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function TaskCard({
  task,
  agents,
  onOpenArtifact,
}: {
  task: Task;
  agents: RunDetail["agents"];
  onOpenArtifact: (id: string) => void;
}) {
  const deliverable = extractDeliverable(task.output);
  return (
    <div className={`task-card task-${statusTone(task.status)}`}>
      <div className="task-card-head">
        <div className="task-title-wrap">
          <StatusPill status={task.status} />
          <h3>{task.title}</h3>
        </div>
        <span className="task-agent">
          <Icon name="users" size={13} /> {taskAgentName(task, agents)}
        </span>
      </div>
      <p className="task-description">{task.description}</p>
      <div className="task-meta-row">
        <span><Icon name="layers" size={13} /> {task.deliverable}</span>
        <span><Icon name="refresh" size={13} /> attempt {task.attempts}/{task.maxAttempts}</span>
        {task.dependsOn.length > 0 ? (
          <span><Icon name="link" size={13} /> {task.dependsOn.join(", ")}</span>
        ) : null}
      </div>
      {task.error ? <div className="task-error"><Icon name="alert" size={14} /> {task.error}</div> : null}
      {deliverable ? (
        <div className="task-output">
          <div className="task-output-head">
            <strong>{deliverable.title}</strong>
            {task.artifactId ? (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => onOpenArtifact(task.artifactId!)}>
                <Icon name="eye" size={14} /> View deliverable
              </button>
            ) : null}
          </div>
          <p>{deliverable.summary || truncate(deliverable.content.replace(/[#*`>]/g, ""), 220)}</p>
        </div>
      ) : null}
      {task.evaluationCriteria.length > 0 ? (
        <details className="task-details">
          <summary>Evaluation criteria</summary>
          <ul>
            {task.evaluationCriteria.map((criterion) => (
              <li key={criterion}>{criterion}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function ActivityFeed({ activities, limit = 100 }: { activities: Activity[]; limit?: number }) {
  if (activities.length === 0) {
    return <p className="muted-copy">No activity recorded yet.</p>;
  }
  return (
    <ol className="timeline">
      {activities.slice(0, limit).map((entry) => (
        <li key={entry.id} className={`timeline-item level-${entry.level}`}>
          <span className="timeline-dot" />
          <div className="timeline-body">
            <div className="timeline-head">
              <strong>{entry.message}</strong>
              <span>{formatDateTime(entry.createdAt)}</span>
            </div>
            <div className="timeline-meta">
              <span className={`level-tag level-${entry.level}`}>{entry.level}</span>
              <span>{entry.type}</span>
              {entry.agentId ? <span>agent · {shortId(entry.agentId)}</span> : null}
            </div>
            {entry.data ? (
              <details className="payload-details">
                <summary>Event data</summary>
                <pre className="code-block small">{prettyJson(entry.data)}</pre>
              </details>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

function TracePanel({ detail }: { detail: RunDetail }) {
  const [openExecution, setOpenExecution] = useState<string | null>(null);

  return (
    <div className="stack">
      <section className="panel">
        <SectionTitle title="Tool executions" hint="Every tool call is policy-checked, persisted, and idempotent." />
        {detail.toolExecutions.length === 0 ? (
          <EmptyState icon="terminal" title="No tool calls yet" description="The workforce has not invoked external or internal tools for this run." />
        ) : (
          <div className="trace-list">
            {detail.toolExecutions.map((execution: ToolExecution) => (
              <div className="trace-row" key={execution.id}>
                <button
                  type="button"
                  className="trace-main"
                  onClick={() => setOpenExecution(openExecution === execution.id ? null : execution.id)}
                >
                  <span className="trace-name">
                    <Icon name="terminal" size={15} />
                    <strong>{execution.toolName}</strong>
                    <Badge tone="neutral">{execution.source}</Badge>
                  </span>
                  <span className="trace-meta">
                    <StatusPill status={execution.status} subtle />
                    <span>{formatDuration(execution.durationMs)}</span>
                    <span>{formatClock(execution.startedAt)}</span>
                    <Icon name={openExecution === execution.id ? "chevron-down" : "chevron-right"} size={15} />
                  </span>
                </button>
                {openExecution === execution.id ? (
                  <div className="trace-detail">
                    {execution.error ? <div className="task-error">{execution.error}</div> : null}
                    <div className="trace-grid">
                      <div>
                        <span className="field-label">Input</span>
                        <pre className="code-block small">{prettyJson(execution.input)}</pre>
                      </div>
                      <div>
                        <span className="field-label">Output</span>
                        <pre className="code-block small">{prettyJson(execution.output)}</pre>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <SectionTitle title="Model calls" hint="Token and cost accounting for every request." />
        {detail.modelCalls.length === 0 ? (
          <p className="muted-copy">No model calls recorded.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Model</th>
                  <th>Status</th>
                  <th>Prompt</th>
                  <th>Completion</th>
                  <th>Total</th>
                  <th>Cost</th>
                  <th>Duration</th>
                </tr>
              </thead>
              <tbody>
                {detail.modelCalls.map((call) => (
                  <tr key={call.id}>
                    <td><code>{call.model}</code></td>
                    <td><StatusPill status={call.status} subtle /></td>
                    <td>{call.promptTokens.toLocaleString()}</td>
                    <td>{call.completionTokens.toLocaleString()}</td>
                    <td>{call.totalTokens.toLocaleString()}</td>
                    <td>{call.costUsd === null ? "—" : `$${call.costUsd.toFixed(4)}`}</td>
                    <td>{formatDuration(call.durationMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <SectionTitle title="Job queue" hint="Leased jobs with retry state. Workers recover expired leases." />
        {detail.jobs.length === 0 ? (
          <p className="muted-copy">No jobs recorded.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Status</th>
                  <th>Attempts</th>
                  <th>Last error</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {detail.jobs.map((job) => (
                  <tr key={job.id}>
                    <td><code>{job.type}</code></td>
                    <td><StatusPill status={job.status} subtle /></td>
                    <td>{job.attempts}/{job.maxAttempts}</td>
                    <td>{job.lastError ? truncate(job.lastError, 80) : "—"}</td>
                    <td>{timeAgo(job.updatedAt)}</td>
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

export function RunPage({ runId }: { runId: string }) {
  const toast = useToast();
  const { config } = useWorkspace();
  const { detail, error, loading, refresh } = useRunLive(runId);
  const [tab, setTab] = useState<Tab>("overview");
  const [artifactId, setArtifactId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const pendingApprovals = useMemo(
    () => detail?.approvals.filter((approval) => approval.status === "pending") ?? [],
    [detail],
  );
  const completedTasks = useMemo(
    () => detail?.tasks.filter((task) => task.status === "completed" || task.status === "skipped").length ?? 0,
    [detail],
  );
  const finalArtifact = detail?.artifacts.find((artifact) => artifact.kind === "final") ?? null;
  const run = detail?.run ?? null;

  const cancel = async () => {
    if (!run) return;
    if (!window.confirm("Cancel this run? Queued work will stop and pending approvals will be closed.")) return;
    setCancelling(true);
    try {
      await api(`/api/runs/${encodeURIComponent(run.id)}/cancel`, { method: "POST" });
      toast("Run cancelled.", "info");
      refreshBootstrap();
      refresh();
    } catch (caught) {
      toast(errorMessage(caught), "error");
    } finally {
      setCancelling(false);
    }
  };

  if (loading && !detail) {
    return (
      <div className="page">
        <div className="loading-screen"><Spinner label="Loading run" /></div>
      </div>
    );
  }

  if (!detail || !run) {
    return (
      <div className="page">
        <ErrorNote message={error ?? "Run not found."} onRetry={refresh} />
        <button type="button" className="btn btn-ghost" onClick={() => navigate("/")}>
          <Icon name="arrow-right" size={15} /> Back to command
        </button>
      </div>
    );
  }

  const tabs: Array<{ id: Tab; label: string; count?: number }> = [
    { id: "overview", label: "Overview" },
    { id: "workforce", label: "Workforce", count: detail.agents.length },
    { id: "tasks", label: "Tasks", count: detail.tasks.length },
    { id: "approvals", label: "Approvals", count: pendingApprovals.length || detail.approvals.length },
    { id: "artifacts", label: "Artifacts", count: detail.artifacts.length },
    { id: "activity", label: "Activity" },
    { id: "trace", label: "Trace" },
  ];

  return (
    <div className="page run-page">
      <section className="run-header panel">
        <div className="run-header-main">
          <div className="run-kicker">
            <StatusPill status={run.status} />
            <span className="run-id">run · {shortId(run.id)}</span>
            <CopyButton value={run.id} label="Copy ID" />
            {detail.usage.modelCalls > 0 ? (
              <span className="run-usage">
                {detail.usage.totalTokens.toLocaleString()} tokens · ${detail.usage.costUsd.toFixed(4)}
              </span>
            ) : null}
          </div>
          <h1>{runTitle(run)}</h1>
          <p className="run-goal">{run.goal}</p>
          <div className="run-meta-row">
            <span><Icon name="clock" size={14} /> created {timeAgo(run.createdAt)}</span>
            <span><Icon name="users" size={14} /> {detail.agents.length} specialists</span>
            <span><Icon name="tasks" size={14} /> {completedTasks}/{detail.tasks.length} tasks complete</span>
            {run.completedAt ? <span><Icon name="check-circle" size={14} /> finished {timeAgo(run.completedAt)}</span> : null}
          </div>
        </div>
        <div className="run-header-actions">
          {finalArtifact ? (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setArtifactId(finalArtifact.id)}>
              <Icon name="artifacts" size={15} /> Final deliverable
            </button>
          ) : null}
          {!isTerminal(run.status) ? (
            <button type="button" className="btn btn-danger btn-sm" onClick={() => void cancel()} disabled={cancelling}>
              {cancelling ? <Spinner /> : <><Icon name="stop" size={14} /> Cancel run</>}
            </button>
          ) : null}
          <button type="button" className="icon-button" onClick={refresh} title="Refresh run">
            <Icon name="refresh" size={17} />
          </button>
        </div>
        <div className="run-progress">
          <div className="run-progress-meta">
            <span>{detail.tasks.length > 0 ? `${Math.round((completedTasks / detail.tasks.length) * 100)}% complete` : "Awaiting plan"}</span>
            <span>{run.status === "awaiting_approval" ? "Human decision required" : run.status === "completed" ? "Delivered" : "Live"}</span>
          </div>
          <ProgressBar value={completedTasks} total={detail.tasks.length} />
        </div>
      </section>

      {error ? <ErrorNote message={error} onRetry={refresh} /> : null}
      {run.error ? (
        <div className="inline-warning danger">
          <Icon name="alert" size={16} />
          <span>{run.error}</span>
        </div>
      ) : null}

      <div className="tabs" role="tablist">
        {tabs.map((entry) => (
          <button
            type="button"
            key={entry.id}
            role="tab"
            aria-selected={tab === entry.id}
            className={`tab${tab === entry.id ? " active" : ""}`}
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
            {entry.count !== undefined && entry.count > 0 ? <span className="tab-count">{entry.count}</span> : null}
          </button>
        ))}
      </div>

      {tab === "overview" ? (
        <div className="detail-grid">
          <div className="stack">
            {run.interpretation ? (
              <section className="panel">
                <SectionTitle title="Interpreted objective" hint="The workforce's shared understanding of the goal." />
                <p className="objective-copy">{run.interpretation.objective}</p>
                <div className="chip-row">
                  {run.interpretation.domains.map((domain) => (
                    <Badge key={domain} tone="accent">{domain}</Badge>
                  ))}
                  <Badge tone="info">{run.interpretation.complexity} complexity</Badge>
                  {run.interpretation.requiresResearch ? <Badge tone="neutral">research</Badge> : null}
                  {run.interpretation.requiresExternalActions ? <Badge tone="warning">external actions</Badge> : null}
                </div>
                <div className="two-col-list">
                  <div>
                    <span className="field-label">Deliverables</span>
                    <ul className="plain-list">
                      {run.interpretation.deliverables.map((item) => <li key={item}>{item}</li>)}
                    </ul>
                  </div>
                  <div>
                    <span className="field-label">Constraints</span>
                    {run.interpretation.constraints.length > 0 ? (
                      <ul className="plain-list">
                        {run.interpretation.constraints.map((item) => <li key={item}>{item}</li>)}
                      </ul>
                    ) : <p className="muted-copy">None stated.</p>}
                  </div>
                </div>
                {run.interpretation.risks.length > 0 ? (
                  <div className="risk-box">
                    <span className="field-label">Risks to watch</span>
                    <ul className="plain-list">
                      {run.interpretation.risks.map((item) => <li key={item}>{item}</li>)}
                    </ul>
                  </div>
                ) : null}
              </section>
            ) : (
              <section className="panel">
                <SectionTitle title="Interpretation" hint="Waiting for the planner to finish." />
                <div className="loading-row"><Spinner label="Interpreting goal" /></div>
              </section>
            )}

            {run.plan && run.plan.notes.length > 0 ? (
              <section className="panel">
                <SectionTitle title="Plan notes" />
                <ul className="plain-list">
                  {run.plan.notes.map((note) => <li key={note}>{note}</li>)}
                </ul>
              </section>
            ) : null}

            {run.status === "completed" && run.summary ? (
              <section className="panel final-panel">
                <SectionTitle
                  title="Final synthesis"
                  hint="The reviewable answer assembled from specialist deliverables."
                  action={finalArtifact ? (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setArtifactId(finalArtifact.id)}>
                      <Icon name="eye" size={14} /> Open
                    </button>
                  ) : null}
                />
                <div className="final-preview">
                  <Markdown content={run.summary} />
                </div>
                {finalArtifact ? (
                  <div className="final-meta">
                    <Badge tone="accent">final</Badge>
                    <span>{finalArtifact.filename} · {formatBytes(finalArtifact.sizeBytes)}</span>
                  </div>
                ) : null}
              </section>
            ) : null}

            {run.status === "awaiting_approval" && pendingApprovals.length > 0 ? (
              <section className="panel approval-callout">
                <SectionTitle
                  title="Human decision required"
                  hint="The workforce is paused until you approve or deny the pending action."
                  action={
                    <button type="button" className="btn btn-primary btn-sm" onClick={() => setTab("approvals")}>
                      <Icon name="shield" size={14} /> Review {pendingApprovals.length}
                    </button>
                  }
                />
                <p>{pendingApprovals[0]?.title}</p>
                <p className="muted-copy">{pendingApprovals[0]?.summary}</p>
              </section>
            ) : null}
          </div>

          <div className="stack">
            <section className="panel telemetry-panel">
              <SectionTitle title="Run telemetry" />
              <div className="telemetry-grid">
                <Metric label="Specialists" value={detail.agents.length} icon="users" />
                <Metric label="Tasks" value={`${completedTasks}/${detail.tasks.length}`} icon="tasks" />
                <Metric label="Model calls" value={detail.usage.modelCalls} icon="cpu" />
                <Metric label="Tokens" value={detail.usage.totalTokens.toLocaleString()} icon="zap" />
                <Metric label="Cost" value={`$${detail.usage.costUsd.toFixed(4)}`} icon="database" />
                <Metric label="Approvals" value={detail.approvals.length} icon="shield" />
              </div>
              <div className="telemetry-detail">
                <div><span>Started</span><strong>{formatDateTime(run.startedAt)}</strong></div>
                <div><span>Completed</span><strong>{formatDateTime(run.completedAt)}</strong></div>
                <div><span>Model</span><strong>{config?.llm.model ?? "not configured"}</strong></div>
              </div>
            </section>

            <section className="panel">
              <SectionTitle
                title="Latest activity"
                action={
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setTab("activity")}>
                    All activity
                  </button>
                }
              />
              <ActivityFeed activities={detail.activities} limit={7} />
            </section>
          </div>
        </div>
      ) : null}

      {tab === "workforce" ? (
        detail.agents.length === 0 ? (
          <EmptyState icon="users" title="Workforce assembling" description="Specialists will appear once the planner has interpreted the goal." />
        ) : (
          <div className="agent-grid">
            {detail.agents.map((agent) => {
              const tasks = detail.tasks.filter((task) => task.agentId === agent.id);
              const done = tasks.filter((task) => task.status === "completed").length;
              return (
                <div className="agent-card" key={agent.id}>
                  <div className="agent-head">
                    <span className="agent-avatar">{initials(agent.name)}</span>
                    <div className="agent-identity">
                      <h3>{agent.name}</h3>
                      <p>{agent.role}</p>
                    </div>
                    <StatusPill status={agent.status} subtle />
                  </div>
                  <div className="agent-tags">
                    <Badge tone="accent">{agent.domainPack}</Badge>
                    <Badge tone="neutral">{agent.definitionKey}</Badge>
                  </div>
                  <div className="agent-stats">
                    <span><strong>{done}</strong> of {tasks.length} tasks done</span>
                    <span className="agent-model">{agent.model ?? "default model"}</span>
                  </div>
                  <div className="agent-tasks">
                    {tasks.map((task) => (
                      <div className="agent-task-row" key={task.id}>
                        <span className={`mini-dot tone-${statusTone(task.status)}`} />
                        <span>{task.title}</span>
                        <StatusPill status={task.status} subtle />
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : null}

      {tab === "tasks" ? (
        detail.tasks.length === 0 ? (
          <EmptyState icon="tasks" title="No tasks yet" description="The plan has not been materialized. Tasks appear as soon as planning completes." />
        ) : (
          <div className="task-list">
            {detail.tasks.map((task) => (
              <TaskCard key={task.id} task={task} agents={detail.agents} onOpenArtifact={setArtifactId} />
            ))}
          </div>
        )
      ) : null}

      {tab === "approvals" ? (
        <div className="stack">
          <section className="panel">
            <SectionTitle
              title="Pending approvals"
              hint="Approvals are enforced by the backend policy engine. No action runs without a decision."
            />
            {pendingApprovals.length === 0 ? (
              <EmptyState icon="check-circle" title="No approvals waiting" description="The workforce is operating within its approved boundaries." />
            ) : (
              <div className="approval-list">
                {pendingApprovals.map((approval) => (
                  <ApprovalCard key={approval.id} approval={approval} onDecided={refresh} />
                ))}
              </div>
            )}
          </section>
          {detail.approvals.length > pendingApprovals.length ? (
            <section className="panel">
              <SectionTitle title="Approval history" />
              <div className="approval-list">
                {detail.approvals
                  .filter((approval) => approval.status !== "pending")
                  .map((approval) => (
                    <ApprovalCard key={approval.id} approval={approval} onDecided={refresh} />
                  ))}
              </div>
            </section>
          ) : null}
        </div>
      ) : null}

      {tab === "artifacts" ? (
        detail.artifacts.length === 0 ? (
          <EmptyState icon="artifacts" title="No artifacts yet" description="Supporting documents and final deliverables will collect here." />
        ) : (
          <div className="artifact-grid">
            {detail.artifacts.map((artifact: Artifact) => (
              <ArtifactCard key={artifact.id} artifact={artifact} onOpen={setArtifactId} />
            ))}
          </div>
        )
      ) : null}

      {tab === "activity" ? (
        <section className="panel">
          <SectionTitle title="Activity timeline" hint="Append-only operational record for this run." />
          <ActivityFeed activities={detail.activities} />
        </section>
      ) : null}

      {tab === "trace" ? <TracePanel detail={detail} /> : null}

      <ArtifactViewer artifactId={artifactId} onClose={() => setArtifactId(null)} />
    </div>
  );
}
