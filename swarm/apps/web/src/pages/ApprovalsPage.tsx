import { useMemo, useState } from "react";
import { useWorkspace } from "../AppContext.js";
import { useApi } from "../lib/useApi.js";
import type { Approval } from "../types.js";
import { ApprovalCard } from "../components/ApprovalCard.js";
import { Icon } from "../components/Icon.js";
import { EmptyState, ErrorNote, Metric, PageHeader, SectionTitle, Spinner } from "../components/ui.js";

export function ApprovalsPage() {
  const { workspaceId } = useWorkspace();
  const [tab, setTab] = useState<"pending" | "history">("pending");

  const pending = useApi<{ approvals: Approval[] }>(
    workspaceId ? `/api/workspaces/${encodeURIComponent(workspaceId)}/approvals?status=pending` : null,
    [workspaceId],
    { pollMs: 5000 },
  );
  const history = useApi<{ approvals: Approval[] }>(
    workspaceId ? `/api/workspaces/${encodeURIComponent(workspaceId)}/approvals?status=all` : null,
    [workspaceId],
    { pollMs: 15000 },
  );

  const pendingList = pending.data?.approvals ?? [];
  const historyList = useMemo(
    () => (history.data?.approvals ?? []).filter((approval) => approval.status !== "pending"),
    [history.data],
  );

  const refreshAll = () => {
    pending.refresh();
    history.refresh();
  };

  return (
    <div className="page">
      <PageHeader
        eyebrow="Human control plane"
        title="Approvals"
        description="Purchases, external writes, MCP calls, and extension actions pause here. The backend enforces the decision — the UI cannot bypass policy."
        actions={
          <button type="button" className="btn btn-ghost btn-sm" onClick={refreshAll}>
            <Icon name="refresh" size={14} /> Refresh
          </button>
        }
      />

      <section className="metric-grid">
        <Metric label="Pending decisions" value={pendingList.length} sub="Blocking live runs" icon="shield" tone={pendingList.length ? "warning" : "neutral"} />
        <Metric label="Approved" value={historyList.filter((entry) => entry.status === "approved").length} sub="Actions released" icon="check-circle" tone="accent" />
        <Metric label="Denied" value={historyList.filter((entry) => entry.status === "denied").length} sub="Blocked by user" icon="x-circle" tone="danger" />
        <Metric label="Expired" value={historyList.filter((entry) => entry.status === "expired").length} sub="No decision in time" icon="clock" tone="neutral" />
      </section>

      <div className="tabs">
        <button type="button" className={`tab${tab === "pending" ? " active" : ""}`} onClick={() => setTab("pending")}>
          Pending {pendingList.length > 0 ? <span className="tab-count">{pendingList.length}</span> : null}
        </button>
        <button type="button" className={`tab${tab === "history" ? " active" : ""}`} onClick={() => setTab("history")}>
          History {historyList.length > 0 ? <span className="tab-count">{historyList.length}</span> : null}
        </button>
      </div>

      {pending.error ? <ErrorNote message={pending.error} onRetry={pending.refresh} /> : null}
      {history.error ? <ErrorNote message={history.error} onRetry={history.refresh} /> : null}

      {tab === "pending" ? (
        <section className="panel">
          <SectionTitle
            title="Waiting on you"
            hint="Approving resumes the paused task. Denying records the reason and lets the workforce adapt."
          />
          {pending.loading && !pending.data ? (
            <div className="loading-row"><Spinner label="Loading approvals" /></div>
          ) : pendingList.length === 0 ? (
            <EmptyState
              icon="check-circle"
              title="Nothing waiting"
              description="No action is blocked on a human decision. The workforce is operating within approved boundaries."
            />
          ) : (
            <div className="approval-list">
              {pendingList.map((approval) => (
                <ApprovalCard key={approval.id} approval={approval} onDecided={refreshAll} showRun />
              ))}
            </div>
          )}
        </section>
      ) : (
        <section className="panel">
          <SectionTitle title="Decision history" hint="Approval decisions are immutable audit records." />
          {historyList.length === 0 ? (
            <EmptyState icon="inbox" title="No decisions yet" description="Approval history appears after the first human decision." />
          ) : (
            <div className="approval-list">
              {historyList.map((approval) => (
                <ApprovalCard key={approval.id} approval={approval} onDecided={refreshAll} showRun />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
