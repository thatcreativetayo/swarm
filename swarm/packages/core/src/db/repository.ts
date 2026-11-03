import { z } from "zod";
import type {
  Activity,
  ActivityLevel,
  Agent,
  Approval,
  ApprovalStatus,
  Artifact,
  ArtifactFormat,
  Job,
  JsonValue,
  McpServer,
  McpTool,
  Memory,
  ModelCall,
  Run,
  RunStatus,
  Task,
  TaskStatus,
  ToolExecution,
  Workspace,
} from "../contracts/common.js";
import { newId, nowIso, slugify } from "../utils/id.js";
import { jsonStringify, safeJsonParse } from "../utils/json.js";
import type { SwarmDatabase } from "./database.js";

export const WorkspaceSettingsSchema = z.object({
  autoApproveReadOnlyMcp: z.boolean().default(false),
  allowExternalHttpWrites: z.boolean().default(false),
  maxAgents: z.number().int().min(1).max(12).optional(),
  maxTasks: z.number().int().min(1).max(24).optional(),
});
export type WorkspaceSettings = z.infer<typeof WorkspaceSettingsSchema>;

export const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettings = {
  autoApproveReadOnlyMcp: false,
  allowExternalHttpWrites: false,
};

type Row = Record<string, unknown>;

function text(row: Row, key: string): string {
  return String(row[key] ?? "");
}
function nullableText(row: Row, key: string): string | null {
  const value = row[key];
  return value === null || value === undefined ? null : String(value);
}
function number(row: Row, key: string): number {
  return Number(row[key] ?? 0);
}
function bool(row: Row, key: string): boolean {
  return Number(row[key] ?? 0) === 1;
}
function json<T>(row: Row, key: string, fallback: T): T {
  const value = row[key];
  if (typeof value !== "string") return fallback;
  return safeJsonParse<T>(value, fallback);
}

function mapWorkspace(row: Row): Workspace {
  return {
    id: text(row, "id"),
    name: text(row, "name"),
    slug: text(row, "slug"),
    createdAt: text(row, "created_at"),
    updatedAt: text(row, "updated_at"),
  };
}
function mapRun(row: Row): Run {
  return {
    id: text(row, "id"),
    workspaceId: text(row, "workspace_id"),
    goal: text(row, "goal"),
    title: nullableText(row, "title"),
    summary: nullableText(row, "summary"),
    status: text(row, "status") as RunStatus,
    interpretation: json<JsonValue | null>(row, "interpretation_json", null),
    plan: json<JsonValue | null>(row, "plan_json", null),
    error: nullableText(row, "error"),
    createdAt: text(row, "created_at"),
    startedAt: nullableText(row, "started_at"),
    completedAt: nullableText(row, "completed_at"),
    cancelledAt: nullableText(row, "cancelled_at"),
  };
}
function mapAgent(row: Row): Agent {
  return {
    id: text(row, "id"),
    runId: text(row, "run_id"),
    workspaceId: text(row, "workspace_id"),
    definitionKey: text(row, "definition_key"),
    domainPack: text(row, "domain_pack"),
    name: text(row, "name"),
    role: text(row, "role"),
    status: text(row, "status") as Agent["status"],
    model: nullableText(row, "model"),
    createdAt: text(row, "created_at"),
  };
}
function mapTask(row: Row): Task {
  return {
    id: text(row, "id"),
    runId: text(row, "run_id"),
    workspaceId: text(row, "workspace_id"),
    agentId: nullableText(row, "agent_id"),
    key: text(row, "task_key"),
    title: text(row, "title"),
    description: text(row, "description"),
    status: text(row, "status") as TaskStatus,
    priority: number(row, "priority"),
    dependsOn: json<string[]>(row, "depends_on_json", []),
    deliverable: text(row, "deliverable"),
    evaluationCriteria: json<string[]>(row, "evaluation_criteria_json", []),
    input: json<JsonValue | null>(row, "input_json", null),
    output: json<JsonValue | null>(row, "output_json", null),
    artifactId: nullableText(row, "artifact_id"),
    attempts: number(row, "attempts"),
    maxAttempts: number(row, "max_attempts"),
    error: nullableText(row, "error"),
    createdAt: text(row, "created_at"),
    updatedAt: text(row, "updated_at"),
    startedAt: nullableText(row, "started_at"),
    completedAt: nullableText(row, "completed_at"),
  };
}
function mapApproval(row: Row): Approval {
  return {
    id: text(row, "id"),
    runId: text(row, "run_id"),
    workspaceId: text(row, "workspace_id"),
    taskId: nullableText(row, "task_id"),
    agentId: nullableText(row, "agent_id"),
    kind: text(row, "kind") as Approval["kind"],
    status: text(row, "status") as ApprovalStatus,
    title: text(row, "title"),
    summary: text(row, "summary"),
    payload: json<JsonValue>(row, "payload_json", {}),
    decisionReason: nullableText(row, "decision_reason"),
    createdAt: text(row, "created_at"),
    decidedAt: nullableText(row, "decided_at"),
    expiresAt: nullableText(row, "expires_at"),
  };
}
function mapArtifact(row: Row): Artifact {
  return {
    id: text(row, "id"),
    runId: text(row, "run_id"),
    workspaceId: text(row, "workspace_id"),
    taskId: nullableText(row, "task_id"),
    agentId: nullableText(row, "agent_id"),
    kind: text(row, "kind") as Artifact["kind"],
    format: text(row, "format") as ArtifactFormat,
    title: text(row, "title"),
    filename: text(row, "filename"),
    mimeType: text(row, "mime_type"),
    sizeBytes: number(row, "size_bytes"),
    createdAt: text(row, "created_at"),
  };
}
function mapActivity(row: Row): Activity {
  return {
    id: text(row, "id"),
    runId: nullableText(row, "run_id"),
    workspaceId: text(row, "workspace_id"),
    taskId: nullableText(row, "task_id"),
    agentId: nullableText(row, "agent_id"),
    type: text(row, "type"),
    level: text(row, "level") as ActivityLevel,
    message: text(row, "message"),
    data: json<JsonValue | null>(row, "data_json", null),
    createdAt: text(row, "created_at"),
  };
}
function mapMcpServer(row: Row): McpServer {
  return {
    id: text(row, "id"),
    workspaceId: text(row, "workspace_id"),
    name: text(row, "name"),
    transport: text(row, "transport") as McpServer["transport"],
    url: nullableText(row, "url"),
    command: json<string[] | null>(row, "command_json", null),
    status: text(row, "status") as McpServer["status"],
    lastError: nullableText(row, "last_error"),
    createdAt: text(row, "created_at"),
    updatedAt: text(row, "updated_at"),
  };
}
function mapMcpTool(row: Row): McpTool {
  return {
    id: text(row, "id"),
    serverId: text(row, "server_id"),
    name: text(row, "name"),
    description: text(row, "description"),
    inputSchema: json<JsonValue>(row, "input_schema_json", {}),
    requiresApproval: bool(row, "requires_approval"),
    discoveredAt: text(row, "discovered_at"),
  };
}
function mapJob(row: Row): Job {
  return {
    id: text(row, "id"),
    type: text(row, "type") as Job["type"],
    runId: text(row, "run_id"),
    taskId: nullableText(row, "task_id"),
    status: text(row, "status") as Job["status"],
    attempts: number(row, "attempts"),
    maxAttempts: number(row, "max_attempts"),
    availableAt: text(row, "available_at"),
    leaseUntil: nullableText(row, "lease_until"),
    idempotencyKey: text(row, "idempotency_key"),
    payload: json<JsonValue | null>(row, "payload_json", null),
    lastError: nullableText(row, "last_error"),
    createdAt: text(row, "created_at"),
    updatedAt: text(row, "updated_at"),
  };
}

