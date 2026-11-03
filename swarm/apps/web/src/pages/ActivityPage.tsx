import { useMemo, useState } from "react";
import { useWorkspace } from "../AppContext.js";
import { useApi } from "../lib/useApi.js";
import { formatClock, prettyJson, shortId } from "../lib/format.js";
import { navigate } from "../lib/router.js";
import type { Activity, ActivityLevel } from "../types.js";
import { Icon } from "../components/Icon.js";
import { EmptyState, ErrorNote, Metric, PageHeader, SectionTitle, Spinner } from "../components/ui.js";

const LEVELS = ["all", "info", "success", "warning", "error"] as const;
type Filter = (typeof LEVELS)[number];

const LEVEL_ICON = {
  info: "activity",
  success: "check-circle",
  warning: "alert",
  error: "x-circle",
} as const;

function dateKey(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

export function ActivityPage() {
  const { workspaceId } = useWorkspace();
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");

  const activity = useApi<{ activities: Activity[] }>(
    workspaceId ? `/api/workspaces/${encodeURIComponent(workspaceId)}/activity?limit=500` : null,
    [workspaceId],
    { pollMs: 6000 },
  );

  const all = activity.data?.activities ?? [];
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return all.filter((entry) => {
      if (filter !== "all" && entry.level !== filter) return false;
      if (!term) return true;
      return `${entry.message} ${entry.type}`.toLowerCase().includes(term);
    });
  }, [all, filter, search]);

  const grouped = useMemo(() => {
    const groups: Array<{ label: string; items: Activity[] }> = [];
    for (const entry of filtered) {
      const label = dateKey(entry.createdAt);
      const last = groups[groups.length - 1];
      if (last && last.label === label) last.items.push(entry);
      else groups.push({ label, items: [entry] });
    }
    return groups;
  }, [filtered]);

  const counts = useMemo(() => {
    const result: Record<ActivityLevel, number> = { info: 0, success: 0, warning: 0, error: 0 };
    for (const entry of all) result[entry.level] += 1;
    return result;
  }, [all]);

  return (
    <div className="page">
      <PageHeader
        eyebrow="Operational record"
        title="Activity"
        description="An append-only timeline of decisions, task transitions, approvals, tool calls, and run outcomes across the workspace."
        actions={
          <div className="search-wrap">
            <Icon name="search" size={15} />
            <input
              className="input"
              placeholder="Search activity…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        }
      />

      <section className="metric-grid">
        <Metric label="Events" value={all.length} sub="Retained in this workspace" icon="activity" tone="accent" />
        <Metric label="Success" value={counts.success} sub="Completed transitions" icon="check-circle" tone="info" />
        <Metric label="Warnings" value={counts.warning} sub="Fallbacks and retries" icon="alert" tone={counts.warning ? "warning" : "neutral"} />
        <Metric label="Errors" value={counts.error} sub="Failures and denials" icon="x-circle" tone={counts.error ? "danger" : "neutral"} />
      </section>

      <div className="filter-row">
        <div className="segmented">
          {LEVELS.map((entry) => (
            <button
              type="button"
              key={entry}
              className={`segment${filter === entry ? " active" : ""}`}
              onClick={() => setFilter(entry)}
            >
              {entry}
              {entry !== "all" && counts[entry] ? <span>{counts[entry]}</span> : null}
            </button>
          ))}
        </div>
        <div className="live-badge"><span className="dot ok" /> live</div>
      </div>

      {activity.error ? <ErrorNote message={activity.error} onRetry={activity.refresh} /> : null}

      {activity.loading && !activity.data ? (
        <div className="loading-screen"><Spinner label="Loading activity" /></div>
      ) : filtered.length === 0 ? (
        <EmptyState icon="activity" title={all.length === 0 ? "No activity yet" : "No activity matches this filter"} description={all.length === 0 ? "Operational events appear as soon as a run begins." : "Try another level or clear the search."} />
      ) : (
        <div className="activity-groups">
          {grouped.map((group) => (
            <section className="panel activity-group" key={group.label}>
              <SectionTitle title={group.label} hint={`${group.items.length} event${group.items.length === 1 ? "" : "s"}`} />
              <ol className="timeline">
                {group.items.map((entry) => (
                  <li key={entry.id} className={`timeline-item level-${entry.level}`}>
                    <span className={`timeline-icon level-${entry.level}`}>
                      <Icon name={LEVEL_ICON[entry.level]} size={15} />
                    </span>
                    <div className="timeline-body">
                      <div className="timeline-head">
                        <strong>{entry.message}</strong>
                        <span>{formatClock(entry.createdAt)}</span>
                      </div>
                      <div className="timeline-meta">
                        <span className={`level-tag level-${entry.level}`}>{entry.level}</span>
                        <span>{entry.type}</span>
                        {entry.runId ? (
                          <button type="button" className="link-button" onClick={() => navigate(`/run/${entry.runId}`)}>
                            run {shortId(entry.runId)} <Icon name="arrow-right" size={12} />
                          </button>
                        ) : null}
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
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
