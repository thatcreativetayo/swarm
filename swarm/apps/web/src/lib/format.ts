import type { Run, RunStatus, Task, TaskStatus } from "../types.js";

export function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "—";
  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatClock(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function formatDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function shortId(id: string): string {
  return id.length > 14 ? `${id.slice(0, 9)}…${id.slice(-4)}` : id;
}

export function runTitle(run: Run): string {
  if (run.title?.trim()) return run.title;
  const first = run.goal.split(/\r?\n/)[0]?.trim() ?? "Untitled run";
  return first.length > 92 ? `${first.slice(0, 92)}…` : first;
}

export function statusLabel(status: RunStatus | TaskStatus | string): string {
  return status.replaceAll("_", " ");
}

export function statusTone(status: string): "success" | "danger" | "warning" | "info" | "neutral" | "active" {
  if (status === "completed" || status === "done" || status === "succeeded" || status === "approved" || status === "pass") {
    return "success";
  }
  if (status === "failed" || status === "error" || status === "denied" || status === "fail") return "danger";
  if (status === "awaiting_approval" || status === "expired" || status === "warning" || status === "partial") {
    return "warning";
  }
  if (status === "running" || status === "executing" || status === "working" || status === "planning" || status === "interpreting") {
    return "active";
  }
  if (status === "reviewing" || status === "ready" || status === "requested" || status === "queued") return "info";
  return "neutral";
}

export function isTerminal(status: RunStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

export function taskAgentName(task: Task, agents: Array<{ id: string; name: string }>): string {
  if (!task.agentId) return "Unassigned";
  return agents.find((agent) => agent.id === task.agentId)?.name ?? "Specialist";
}

export function extractDeliverable(output: unknown): { title: string; content: string; summary: string } | null {
  if (!output || typeof output !== "object") return null;
  const record = output as Record<string, unknown>;
  const deliverable = record.deliverable;
  if (!deliverable || typeof deliverable !== "object") return null;
  const entry = deliverable as Record<string, unknown>;
  if (typeof entry.content !== "string") return null;
  return {
    title: typeof entry.title === "string" ? entry.title : "Deliverable",
    content: entry.content,
    summary: typeof record.summary === "string" ? record.summary : "",
  };
}

export function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? "null";
  } catch {
    return String(value);
  }
}

export function truncate(value: string, max = 180): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…`;
}
