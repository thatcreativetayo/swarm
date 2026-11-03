import type { Context } from "hono";
import { ZodError, type ZodType } from "zod";
import { redactValue } from "@swarm/core";
import type { AppContext } from "./context.js";

export type ApiStatus = 400 | 401 | 403 | 404 | 409 | 413 | 422 | 429 | 500 | 502;

export class ApiError extends Error {
  readonly status: ApiStatus;
  readonly details?: unknown;

  constructor(status: ApiStatus, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

export async function readBody<T>(c: Context, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new ApiError(400, "Request body must be valid JSON.");
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new ApiError(
      422,
      "Request validation failed.",
      result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    );
  }
  return result.data;
}

export function errorResponse(c: Context, error: unknown): Response {
  if (error instanceof ApiError) {
    return c.json(
      { error: error.message, ...(error.details === undefined ? {} : { details: error.details }) },
      error.status,
    );
  }
  if (error instanceof ZodError) {
    return c.json(
      {
        error: "Request validation failed.",
        details: error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      422,
    );
  }
  const message = error instanceof Error ? error.message : "Unexpected server error.";
  return c.json({ error: message }, 500);
}

export function requireWorkspace(ctx: AppContext, workspaceId: string) {
  const workspace = ctx.store.getWorkspace(workspaceId);
  if (!workspace) throw new ApiError(404, "Workspace not found.");
  return workspace;
}

export function requireRun(ctx: AppContext, runId: string) {
  const run = ctx.store.getRun(runId);
  if (!run) throw new ApiError(404, "Run not found.");
  return run;
}

export function workspaceStats(ctx: AppContext, workspaceId: string) {
  const runs = ctx.store.listRuns(workspaceId, 500);
  const artifacts = ctx.store.listArtifactsByWorkspace(workspaceId, 500);
  return {
    runs: runs.length,
    activeRuns: runs.filter((run) =>
      ["interpreting", "planning", "executing", "awaiting_approval", "reviewing"].includes(run.status),
    ).length,
    pendingApprovals: ctx.store.listPendingApprovals(workspaceId).length,
    artifacts: artifacts.length,
  };
}

function redacted<T>(value: T): unknown {
  return redactValue(value);
}

export function runDetail(ctx: AppContext, runId: string) {
  const run = ctx.store.getRun(runId);
  if (!run) return null;
  const workspace = ctx.store.getWorkspace(run.workspaceId);
  const agents = ctx.store.listAgents(run.id);
  const tasks = ctx.store.listTasks(run.id);
  const approvals = ctx.store.listApprovalsByRun(run.id).map((approval) => ({
    ...approval,
    payload: redacted(approval.payload),
  }));
  const artifacts = ctx.store.listArtifactsByRun(run.id);
  const activities = ctx.store.listActivities(run.id, 200).map((activity) => ({
    ...activity,
    data: redacted(activity.data),
  }));
  const toolExecutions = ctx.store.listToolExecutions(run.id).map((execution) => ({
    ...execution,
    input: redacted(execution.input),
    output: redacted(execution.output),
  }));
  const modelCalls = ctx.store.listModelCalls(run.id);
  const jobs = ctx.store.listJobsForRun(run.id).map((job) => ({
    id: job.id,
    type: job.type,
    status: job.status,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    lastError: job.lastError,
    updatedAt: job.updatedAt,
  }));

  return {
    run,
    workspace,
    agents,
    tasks,
    approvals,
    artifacts,
    activities,
    toolExecutions,
    modelCalls,
    jobs,
    usage: ctx.store.getRunUsage(run.id),
  };
}

export function snapshotFor(ctx: AppContext, runId: string) {
  const detail = runDetail(ctx, runId);
  if (!detail) return null;
  return {
    run: detail.run,
    agents: detail.agents,
    tasks: detail.tasks,
    approvals: detail.approvals,
    artifacts: detail.artifacts,
    activities: detail.activities.slice(0, 80),
    toolExecutions: detail.toolExecutions.slice(-40),
    usage: detail.usage,
    jobs: detail.jobs,
  };
}
