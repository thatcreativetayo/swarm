import { useMemo, useState } from "react";
import { useWorkspace } from "../AppContext.js";
import { navigate } from "../lib/router.js";
import { useApi } from "../lib/useApi.js";
import { shortId, taskAgentName, timeAgo, truncate } from "../lib/format.js";
import type { Agent, Task } from "../types.js";
import { Icon } from "../components/Icon.js";
import { Badge, EmptyState, ErrorNote, Metric, PageHeader, SectionTitle, Spinner, StatusPill } from "../components/ui.js";

const FILTERS = ["all", "running", "awaiting_approval", "pending", "completed", "failed"] as const;
type Filter = (typeof FILTERS)[number];

export function TasksPage() {
  const { workspaceId } = useWorkspace();
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");

  const tasks = useApi<{ tasks: Task[] }>(
    workspaceId ? `/api/workspaces/${encodeURIComponent(workspaceId)}/tasks?limit=400` : null,
    [workspaceId],
    { pollMs: 7000 },
  );
  const agents = useApi<{ agents: Agent[] }>(
    workspaceId ? `/api/workspaces/${encodeURIComponent(workspaceId)}/workforce` : null,
    [workspaceId],
    { pollMs: 15000 },
  );

  const agentList = agents.data?.agents ?? [];
  const allTasks = tasks.data?.tasks ?? [];

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return allTasks.filter((task) => {
      if (filter !== "all" && task.status !== filter) return false;
      if (!term) return true;
      return `${task.title} ${task.description} ${task.deliverable}`.toLowerCase().includes(term);
    });
  }, [allTasks, filter, search]);

  const counts = useMemo(() => {
    const result: Record<string, number> = {};
    for (const task of allTasks) result[task.status] = (result[task.status] ?? 0) + 1;
    return result;
  }, [allTasks]);

  return (
    <div className="page">
      <PageHeader
        eyebrow="Execution board"
        title="Every task, every state"
        description="Tasks are dependency-aware units of work assigned to a specialist. Approval pauses, retries, and failures are persisted."
        actions={
          <div className="search-wrap">
            <Icon name="search" size={15} />
            <input
              className="input"
              placeholder="Search tasks…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        }
      />

      <section className="metric-grid">
        <Metric label="Total tasks" value={allTasks.length} sub="Across all runs" icon="tasks" tone="accent" />
        <Metric label="Running" value={counts.running ?? 0} sub="Specialists working now" icon="zap" tone="info" />
        <Metric label="Awaiting approval" value={counts.awaiting_approval ?? 0} sub="Blocked on a human decision" icon="shield" tone={counts.awaiting_approval ? "warning" : "neutral"} />
        <Metric label="Completed" value={counts.completed ?? 0} sub={`${counts.failed ?? 0} failed`} icon="check-circle" tone="neutral" />
      </section>

      <div className="filter-row">
        <div className="segmented">
          {FILTERS.map((entry) => (
            <button
              type="button"
              key={entry}
              className={`segment${filter === entry ? " active" : ""}`}
              onClick={() => setFilter(entry)}
            >
              {entry === "all" ? "All" : entry.replaceAll("_", " ")}
              {entry !== "all" && counts[entry] ? <span>{counts[entry]}</span> : null}
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={tasks.refresh}>
          <Icon name="refresh" size={14} /> Refresh
        </button>
      </div>

      {tasks.error ? <ErrorNote message={tasks.error} onRetry={tasks.refresh} /> : null}

      <section className="panel">
        <SectionTitle
          title={filter === "all" ? "Task board" : `${filter.replaceAll("_", " ")} tasks`}
          hint={`${filtered.length} task${filtered.length === 1 ? "" : "s"} shown`}
        />
        {tasks.loading && !tasks.data ? (
          <div className="loading-row"><Spinner label="Loading tasks" /></div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon="tasks"
            title={allTasks.length === 0 ? "No tasks yet" : "No tasks match this filter"}
            description={allTasks.length === 0 ? "Deploy a workforce and its task plan will appear here." : "Try a different status filter or clear the search."}
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table task-table">
              <thead>
                <tr>
                  <th>Task</th>
                  <th>Specialist</th>
                  <th>Status</th>
                  <th>Run</th>
                  <th>Attempts</th>
                  <th>Deliverable</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((task) => (
                  <tr key={task.id}>
                    <td>
                      <div className="table-task">
                        <button type="button" className="link-button strong" onClick={() => navigate(`/run/${task.runId}`)}>
                          {task.title}
                        </button>
                        <span>{truncate(task.description, 100)}</span>
                      </div>
                    </td>
                    <td>{taskAgentName(task, agentList)}</td>
                    <td><StatusPill status={task.status} subtle /></td>
                    <td>
                      <button type="button" className="link-button" onClick={() => navigate(`/run/${task.runId}`)}>
                        <code>{shortId(task.runId)}</code>
                      </button>
                    </td>
                    <td>{task.attempts}/{task.maxAttempts}</td>
                    <td><Badge tone="neutral">{task.deliverable}</Badge></td>
                    <td>{timeAgo(task.updatedAt)}</td>
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
