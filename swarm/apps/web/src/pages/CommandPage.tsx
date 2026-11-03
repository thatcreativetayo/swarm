import { useEffect, useRef, useState } from "react";
import { useWorkspace, refreshBootstrap } from "../AppContext.js";
import { api, errorMessage } from "../lib/api.js";
import { runTitle, timeAgo } from "../lib/format.js";
import { navigate } from "../lib/router.js";
import { useApi } from "../lib/useApi.js";
import type { Activity, Run } from "../types.js";
import { useToast } from "../components/Toast.js";
import { Badge, EmptyState, ErrorNote, Metric, SectionTitle, Spinner, StatusPill } from "../components/ui.js";
import { Icon } from "../components/Icon.js";

const EXAMPLES = [
  {
    label: "Business plan",
    icon: "layers" as const,
    goal: "Build a go-to-market plan for a subscription meal-prep service launching in Lagos. Include positioning, pricing, a 90-day launch calendar, and a competitor landscape.",
  },
  {
    label: "Course design",
    icon: "file" as const,
    goal: "Design a 6-week cohort course that teaches product managers how to run customer discovery. Include weekly learning outcomes, assignments, and an assessment rubric.",
  },
  {
    label: "Launch review",
    icon: "globe" as const,
    goal: "Audit the public marketing site at example.com for conversion gaps and produce a prioritized landing-page rewrite with copy and layout recommendations.",
  },
  {
    label: "Career package",
    icon: "sparkles" as const,
    goal: "Create a tailored job-search package for a senior data analyst targeting fintech roles: resume positioning, a cover letter template, and a 30-day networking plan.",
  },
];

