import { useMemo, useState } from "react";
import { useWorkspace } from "../AppContext.js";
import { useApi } from "../lib/useApi.js";
import type { Artifact } from "../types.js";
import { ArtifactCard } from "../components/ArtifactCard.js";
import { ArtifactViewer } from "../components/ArtifactViewer.js";
import { Icon } from "../components/Icon.js";
import { EmptyState, ErrorNote, Metric, PageHeader, Spinner } from "../components/ui.js";

const KINDS = ["all", "final", "deliverable", "supporting", "review"] as const;
type Kind = (typeof KINDS)[number];

export function ArtifactsPage() {
  const { workspaceId } = useWorkspace();
  const [kind, setKind] = useState<Kind>("all");
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const artifacts = useApi<{ artifacts: Artifact[] }>(
    workspaceId ? `/api/workspaces/${encodeURIComponent(workspaceId)}/artifacts?limit=500` : null,
    [workspaceId],
    { pollMs: 10000 },
  );

  const all = artifacts.data?.artifacts ?? [];
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return all.filter((artifact) => {
      if (kind !== "all" && artifact.kind !== kind) return false;
      if (!term) return true;
      return `${artifact.title} ${artifact.filename}`.toLowerCase().includes(term);
    });
  }, [all, kind, search]);

  const counts = useMemo(() => {
    const result: Record<string, number> = {};
    for (const artifact of all) result[artifact.kind] = (result[artifact.kind] ?? 0) + 1;
    return result;
  }, [all]);

  return (
    <div className="page">
      <PageHeader
        eyebrow="Evidence locker"
        title="Artifacts"
        description="Final deliverables, specialist drafts, datasets, reviews, and supporting evidence. Everything is persisted and downloadable."
        actions={
          <div className="search-wrap">
            <Icon name="search" size={15} />
            <input
              className="input"
              placeholder="Search artifacts…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        }
      />

      <section className="metric-grid">
        <Metric label="All artifacts" value={all.length} sub="Across the workspace" icon="artifacts" tone="accent" />
        <Metric label="Final" value={counts.final ?? 0} sub="Synthesized run deliverables" icon="check-circle" tone="info" />
        <Metric label="Deliverables" value={counts.deliverable ?? 0} sub="Specialist outputs" icon="file" />
        <Metric label="Supporting" value={counts.supporting ?? 0} sub="Research and evidence" icon="layers" />
      </section>

      <div className="filter-row">
        <div className="segmented">
          {KINDS.map((entry) => (
            <button
              type="button"
              key={entry}
              className={`segment${kind === entry ? " active" : ""}`}
              onClick={() => setKind(entry)}
            >
              {entry}
              {entry !== "all" && counts[entry] ? <span>{counts[entry]}</span> : null}
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={artifacts.refresh}>
          <Icon name="refresh" size={14} /> Refresh
        </button>
      </div>

      {artifacts.error ? <ErrorNote message={artifacts.error} onRetry={artifacts.refresh} /> : null}

      {artifacts.loading && !artifacts.data ? (
        <div className="loading-screen"><Spinner label="Loading artifacts" /></div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="artifacts"
          title={all.length === 0 ? "No artifacts yet" : "No artifacts match this filter"}
          description={all.length === 0 ? "Artifacts collect here as specialists produce deliverables and evidence." : "Try a different kind or clear the search."}
        />
      ) : (
        <div className="artifact-grid wide">
          {filtered.map((artifact) => (
            <ArtifactCard key={artifact.id} artifact={artifact} onOpen={setOpenId} />
          ))}
        </div>
      )}

      <ArtifactViewer artifactId={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}
