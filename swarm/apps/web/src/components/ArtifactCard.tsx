import { useState } from "react";
import type { Artifact } from "../types.js";
import { downloadArtifact, errorMessage } from "../lib/api.js";
import { formatBytes, timeAgo } from "../lib/format.js";
import { useToast } from "./Toast.js";
import { Badge } from "./ui.js";
import { Icon } from "./Icon.js";

const FORMAT_ICON = {
  markdown: "file",
  text: "file",
  json: "terminal",
  csv: "layers",
  html: "globe",
} as const;

export function ArtifactCard({
  artifact,
  onOpen,
}: {
  artifact: Artifact;
  onOpen: (id: string) => void;
}) {
  const toast = useToast();
  const [downloading, setDownloading] = useState(false);

  const download = async () => {
    setDownloading(true);
    try {
      await downloadArtifact(artifact.id, artifact.filename);
    } catch (caught) {
      toast(errorMessage(caught), "error");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="artifact-card">
      <div className="artifact-card-top">
        <span className={`artifact-glyph format-${artifact.format}`}>
          <Icon name={FORMAT_ICON[artifact.format]} size={18} />
        </span>
        <div className="artifact-card-badges">
          <Badge tone={artifact.kind === "final" ? "accent" : "neutral"}>{artifact.kind}</Badge>
          <Badge tone="info">{artifact.format}</Badge>
        </div>
      </div>
      <button type="button" className="artifact-card-title" onClick={() => onOpen(artifact.id)}>
        {artifact.title}
      </button>
      <p className="artifact-card-file">{artifact.filename}</p>
      <div className="artifact-card-foot">
        <span>{formatBytes(artifact.sizeBytes)} · {timeAgo(artifact.createdAt)}</span>
        <div className="artifact-card-actions">
          <button type="button" className="icon-button" onClick={() => onOpen(artifact.id)} title="Preview">
            <Icon name="eye" size={15} />
          </button>
          <button type="button" className="icon-button" onClick={() => void download()} disabled={downloading} title="Download">
            <Icon name="download" size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}
