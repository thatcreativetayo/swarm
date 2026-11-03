import { useState } from "react";
import type { Artifact } from "../types.js";
import { useApi } from "../lib/useApi.js";
import { downloadArtifact, errorMessage } from "../lib/api.js";
import { formatBytes, prettyJson } from "../lib/format.js";
import { useToast } from "./Toast.js";
import { Modal, Spinner, ErrorNote, Badge } from "./ui.js";
import { Markdown } from "./Markdown.js";
import { Icon } from "./Icon.js";

function CsvTable({ content }: { content: string }) {
  const rows = content
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => line.split(",").map((cell) => cell.trim().replace(/^"|"$/g, "")));
  if (rows.length === 0) return <p className="muted-copy">Empty CSV.</p>;
  const [header, ...body] = rows;
  return (
    <div className="md-table-wrap">
      <table>
        <thead>
          <tr>
            {(header ?? []).map((cell, index) => (
              <th key={index}>{cell}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {(header ?? []).map((_, cellIndex) => (
                <td key={cellIndex}>{row[cellIndex] ?? ""}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ArtifactViewer({
  artifactId,
  onClose,
}: {
  artifactId: string | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const { data, error, loading, refresh } = useApi<{ artifact: Artifact; content: string }>(
    artifactId ? `/api/artifacts/${encodeURIComponent(artifactId)}` : null,
    [artifactId],
  );
  const [downloading, setDownloading] = useState(false);

  const download = async () => {
    if (!data) return;
    setDownloading(true);
    try {
      await downloadArtifact(data.artifact.id, data.artifact.filename);
    } catch (caught) {
      toast(errorMessage(caught), "error");
    } finally {
      setDownloading(false);
    }
  };

  const artifact = data?.artifact;
  return (
    <Modal
      open={Boolean(artifactId)}
      onClose={onClose}
      title={artifact?.title ?? "Artifact"}
      subtitle={artifact ? `${artifact.filename} · ${formatBytes(artifact.sizeBytes)} · ${artifact.kind}` : undefined}
      wide
    >
      {loading && !data ? <div className="loading-row"><Spinner label="Loading artifact" /></div> : null}
      {error ? <ErrorNote message={error} onRetry={refresh} /> : null}
      {artifact && data ? (
        <>
          <div className="artifact-toolbar">
            <div className="artifact-tags">
              <Badge tone="accent">{artifact.format}</Badge>
              <Badge tone="neutral">{artifact.kind}</Badge>
              <span className="muted-copy">{new Date(artifact.createdAt).toLocaleString()}</span>
            </div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void download()} disabled={downloading}>
              <Icon name="download" size={14} /> {downloading ? "Downloading…" : "Download"}
            </button>
          </div>
          <div className="artifact-content">
            {artifact.format === "markdown" ? <Markdown content={data.content} /> : null}
            {artifact.format === "json" ? (
              <pre className="code-block">{prettyJson(JSON.parse(data.content || "null"))}</pre>
            ) : null}
            {artifact.format === "csv" ? <CsvTable content={data.content} /> : null}
            {artifact.format === "html" ? (
              <>
                <div className="inline-warning">
                  <Icon name="shield" size={16} />
                  <span>HTML is shown as source and is never executed inside the SWARM UI.</span>
                </div>
                <pre className="code-block">{data.content}</pre>
              </>
            ) : null}
            {artifact.format === "text" ? <pre className="code-block">{data.content}</pre> : null}
          </div>
        </>
      ) : null}
    </Modal>
  );
}