export class Store {
  constructor(readonly database: SwarmDatabase) {}

  private get db() {
    return this.database.db;
  }

  // -------------------------------------------------------------------------
  // Workspaces
  // -------------------------------------------------------------------------
  createWorkspace(name: string, slug = slugify(name)): Workspace {
    const id = newId("ws");
    const now = nowIso();
    let candidate = slug;
    let suffix = 2;
    while (this.getWorkspaceBySlug(candidate)) {
      candidate = `${slug}-${suffix++}`;
    }
    this.db
      .prepare(
        "INSERT INTO workspaces (id, name, slug, settings_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(id, name, candidate, jsonStringify(DEFAULT_WORKSPACE_SETTINGS), now, now);
    return this.getWorkspace(id)!;
  }

  listWorkspaces(): Workspace[] {
    return (this.db.prepare("SELECT * FROM workspaces ORDER BY created_at ASC").all() as Row[]).map(
      mapWorkspace,
    );
  }

  getWorkspace(id: string): Workspace | null {
    const row = this.db.prepare("SELECT * FROM workspaces WHERE id = ?").get(id) as Row | undefined;
    return row ? mapWorkspace(row) : null;
  }

  getWorkspaceBySlug(slug: string): Workspace | null {
    const row = this.db.prepare("SELECT * FROM workspaces WHERE slug = ?").get(slug) as
      | Row
      | undefined;
    return row ? mapWorkspace(row) : null;
  }

  updateWorkspace(id: string, patch: { name?: string; settings?: Partial<WorkspaceSettings> }): Workspace {
    const current = this.getWorkspace(id);
    if (!current) throw new Error(`Workspace not found: ${id}`);
    const settings = WorkspaceSettingsSchema.parse({
      ...this.getWorkspaceSettings(id),
      ...patch.settings,
    });
    this.db
      .prepare("UPDATE workspaces SET name = ?, settings_json = ?, updated_at = ? WHERE id = ?")
      .run(patch.name ?? current.name, jsonStringify(settings), nowIso(), id);
    return this.getWorkspace(id)!;
  }

  getWorkspaceSettings(id: string): WorkspaceSettings {
    const row = this.db.prepare("SELECT settings_json FROM workspaces WHERE id = ?").get(id) as
      | Row
      | undefined;
    return WorkspaceSettingsSchema.parse(json<Partial<WorkspaceSettings>>(row ?? {}, "settings_json", {}));
  }

  // -------------------------------------------------------------------------
  // Runs
  // -------------------------------------------------------------------------
  createRun(workspaceId: string, goal: string): Run {
    const id = newId("run");
    const now = nowIso();
    this.db
      .prepare(
        "INSERT INTO runs (id, workspace_id, goal, status, created_at) VALUES (?, ?, ?, 'interpreting', ?)",
      )
      .run(id, workspaceId, goal, now);
    return this.getRun(id)!;
  }

  getRun(id: string): Run | null {
    const row = this.db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as Row | undefined;
    return row ? mapRun(row) : null;
  }

  listRuns(workspaceId: string, limit = 50): Run[] {
    return (
      this.db
        .prepare("SELECT * FROM runs WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?")
        .all(workspaceId, limit) as Row[]
    ).map(mapRun);
  }

  updateRun(
    id: string,
    patch: {
      title?: string | null;
      summary?: string | null;
      status?: RunStatus;
      error?: string | null;
      startedAt?: string | null;
      completedAt?: string | null;
      cancelledAt?: string | null;
    },
  ): Run {
    const current = this.getRun(id);
    if (!current) throw new Error(`Run not found: ${id}`);
    this.db
      .prepare(
        `UPDATE runs SET title = ?, summary = ?, status = ?, error = ?, started_at = ?, completed_at = ?, cancelled_at = ? WHERE id = ?`,
      )
      .run(
        patch.title !== undefined ? patch.title : current.title,
        patch.summary !== undefined ? patch.summary : current.summary,
        patch.status ?? current.status,
        patch.error !== undefined ? patch.error : current.error,
        patch.startedAt !== undefined ? patch.startedAt : current.startedAt,
        patch.completedAt !== undefined ? patch.completedAt : current.completedAt,
        patch.cancelledAt !== undefined ? patch.cancelledAt : current.cancelledAt,
        id,
      );
    return this.getRun(id)!;
  }

  setRunInterpretation(id: string, interpretation: JsonValue): void {
    this.db.prepare("UPDATE runs SET interpretation_json = ? WHERE id = ?").run(jsonStringify(interpretation), id);
  }

  setRunPlan(id: string, plan: JsonValue): void {
    this.db.prepare("UPDATE runs SET plan_json = ? WHERE id = ?").run(jsonStringify(plan), id);
  }

  requestCancel(id: string): Run {
    const now = nowIso();
    this.db
      .prepare(
        "UPDATE runs SET cancel_requested = 1, status = 'cancelled', cancelled_at = ?, completed_at = ? WHERE id = ? AND status NOT IN ('completed','failed','cancelled')",
      )
      .run(now, now, id);
    this.db.prepare("UPDATE jobs SET status = 'done' WHERE run_id = ? AND status = 'queued'").run(id);
    return this.getRun(id)!;
  }

  isCancelRequested(id: string): boolean {
    const row = this.db.prepare("SELECT cancel_requested FROM runs WHERE id = ?").get(id) as Row | undefined;
    return row ? bool(row, "cancel_requested") : false;
  }

  incrementRunUsage(id: string, calls: number, tokens: number, costUsd: number): void {
    this.db
      .prepare(
        "UPDATE runs SET model_calls = model_calls + ?, total_tokens = total_tokens + ?, cost_usd = cost_usd + ? WHERE id = ?",
      )
      .run(calls, tokens, costUsd, id);
  }

  getRunUsage(id: string): { modelCalls: number; totalTokens: number; costUsd: number } {
    const row = this.db
      .prepare("SELECT model_calls, total_tokens, cost_usd FROM runs WHERE id = ?")
      .get(id) as Row | undefined;
    return {
      modelCalls: row ? number(row, "model_calls") : 0,
      totalTokens: row ? number(row, "total_tokens") : 0,
      costUsd: row ? number(row, "cost_usd") : 0,
    };
  }

  // -------------------------------------------------------------------------
  // Agents
  // -------------------------------------------------------------------------
  insertAgents(
    runId: string,
    workspaceId: string,
    agents: Array<{
      definitionKey: string;
      domainPack: string;
      name: string;
      role: string;
      model?: string | null;
    }>,
  ): Agent[] {
    const now = nowIso();
    const insert = this.db.prepare(
      "INSERT INTO agents (id, run_id, workspace_id, definition_key, domain_pack, name, role, status, model, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'idle', ?, ?)",
    );
    return this.database.transaction(() =>
      agents.map((agent) => {
        const id = newId("agent");
        insert.run(id, runId, workspaceId, agent.definitionKey, agent.domainPack, agent.name, agent.role, agent.model ?? null, now);
        return this.getAgent(id)!;
      }),
    );
  }

  listAgents(runId: string): Agent[] {
    return (this.db.prepare("SELECT * FROM agents WHERE run_id = ? ORDER BY created_at ASC").all(runId) as Row[]).map(mapAgent);
  }

  listAgentsByWorkspace(workspaceId: string, limit = 200): Agent[] {
    return (
      this.db
        .prepare("SELECT * FROM agents WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?")
        .all(workspaceId, limit) as Row[]
    ).map(mapAgent);
  }

  getAgent(id: string): Agent | null {
    const row = this.db.prepare("SELECT * FROM agents WHERE id = ?").get(id) as Row | undefined;
    return row ? mapAgent(row) : null;
  }

  updateAgentStatus(id: string, status: Agent["status"]): void {
    this.db.prepare("UPDATE agents SET status = ? WHERE id = ?").run(status, id);
  }

  // -------------------------------------------------------------------------
  // Tasks
  // -------------------------------------------------------------------------
  insertTasks(
    runId: string,
    workspaceId: string,
    tasks: Array<{
      key: string;
      title: string;
      description: string;
      status: TaskStatus;
      priority: number;
      dependsOn: string[];
      deliverable: string;
      evaluationCriteria: string[];
      agentId: string | null;
      maxAttempts: number;
    }>,
  ): Task[] {
    const now = nowIso();
    const insert = this.db.prepare(
      `INSERT INTO tasks (id, run_id, workspace_id, agent_id, task_key, title, description, status, priority, depends_on_json, deliverable, evaluation_criteria_json, attempts, max_attempts, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
    );
    return this.database.transaction(() => {
      const created = tasks.map((task) => {
        const id = newId("task");
        insert.run(
          id,
          runId,
          workspaceId,
          task.agentId,
          task.key,
          task.title,
          task.description,
          task.status,
          task.priority,
          jsonStringify(task.dependsOn),
          task.deliverable,
          jsonStringify(task.evaluationCriteria),
          task.maxAttempts,
          now,
          now,
        );
        return this.getTask(id)!;
      });
      const byKey = new Map(created.map((task) => [task.key, task]));
      const insertDependency = this.db.prepare(
        "INSERT INTO task_dependencies (task_id, depends_on_task_id) VALUES (?, ?)",
      );
      for (const task of tasks) {
        const current = byKey.get(task.key)!;
        for (const dependencyKey of task.dependsOn) {
          const dependency = byKey.get(dependencyKey);
          if (!dependency) throw new Error(`Unknown dependency ${dependencyKey} for task ${task.key}`);
          insertDependency.run(current.id, dependency.id);
        }
      }
      return created;
    });
  }

  listTasks(runId: string): Task[] {
    return (
      this.db
        .prepare("SELECT * FROM tasks WHERE run_id = ? ORDER BY priority DESC, created_at ASC")
        .all(runId) as Row[]
    ).map(mapTask);
  }

  listTasksByWorkspace(workspaceId: string, limit = 200): Task[] {
    return (
      this.db
        .prepare("SELECT * FROM tasks WHERE workspace_id = ? ORDER BY updated_at DESC LIMIT ?")
        .all(workspaceId, limit) as Row[]
    ).map(mapTask);
  }

  getTask(id: string): Task | null {
    const row = this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as Row | undefined;
    return row ? mapTask(row) : null;
  }

  getTaskByKey(runId: string, key: string): Task | null {
    const row = this.db.prepare("SELECT * FROM tasks WHERE run_id = ? AND task_key = ?").get(runId, key) as
      | Row
      | undefined;
    return row ? mapTask(row) : null;
  }

  updateTaskStatus(
    id: string,
    status: TaskStatus,
    patch: { error?: string | null; startedAt?: string | null; completedAt?: string | null } = {},
  ): void {
    const current = this.getTask(id);
    if (!current) throw new Error(`Task not found: ${id}`);
    this.db
      .prepare("UPDATE tasks SET status = ?, error = ?, started_at = ?, completed_at = ?, updated_at = ? WHERE id = ?")
      .run(
        status,
        patch.error !== undefined ? patch.error : current.error,
        patch.startedAt !== undefined ? patch.startedAt : current.startedAt,
        patch.completedAt !== undefined ? patch.completedAt : current.completedAt,
        nowIso(),
        id,
      );
  }

  setTaskOutput(id: string, output: JsonValue, artifactId: string | null): void {
    this.db
      .prepare("UPDATE tasks SET output_json = ?, artifact_id = ?, updated_at = ? WHERE id = ?")
      .run(jsonStringify(output), artifactId, nowIso(), id);
  }

  incrementTaskAttempts(id: string): number {
    this.db.prepare("UPDATE tasks SET attempts = attempts + 1, updated_at = ? WHERE id = ?").run(nowIso(), id);
    return this.getTask(id)?.attempts ?? 0;
  }

  listReadyTasks(runId: string): Task[] {
    return (
      this.db
        .prepare(
          `SELECT t.* FROM tasks t
           WHERE t.run_id = ? AND t.status = 'pending'
             AND NOT EXISTS (
               SELECT 1 FROM task_dependencies d
               JOIN tasks dep ON dep.id = d.depends_on_task_id
               WHERE d.task_id = t.id AND dep.status != 'completed'
             )
           ORDER BY t.priority DESC, t.created_at ASC`,
        )
        .all(runId) as Row[]
    ).map(mapTask);
  }

  dependenciesComplete(taskId: string): boolean {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS total, SUM(CASE WHEN dep.status = 'completed' THEN 1 ELSE 0 END) AS done
         FROM task_dependencies d JOIN tasks dep ON dep.id = d.depends_on_task_id
         WHERE d.task_id = ?`,
      )
      .get(taskId) as Row | undefined;
    return !row || number(row, "total") === number(row, "done");
  }

  countTasksByStatus(runId: string): Record<string, number> {
    const rows = this.db
      .prepare("SELECT status, COUNT(*) AS count FROM tasks WHERE run_id = ? GROUP BY status")
      .all(runId) as Row[];
    return Object.fromEntries(rows.map((row) => [text(row, "status"), number(row, "count")]));
  }

  // -------------------------------------------------------------------------
  // Task runtime state
  // -------------------------------------------------------------------------
  saveTaskRuntime(taskId: string, state: JsonValue): void {
    this.db
      .prepare(
        "INSERT INTO task_runtime (task_id, state_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(task_id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at",
      )
      .run(taskId, jsonStringify(state), nowIso());
  }

  getTaskRuntime<T extends JsonValue = JsonValue>(taskId: string): T | null {
    const row = this.db.prepare("SELECT state_json FROM task_runtime WHERE task_id = ?").get(taskId) as
      | Row
      | undefined;
    return row ? json<T>(row, "state_json", null as T) : null;
  }

  deleteTaskRuntime(taskId: string): void {
    this.db.prepare("DELETE FROM task_runtime WHERE task_id = ?").run(taskId);
  }

  // -------------------------------------------------------------------------
  // Approvals
  // -------------------------------------------------------------------------
  createApproval(input: {
    runId: string;
    workspaceId: string;
    taskId: string | null;
    agentId: string | null;
    kind: Approval["kind"];
    title: string;
    summary: string;
    payload: JsonValue;
    expiresAt?: string | null;
  }): Approval {
    const id = newId("approval");
    const now = nowIso();
    this.db
      .prepare(
        "INSERT INTO approvals (id, run_id, workspace_id, task_id, agent_id, kind, status, title, summary, payload_json, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)",
      )
      .run(
        id,
        input.runId,
        input.workspaceId,
        input.taskId,
        input.agentId,
        input.kind,
        input.title,
        input.summary,
        jsonStringify(input.payload),
        now,
        input.expiresAt ?? null,
      );
    return this.getApproval(id)!;
  }

  getApproval(id: string): Approval | null {
    const row = this.db.prepare("SELECT * FROM approvals WHERE id = ?").get(id) as Row | undefined;
    return row ? mapApproval(row) : null;
  }

  listApprovalsByRun(runId: string): Approval[] {
    return (
      this.db.prepare("SELECT * FROM approvals WHERE run_id = ? ORDER BY created_at DESC").all(runId) as Row[]
    ).map(mapApproval);
  }

  listApprovalsByWorkspace(workspaceId: string, limit = 100): Approval[] {
    return (
      this.db
        .prepare("SELECT * FROM approvals WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?")
        .all(workspaceId, limit) as Row[]
    ).map(mapApproval);
  }

  listPendingApprovals(workspaceId?: string): Approval[] {
    const rows = workspaceId
      ? (this.db
          .prepare("SELECT * FROM approvals WHERE workspace_id = ? AND status = 'pending' ORDER BY created_at ASC")
          .all(workspaceId) as Row[])
      : (this.db.prepare("SELECT * FROM approvals WHERE status = 'pending' ORDER BY created_at ASC").all() as Row[]);
    return rows.map(mapApproval);
  }

  findPendingApprovalForTask(taskId: string): Approval | null {
    const row = this.db
      .prepare("SELECT * FROM approvals WHERE task_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1")
      .get(taskId) as Row | undefined;
    return row ? mapApproval(row) : null;
  }

  decideApproval(id: string, status: "approved" | "denied", reason: string | null): Approval {
    this.db
      .prepare("UPDATE approvals SET status = ?, decision_reason = ?, decided_at = ? WHERE id = ? AND status = 'pending'")
      .run(status, reason, nowIso(), id);
    return this.getApproval(id)!;
  }

  expireApprovals(now = nowIso()): number {
    const result = this.db
      .prepare("UPDATE approvals SET status = 'expired', decided_at = ? WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at <= ?")
      .run(now, now);
    return Number(result.changes);
  }

  listExpiredApprovals(now = nowIso()): Approval[] {
    return (
      this.db
        .prepare(
          "SELECT * FROM approvals WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at <= ? ORDER BY created_at ASC",
        )
        .all(now) as Row[]
    ).map(mapApproval);
  }

  markApprovalExpired(id: string): Approval {
    this.db
      .prepare("UPDATE approvals SET status = 'expired', decided_at = ? WHERE id = ? AND status = 'pending'")
      .run(nowIso(), id);
    return this.getApproval(id)!;
  }

  cancelPendingApprovalsForRun(runId: string): number {
    const result = this.db
      .prepare("UPDATE approvals SET status = 'cancelled', decided_at = ? WHERE run_id = ? AND status = 'pending'")
      .run(nowIso(), runId);
    return Number(result.changes);
  }

  // -------------------------------------------------------------------------
  // Artifacts
  // -------------------------------------------------------------------------
  createArtifact(input: {
    runId: string;
    workspaceId: string;
    taskId: string | null;
    agentId: string | null;
    kind: Artifact["kind"];
    format: ArtifactFormat;
    title: string;
    filename: string;
    mimeType: string;
    content: string;
  }): Artifact {
    const id = newId("artifact");
    this.db
      .prepare(
        `INSERT INTO artifacts (id, run_id, workspace_id, task_id, agent_id, kind, format, title, filename, mime_type, size_bytes, content, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.runId,
        input.workspaceId,
        input.taskId,
        input.agentId,
        input.kind,
        input.format,
        input.title,
        input.filename,
        input.mimeType,
        Buffer.byteLength(input.content, "utf8"),
        input.content,
        nowIso(),
      );
    return this.getArtifact(id)!;
  }

  getArtifact(id: string): Artifact | null {
    const row = this.db.prepare("SELECT * FROM artifacts WHERE id = ?").get(id) as Row | undefined;
    return row ? mapArtifact(row) : null;
  }

  getArtifactContent(id: string): string | null {
    const row = this.db.prepare("SELECT content FROM artifacts WHERE id = ?").get(id) as Row | undefined;
    return row ? text(row, "content") : null;
  }

  listArtifactsByRun(runId: string): Artifact[] {
    return (
      this.db.prepare("SELECT * FROM artifacts WHERE run_id = ? ORDER BY created_at ASC").all(runId) as Row[]
    ).map(mapArtifact);
  }

  listArtifactsByWorkspace(workspaceId: string, limit = 100): Artifact[] {
    return (
      this.db
        .prepare("SELECT * FROM artifacts WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?")
        .all(workspaceId, limit) as Row[]
    ).map(mapArtifact);
  }

  // -------------------------------------------------------------------------
  // Activities + events
  // -------------------------------------------------------------------------
  appendActivity(input: {
    runId: string | null;
    workspaceId: string;
    taskId?: string | null;
    agentId?: string | null;
    type: string;
    level: ActivityLevel;
    message: string;
    data?: JsonValue | null;
  }): Activity {
    const id = newId("act");
    this.db
      .prepare(
        "INSERT INTO activities (id, run_id, workspace_id, task_id, agent_id, type, level, message, data_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        id,
        input.runId,
        input.workspaceId,
        input.taskId ?? null,
        input.agentId ?? null,
        input.type,
        input.level,
        input.message,
        input.data === undefined ? null : jsonStringify(input.data),
        nowIso(),
      );
    const row = this.db.prepare("SELECT * FROM activities WHERE id = ?").get(id) as Row;
    return mapActivity(row);
  }

  listActivities(runId: string, limit = 200): Activity[] {
    return (
      this.db
        .prepare("SELECT * FROM activities WHERE run_id = ? ORDER BY created_at ASC LIMIT ?")
        .all(runId, limit) as Row[]
    ).map(mapActivity);
  }

  listWorkspaceActivities(workspaceId: string, limit = 200): Activity[] {
    return (
      this.db
        .prepare("SELECT * FROM activities WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?")
        .all(workspaceId, limit) as Row[]
    ).map(mapActivity);
  }

  appendRunEvent(runId: string, type: string, data: JsonValue): number {
    const id = newId("evt");
    const result = this.db
      .prepare("INSERT INTO run_events (id, run_id, type, data_json, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(id, runId, type, jsonStringify(data), nowIso());
    return Number(result.lastInsertRowid);
  }

  listRunEvents(runId: string, afterSeq = 0, limit = 500): Array<{ seq: number; type: string; data: JsonValue; createdAt: string }> {
    const rows = this.db
      .prepare("SELECT seq, type, data_json, created_at FROM run_events WHERE run_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?")
      .all(runId, afterSeq, limit) as Row[];
    return rows.map((row) => ({
      seq: number(row, "seq"),
      type: text(row, "type"),
      data: json<JsonValue>(row, "data_json", null as unknown as JsonValue),
      createdAt: text(row, "created_at"),
    }));
  }

  // -------------------------------------------------------------------------
  // Secrets + integrations
  // -------------------------------------------------------------------------
  createSecret(input: {
    workspaceId: string;
    name: string;
    ciphertext: string;
    iv: string;
    tag: string;
  }): string {
    const id = newId("secret");
    const now = nowIso();
    this.db
      .prepare(
        "INSERT INTO secrets (id, workspace_id, name, ciphertext, iv, tag, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)",
      )
      .run(id, input.workspaceId, input.name, input.ciphertext, input.iv, input.tag, now, now);
    return id;
  }

  getSecret(id: string): { ciphertext: string; iv: string; tag: string; version: 1 } | null {
    const row = this.db.prepare("SELECT * FROM secrets WHERE id = ?").get(id) as Row | undefined;
    if (!row) return null;
    return {
      ciphertext: text(row, "ciphertext"),
      iv: text(row, "iv"),
      tag: text(row, "tag"),
      version: 1,
    };
  }

  deleteSecret(id: string): void {
    this.db.prepare("DELETE FROM secrets WHERE id = ?").run(id);
  }

  createIntegration(input: {
    workspaceId: string;
    provider: string;
    name: string;
    config: JsonValue;
    secretId: string | null;
  }): void {
    const id = newId("int");
    const now = nowIso();
    this.db
      .prepare(
        "INSERT INTO integrations (id, workspace_id, provider, name, status, config_json, secret_id, created_at, updated_at) VALUES (?, ?, ?, ?, 'connected', ?, ?, ?, ?)",
      )
      .run(id, input.workspaceId, input.provider, input.name, jsonStringify(input.config), input.secretId, now, now);
  }

  listIntegrations(workspaceId: string): Array<{
    id: string;
    workspaceId: string;
    provider: string;
    name: string;
    status: "connected" | "disconnected" | "error";
    config: JsonValue;
    hasSecret: boolean;
    createdAt: string;
    updatedAt: string;
  }> {
    const rows = this.db
      .prepare("SELECT * FROM integrations WHERE workspace_id = ? ORDER BY created_at ASC")
      .all(workspaceId) as Row[];
    return rows.map((row) => ({
      id: text(row, "id"),
      workspaceId: text(row, "workspace_id"),
      provider: text(row, "provider"),
      name: text(row, "name"),
      status: text(row, "status") as "connected" | "disconnected" | "error",
      config: json<JsonValue>(row, "config_json", {}),
      hasSecret: Boolean(nullableText(row, "secret_id")),
      createdAt: text(row, "created_at"),
      updatedAt: text(row, "updated_at"),
    }));
  }

  getIntegration(workspaceId: string, provider: string): {
    id: string;
    provider: string;
    name: string;
    config: JsonValue;
    secretId: string | null;
  } | null {
    const row = this.db
      .prepare("SELECT * FROM integrations WHERE workspace_id = ? AND provider = ? ORDER BY created_at ASC LIMIT 1")
      .get(workspaceId, provider) as Row | undefined;
    if (!row) return null;
    return {
      id: text(row, "id"),
      provider: text(row, "provider"),
      name: text(row, "name"),
      config: json<JsonValue>(row, "config_json", {}),
      secretId: nullableText(row, "secret_id"),
    };
  }

  updateIntegrationStatus(id: string, status: "connected" | "disconnected" | "error"): void {
    this.db.prepare("UPDATE integrations SET status = ?, updated_at = ? WHERE id = ?").run(status, nowIso(), id);
  }

  deleteIntegration(workspaceId: string, id: string): void {
    const row = this.db.prepare("SELECT secret_id FROM integrations WHERE id = ? AND workspace_id = ?").get(id, workspaceId) as
      | Row
      | undefined;
    this.db.prepare("DELETE FROM integrations WHERE id = ? AND workspace_id = ?").run(id, workspaceId);
    const secretId = row ? nullableText(row, "secret_id") : null;
    if (secretId) this.deleteSecret(secretId);
  }

  // -------------------------------------------------------------------------
  // Memory
  // -------------------------------------------------------------------------
  upsertMemory(workspaceId: string, key: string, content: string, tags: string[] = []): Memory {
    const now = nowIso();
    const existing = this.db
      .prepare("SELECT id, created_at FROM memories WHERE workspace_id = ? AND memory_key = ?")
      .get(workspaceId, key) as Row | undefined;
    if (existing) {
      this.db
        .prepare("UPDATE memories SET content = ?, tags_json = ?, updated_at = ? WHERE id = ?")
        .run(content, jsonStringify(tags), now, text(existing, "id"));
      return this.getMemory(text(existing, "id"))!;
    }
    const id = newId("mem");
    this.db
      .prepare(
        "INSERT INTO memories (id, workspace_id, memory_key, content, tags_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(id, workspaceId, key, content, jsonStringify(tags), now, now);
    return this.getMemory(id)!;
  }

  getMemory(id: string): Memory | null {
    const row = this.db.prepare("SELECT * FROM memories WHERE id = ?").get(id) as Row | undefined;
    if (!row) return null;
    return {
      id: text(row, "id"),
      workspaceId: text(row, "workspace_id"),
      key: text(row, "memory_key"),
      content: text(row, "content"),
      tags: json<string[]>(row, "tags_json", []),
      createdAt: text(row, "created_at"),
      updatedAt: text(row, "updated_at"),
    };
  }

  listMemories(workspaceId: string, limit = 100): Memory[] {
    const rows = this.db
      .prepare("SELECT * FROM memories WHERE workspace_id = ? ORDER BY updated_at DESC LIMIT ?")
      .all(workspaceId, limit) as Row[];
    return rows.map((row) => this.getMemory(text(row, "id"))!);
  }

  searchMemories(workspaceId: string, query: string, limit = 10): Memory[] {
    const terms = query
      .toLowerCase()
      .split(/\s+/)
      .filter((term) => term.length > 2)
      .slice(0, 5);
    if (terms.length === 0) return this.listMemories(workspaceId, limit);
    const clauses = terms.map(() => "(LOWER(memory_key) LIKE ? OR LOWER(content) LIKE ?)").join(" OR ");
    const params = terms.flatMap((term) => [`%${term}%`, `%${term}%`]);
    const rows = this.db
      .prepare(`SELECT * FROM memories WHERE workspace_id = ? AND (${clauses}) ORDER BY updated_at DESC LIMIT ?`)
      .all(workspaceId, ...params, limit) as Row[];
    return rows.map((row) => this.getMemory(text(row, "id"))!);
  }

  // -------------------------------------------------------------------------
  // MCP
  // -------------------------------------------------------------------------
  createMcpServer(input: {
    workspaceId: string;
    name: string;
    transport: "http" | "stdio";
    url: string | null;
    command: string[] | null;
    headersSecretId: string | null;
    envSecretId?: string | null;
  }): McpServer {
    const id = newId("mcp");
    const now = nowIso();
    this.db
      .prepare(
        "INSERT INTO mcp_servers (id, workspace_id, name, transport, url, command_json, headers_secret_id, env_secret_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'disconnected', ?, ?)",
      )
      .run(
        id,
        input.workspaceId,
        input.name,
        input.transport,
        input.url,
        input.command ? jsonStringify(input.command) : null,
        input.headersSecretId,
        input.envSecretId ?? null,
        now,
        now,
      );
    return this.getMcpServer(id)!;
  }

  getMcpServer(id: string): McpServer | null {
    const row = this.db.prepare("SELECT * FROM mcp_servers WHERE id = ?").get(id) as Row | undefined;
    return row ? mapMcpServer(row) : null;
  }

  listMcpServers(workspaceId: string): McpServer[] {
    return (
      this.db.prepare("SELECT * FROM mcp_servers WHERE workspace_id = ? ORDER BY created_at ASC").all(workspaceId) as Row[]
    ).map(mapMcpServer);
  }

  getMcpHeadersSecretId(id: string): string | null {
    const row = this.db.prepare("SELECT headers_secret_id FROM mcp_servers WHERE id = ?").get(id) as Row | undefined;
    return row ? nullableText(row, "headers_secret_id") : null;
  }

  getMcpEnvSecretId(id: string): string | null {
    const row = this.db.prepare("SELECT env_secret_id FROM mcp_servers WHERE id = ?").get(id) as Row | undefined;
    return row ? nullableText(row, "env_secret_id") : null;
  }

  updateMcpServerStatus(id: string, status: "connected" | "disconnected" | "error", lastError: string | null): void {
    this.db
      .prepare("UPDATE mcp_servers SET status = ?, last_error = ?, updated_at = ? WHERE id = ?")
      .run(status, lastError, nowIso(), id);
  }

  deleteMcpServer(workspaceId: string, id: string): void {
    this.db.prepare("DELETE FROM mcp_servers WHERE id = ? AND workspace_id = ?").run(id, workspaceId);
  }

  replaceMcpTools(
    serverId: string,
    tools: Array<{ name: string; description: string; inputSchema: JsonValue; requiresApproval: boolean }>,
  ): void {
    this.database.transaction(() => {
      this.db.prepare("DELETE FROM mcp_tools WHERE server_id = ?").run(serverId);
      const insert = this.db.prepare(
        "INSERT INTO mcp_tools (id, server_id, name, description, input_schema_json, requires_approval, discovered_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      );
      const now = nowIso();
      for (const tool of tools) {
        insert.run(newId("mcptool"), serverId, tool.name, tool.description, jsonStringify(tool.inputSchema), tool.requiresApproval ? 1 : 0, now);
      }
    });
  }

  listMcpTools(serverId: string): McpTool[] {
    return (this.db.prepare("SELECT * FROM mcp_tools WHERE server_id = ? ORDER BY name ASC").all(serverId) as Row[]).map(
      mapMcpTool,
    );
  }

  listAllMcpTools(workspaceId: string): McpTool[] {
    return (
      this.db
        .prepare(
          "SELECT t.* FROM mcp_tools t JOIN mcp_servers s ON s.id = t.server_id WHERE s.workspace_id = ? ORDER BY s.name, t.name",
        )
        .all(workspaceId) as Row[]
    ).map(mapMcpTool);
  }

  getMcpTool(serverId: string, name: string): McpTool | null {
    const row = this.db.prepare("SELECT * FROM mcp_tools WHERE server_id = ? AND name = ?").get(serverId, name) as
      | Row
      | undefined;
    return row ? mapMcpTool(row) : null;
  }

  // -------------------------------------------------------------------------
  // Tool executions + model calls
  // -------------------------------------------------------------------------
  createToolExecution(input: {
    runId: string | null;
    taskId: string | null;
    agentId: string | null;
    toolName: string;
    source: ToolExecution["source"];
    status: ToolExecution["status"];
    requiresApproval: boolean;
    approvalId: string | null;
    input: JsonValue;
    idempotencyKey: string | null;
  }): ToolExecution {
    const id = newId("tool");
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO tool_executions (id, run_id, task_id, agent_id, tool_name, source, status, requires_approval, approval_id, input_json, started_at, idempotency_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.runId,
        input.taskId,
        input.agentId,
        input.toolName,
        input.source,
        input.status,
        input.requiresApproval ? 1 : 0,
        input.approvalId,
        jsonStringify(input.input),
        now,
        input.idempotencyKey,
      );
    return this.getToolExecution(id)!;
  }

  getToolExecution(id: string): ToolExecution | null {
    const row = this.db.prepare("SELECT * FROM tool_executions WHERE id = ?").get(id) as Row | undefined;
    if (!row) return null;
    return {
      id: text(row, "id"),
      runId: nullableText(row, "run_id"),
      taskId: nullableText(row, "task_id"),
      agentId: nullableText(row, "agent_id"),
      toolName: text(row, "tool_name"),
      source: text(row, "source") as ToolExecution["source"],
      status: text(row, "status") as ToolExecution["status"],
      requiresApproval: bool(row, "requires_approval"),
      approvalId: nullableText(row, "approval_id"),
      input: json<JsonValue>(row, "input_json", null as unknown as JsonValue),
      output: json<JsonValue | null>(row, "output_json", null),
      error: nullableText(row, "error"),
      startedAt: nullableText(row, "started_at"),
      completedAt: nullableText(row, "completed_at"),
      durationMs: row["duration_ms"] === null || row["duration_ms"] === undefined ? null : number(row, "duration_ms"),
      idempotencyKey: nullableText(row, "idempotency_key"),
    };
  }

  updateToolExecution(
    id: string,
    patch: {
      status: ToolExecution["status"];
      output?: JsonValue | null;
      error?: string | null;
      completedAt?: string | null;
      durationMs?: number | null;
    },
  ): void {
    this.db
      .prepare("UPDATE tool_executions SET status = ?, output_json = ?, error = ?, completed_at = ?, duration_ms = ? WHERE id = ?")
      .run(
        patch.status,
        patch.output === undefined ? null : jsonStringify(patch.output),
        patch.error ?? null,
        patch.completedAt ?? null,
        patch.durationMs ?? null,
        id,
      );
  }

  setToolExecutionApproval(id: string, approvalId: string): void {
    this.db.prepare("UPDATE tool_executions SET approval_id = ? WHERE id = ?").run(approvalId, id);
  }

  getToolExecutionByIdempotencyKey(key: string): ToolExecution | null {
    const row = this.db.prepare("SELECT id FROM tool_executions WHERE idempotency_key = ?").get(key) as
      | Row
      | undefined;
    return row ? this.getToolExecution(text(row, "id")) : null;
  }

  listToolExecutions(runId: string): ToolExecution[] {
    const rows = this.db.prepare("SELECT * FROM tool_executions WHERE run_id = ? ORDER BY started_at ASC").all(runId) as Row[];
    return rows.map((row) => this.getToolExecution(text(row, "id"))!);
  }

  createModelCall(input: {
    runId: string | null;
    taskId: string | null;
    agentId: string | null;
    provider: string;
    model: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    costUsd: number | null;
    status: "succeeded" | "failed";
    error: string | null;
    durationMs: number;
  }): void {
    this.db
      .prepare(
        "INSERT INTO model_calls (id, run_id, task_id, agent_id, provider, model, prompt_tokens, completion_tokens, total_tokens, cost_usd, status, error, created_at, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        newId("model"),
        input.runId,
        input.taskId,
        input.agentId,
        input.provider,
        input.model,
        input.promptTokens,
        input.completionTokens,
        input.totalTokens,
        input.costUsd,
        input.status,
        input.error,
        nowIso(),
        input.durationMs,
      );
  }

  listModelCalls(runId: string): ModelCall[] {
    const rows = this.db.prepare("SELECT * FROM model_calls WHERE run_id = ? ORDER BY created_at ASC").all(runId) as Row[];
    return rows.map((row) => ({
      id: text(row, "id"),
      runId: nullableText(row, "run_id"),
      taskId: nullableText(row, "task_id"),
      agentId: nullableText(row, "agent_id"),
      provider: text(row, "provider"),
      model: text(row, "model"),
      promptTokens: number(row, "prompt_tokens"),
      completionTokens: number(row, "completion_tokens"),
      totalTokens: number(row, "total_tokens"),
      costUsd: row["cost_usd"] === null ? null : number(row, "cost_usd"),
      status: text(row, "status") as ModelCall["status"],
      error: nullableText(row, "error"),
      createdAt: text(row, "created_at"),
      durationMs: number(row, "duration_ms"),
    }));
  }

  // -------------------------------------------------------------------------
  // Jobs
  // -------------------------------------------------------------------------
  enqueueJob(input: {
    type: Job["type"];
    runId: string;
    taskId?: string | null;
    idempotencyKey: string;
    availableAt?: string;
    payload?: JsonValue | null;
    maxAttempts?: number;
  }): Job {
    const id = newId("job");
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO jobs (id, type, run_id, task_id, status, attempts, max_attempts, available_at, idempotency_key, payload_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'queued', 0, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(idempotency_key) DO NOTHING`,
      )
      .run(
        id,
        input.type,
        input.runId,
        input.taskId ?? null,
        input.maxAttempts ?? 3,
        input.availableAt ?? now,
        input.idempotencyKey,
        input.payload === undefined ? null : jsonStringify(input.payload),
        now,
        now,
      );
    const row = this.db.prepare("SELECT * FROM jobs WHERE idempotency_key = ?").get(input.idempotencyKey) as Row;
    return mapJob(row);
  }

  getJob(id: string): Job | null {
    const row = this.db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as Row | undefined;
    return row ? mapJob(row) : null;
  }

  claimJob(now = nowIso(), leaseMs = 120_000): Job | null {
    return this.database.transaction(() => {
      const row = this.db
        .prepare(
          "SELECT * FROM jobs WHERE status = 'queued' AND available_at <= ? ORDER BY created_at ASC LIMIT 1",
        )
        .get(now) as Row | undefined;
      if (!row) return null;
      const id = text(row, "id");
      const leaseUntil = new Date(new Date(now).getTime() + leaseMs).toISOString();
      this.db
        .prepare("UPDATE jobs SET status = 'leased', attempts = attempts + 1, lease_until = ?, updated_at = ? WHERE id = ? AND status = 'queued'")
        .run(leaseUntil, now, id);
      return this.getJob(id);
    });
  }

  completeJob(id: string): void {
    this.db.prepare("UPDATE jobs SET status = 'done', lease_until = NULL, updated_at = ? WHERE id = ?").run(nowIso(), id);
  }

  failJob(id: string, error: string, retryAt: string | null): void {
    const job = this.getJob(id);
    if (!job) return;
    if (retryAt && job.attempts < job.maxAttempts) {
      this.db
        .prepare("UPDATE jobs SET status = 'queued', lease_until = NULL, available_at = ?, last_error = ?, updated_at = ? WHERE id = ?")
        .run(retryAt, error.slice(0, 4000), nowIso(), id);
    } else {
      this.db
        .prepare("UPDATE jobs SET status = 'failed', lease_until = NULL, last_error = ?, updated_at = ? WHERE id = ?")
        .run(error.slice(0, 4000), nowIso(), id);
    }
  }

  recoverExpiredLeases(now = nowIso()): number {
    const result = this.db
      .prepare("UPDATE jobs SET status = 'queued', lease_until = NULL, updated_at = ? WHERE status = 'leased' AND lease_until IS NOT NULL AND lease_until <= ?")
      .run(now, now);
    return Number(result.changes);
  }

  listJobsForRun(runId: string): Job[] {
    return (this.db.prepare("SELECT * FROM jobs WHERE run_id = ? ORDER BY created_at ASC").all(runId) as Row[]).map(mapJob);
  }

  cancelQueuedJobsForRun(runId: string): number {
    const result = this.db
      .prepare("UPDATE jobs SET status = 'done', lease_until = NULL, updated_at = ? WHERE run_id = ? AND status = 'queued'")
      .run(nowIso(), runId);
    return Number(result.changes);
  }
}