export function CommandPage() {
  const { workspace, workspaceId, config, domainPacks, bootstrap } = useWorkspace();
  const toast = useToast();
  const [goal, setGoal] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);

  const runs = useApi<{ runs: Run[] }>(
    workspaceId ? `/api/workspaces/${encodeURIComponent(workspaceId)}/runs?limit=18` : null,
    [workspaceId],
    { pollMs: 6000 },
  );
  const activity = useApi<{ activities: Activity[] }>(
    workspaceId ? `/api/workspaces/${encodeURIComponent(workspaceId)}/activity?limit=8` : null,
    [workspaceId],
    { pollMs: 10000 },
  );

  useEffect(() => {
    const focus = () => textarea.current?.focus();
    window.addEventListener("swarm:focus-goal", focus);
    return () => window.removeEventListener("swarm:focus-goal", focus);
  }, []);

  const submit = async () => {
    if (!workspaceId) return;
    const trimmed = goal.trim();
    if (trimmed.length < 10) {
      setSubmitError("Describe the outcome in at least 10 characters.");
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const result = await api<{ run: Run }>(
        `/api/workspaces/${encodeURIComponent(workspaceId)}/runs`,
        { method: "POST", body: JSON.stringify({ goal: trimmed }) },
      );
      toast("Workforce deployed. Interpreting the goal now.", "success");
      refreshBootstrap();
      runs.refresh();
      navigate(`/run/${result.run.id}`);
    } catch (error) {
      setSubmitError(errorMessage(error));
      toast(errorMessage(error), "error");
    } finally {
      setSubmitting(false);
    }
  };

  const specialists = domainPacks.reduce((total, pack) => total + pack.agentCount, 0);
  const stats = bootstrap?.stats;
  const llmReady = config?.llm.configured ?? false;

  return (
    <div className="page command-page">
      <section className="hero">
        <div className="hero-grid">
          <div className="hero-copy">
            <div className="eyebrow">
              <span className="eyebrow-dot" /> Universal autonomous workforce
            </div>
            <h1>
              Delegate the work.
              <br />
              <span>Keep the control.</span>
            </h1>
            <p>
              Describe an outcome. SWARM assembles a specialist workforce, executes the plan with real
              tools, and returns reviewable deliverables — with every action auditable.
            </p>
          </div>
          <div className="hero-signal">
            <div className="signal-ring">
              <div className="signal-core">
                <span>{stats?.activeRuns ?? 0}</span>
                <small>active runs</small>
              </div>
            </div>
            <div className="signal-caption">
              <span className={`dot ${llmReady ? "ok" : "warn"}`} />
              {llmReady ? `${config?.llm.model} ready` : "Model setup required"}
            </div>
          </div>
        </div>

        <div className={`composer${!llmReady ? " composer-locked" : ""}`}>
          <textarea
            ref={textarea}
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void submit();
            }}
            placeholder="e.g. Research the UK EV charging market and produce an investment memo with risks, unit economics, and a 12-month entry plan…"
            rows={5}
            maxLength={20_000}
            aria-label="Describe the outcome for the workforce"
          />
          <div className="composer-bar">
            <div className="composer-hint">
              <Icon name="sparkles" size={14} />
              {goal.trim().length > 0 ? `${goal.trim().length.toLocaleString()} characters` : "⌘ / Ctrl + Enter to deploy"}
            </div>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void submit()}
              disabled={submitting || !llmReady}
            >
              {submitting ? <Spinner label="Deploying" /> : <><Icon name="send" size={15} /> Deploy workforce</>}
            </button>
          </div>
        </div>

        {!llmReady ? (
          <div className="inline-warning">
            <Icon name="alert" size={16} />
            <span>
              No model provider is configured. Add <code>SWARM_LLM_PROVIDER</code>,{" "}
              <code>SWARM_LLM_MODEL</code>, and <code>SWARM_LLM_API_KEY</code> to <code>.env</code>, then restart.
            </span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate("/settings")}>
              View setup
            </button>
          </div>
        ) : null}

        {submitError ? <ErrorNote message={submitError} /> : null}

        <div className="prompt-examples">
          <span>Start from an example</span>
          <div className="example-chips">
            {EXAMPLES.map((example) => (
              <button
                type="button"
                key={example.label}
                className="example-chip"
                onClick={() => {
                  setGoal(example.goal);
                  textarea.current?.focus();
                }}
              >
                <Icon name={example.icon} size={14} />
                {example.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="metric-grid">
        <Metric
          label="Active runs"
          value={stats?.activeRuns ?? 0}
          sub={`${stats?.runs ?? 0} total in workspace`}
          icon="zap"
          tone="accent"
        />
        <Metric
          label="Specialists"
          value={specialists}
          sub={`${domainPacks.length} domain packs available`}
          icon="users"
          tone="info"
        />
        <Metric
          label="Pending approvals"
          value={stats?.pendingApprovals ?? 0}
          sub="Human decisions waiting"
          icon="shield"
          tone={stats?.pendingApprovals ? "warning" : "neutral"}
        />
        <Metric
          label="Artifacts"
          value={stats?.artifacts ?? 0}
          sub="Deliverables and evidence"
          icon="artifacts"
          tone="neutral"
        />
      </section>

      <div className="command-columns">
        <section className="panel recent-panel">
          <SectionTitle
            title="Recent runs"
            hint="Every run is persisted with its plan, actions, and outputs."
            action={
              <button type="button" className="btn btn-ghost btn-sm" onClick={runs.refresh}>
                <Icon name="refresh" size={14} /> Refresh
              </button>
            }
          />
          {runs.error ? <ErrorNote message={runs.error} onRetry={runs.refresh} /> : null}
          {runs.loading && !runs.data ? (
            <div className="loading-row"><Spinner label="Loading runs" /></div>
          ) : runs.data && runs.data.runs.length > 0 ? (
            <div className="run-list">
              {runs.data.runs.map((run) => (
                <button
                  type="button"
                  className="run-row"
                  key={run.id}
                  onClick={() => navigate(`/run/${run.id}`)}
                >
                  <div className="run-row-main">
                    <div className="run-row-title">
                      <StatusPill status={run.status} />
                      <strong>{runTitle(run)}</strong>
                    </div>
                    <p>{run.goal}</p>
                  </div>
                  <div className="run-row-meta">
                    <span>{timeAgo(run.createdAt)}</span>
                    <Icon name="chevron-right" size={16} />
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <EmptyState
              icon="sparkles"
              title="No runs yet"
              description="Your first workforce deployment will appear here with its live status and deliverables."
            />
          )}
        </section>

        <div className="side-stack">
          <section className="panel operating-panel">
            <SectionTitle title="Operating loop" hint="Deterministic orchestration around a dynamic workforce." />
            <ol className="operating-loop">
              <li>
                <span className="loop-index">01</span>
                <div><strong>Interpret</strong><p>Extract the objective, constraints, and domains.</p></div>
              </li>
              <li>
                <span className="loop-index">02</span>
                <div><strong>Compose</strong><p>Select specialists and build a dependency-aware plan.</p></div>
              </li>
              <li>
                <span className="loop-index">03</span>
                <div><strong>Execute</strong><p>Run real tools under policy, approval, and budget gates.</p></div>
              </li>
              <li>
                <span className="loop-index">04</span>
                <div><strong>Deliver</strong><p>Review outputs, synthesize the final artifact, retain evidence.</p></div>
              </li>
            </ol>
            <div className="operating-footer">
              <Badge tone="accent">Approval-gated</Badge>
              <Badge tone="neutral">Idempotent tools</Badge>
              <Badge tone="neutral">Full audit trail</Badge>
            </div>
          </section>

          <section className="panel activity-panel">
            <SectionTitle
              title="Live activity"
              action={
                <button type="button" className="icon-button" onClick={() => navigate("/activity")} aria-label="All activity">
                  <Icon name="arrow-right" size={16} />
                </button>
              }
            />
            {activity.data && activity.data.activities.length > 0 ? (
              <ul className="mini-timeline">
                {activity.data.activities.slice(0, 6).map((entry) => (
                  <li key={entry.id} className={`level-${entry.level}`}>
                    <span className="timeline-dot" />
                    <div>
                      <p>{entry.message}</p>
                      <small>{timeAgo(entry.createdAt)}</small>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted-copy">No activity yet. Deploy a workforce to see the loop in motion.</p>
            )}
          </section>
        </div>
      </div>

      {workspace ? (
        <div className="command-footnote">
          <Icon name="lock" size={14} />
          Workspace <strong>{workspace.name}</strong> is stored locally. Credentials are encrypted server-side and never sent to the browser.
        </div>
      ) : null}
    </div>
  );
}
