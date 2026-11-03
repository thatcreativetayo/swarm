import { useState } from "react";
import type { Approval } from "../types.js";
import { api, errorMessage } from "../lib/api.js";
import { prettyJson, timeAgo } from "../lib/format.js";
import { navigate } from "../lib/router.js";
import { refreshBootstrap } from "../AppContext.js";
import { useToast } from "./Toast.js";
import { Badge, Spinner, StatusPill } from "./ui.js";
import { Icon } from "./Icon.js";

export function ApprovalCard({
  approval,
  onDecided,
  showRun = false,
}: {
  approval: Approval;
  onDecided: () => void;
  showRun?: boolean;
}) {
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<"approved" | "denied" | null>(null);

  const decide = async (decision: "approved" | "denied") => {
    setBusy(decision);
    try {
      await api(`/api/approvals/${encodeURIComponent(approval.id)}/decide`, {
        method: "POST",
        body: JSON.stringify({ decision, reason: reason.trim() || undefined }),
      });
      toast(
        decision === "approved" ? "Approved. The task will resume." : "Denied. The workforce will adapt.",
        "success",
      );
      refreshBootstrap();
      onDecided();
    } catch (error) {
      toast(errorMessage(error), "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={`approval-card status-${approval.status}`}>
      <div className="approval-head">
        <div className="approval-tags">
          <Badge tone={approval.kind === "purchase" ? "warning" : "info"}>{approval.kind}</Badge>
          <StatusPill status={approval.status} />
        </div>
        <div className="approval-head-right">
          {showRun ? (
            <button type="button" className="link-button" onClick={() => navigate(`/run/${approval.runId}`)}>
              open run <Icon name="arrow-right" size={13} />
            </button>
          ) : null}
          <span className="muted-copy">{timeAgo(approval.createdAt)}</span>
        </div>
      </div>
      <h3>{approval.title}</h3>
      <p>{approval.summary}</p>
      <details className="payload-details">
        <summary>Review request payload</summary>
        <pre className="code-block small">{prettyJson(approval.payload)}</pre>
      </details>
      {approval.status === "pending" ? (
        <div className="approval-actions">
          <input
            className="input"
            placeholder="Optional decision note…"
            value={reason}
            maxLength={2000}
            onChange={(event) => setReason(event.target.value)}
          />
          <button
            type="button"
            className="btn btn-danger btn-sm"
            onClick={() => void decide("denied")}
            disabled={busy !== null}
          >
            {busy === "denied" ? <Spinner /> : <><Icon name="x" size={14} /> Deny</>}
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => void decide("approved")}
            disabled={busy !== null}
          >
            {busy === "approved" ? <Spinner /> : <><Icon name="check" size={14} /> Approve</>}
          </button>
        </div>
      ) : approval.decisionReason ? (
        <p className="approval-reason">Decision note: {approval.decisionReason}</p>
      ) : null}
    </div>
  );
}
