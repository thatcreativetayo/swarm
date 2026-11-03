import { z } from "zod";

export const IdSchema = z.string().min(1).max(128);

export const RunStatusSchema = z.enum([
  "interpreting",
  "planning",
  "executing",
  "awaiting_approval",
  "reviewing",
  "completed",
  "failed",
  "cancelled",
]);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const TaskStatusSchema = z.enum([
  "pending",
  "ready",
  "running",
  "awaiting_approval",
  "blocked",
  "completed",
  "failed",
  "cancelled",
  "skipped",
]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const AgentStatusSchema = z.enum([
  "idle",
  "working",
  "awaiting_approval",
  "done",
  "failed",
]);
export type AgentStatus = z.infer<typeof AgentStatusSchema>;

export const ApprovalStatusSchema = z.enum(["pending", "approved", "denied", "expired", "cancelled"]);
export type ApprovalStatus = z.infer<typeof ApprovalStatusSchema>;

export const ToolRiskSchema = z.enum(["read", "internal_write", "external", "purchase", "destructive"]);
export type ToolRisk = z.infer<typeof ToolRiskSchema>;

export const ArtifactFormatSchema = z.enum(["markdown", "text", "json", "csv", "html"]);
export type ArtifactFormat = z.infer<typeof ArtifactFormatSchema>;

export const ActivityLevelSchema = z.enum(["info", "success", "warning", "error"]);
export type ActivityLevel = z.infer<typeof ActivityLevelSchema>;

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
);

export const WorkspaceSchema = z.object({
  id: IdSchema,
  name: z.string().min(1).max(120),
  slug: z.string().min(1).max(80),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Workspace = z.infer<typeof WorkspaceSchema>;

export const RunSchema = z.object({
  id: IdSchema,
  workspaceId: IdSchema,
  goal: z.string(),
  title: z.string().nullable(),
  summary: z.string().nullable(),
  status: RunStatusSchema,
  interpretation: JsonValueSchema.nullable(),
  plan: JsonValueSchema.nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  cancelledAt: z.string().nullable(),
});
export type Run = z.infer<typeof RunSchema>;

export const AgentSchema = z.object({
  id: IdSchema,
  runId: IdSchema,
  workspaceId: IdSchema,
  definitionKey: z.string(),
  domainPack: z.string(),
  name: z.string(),
  role: z.string(),
  status: AgentStatusSchema,
  model: z.string().nullable(),
  createdAt: z.string(),
});
export type Agent = z.infer<typeof AgentSchema>;

export const TaskSchema = z.object({
  id: IdSchema,
  runId: IdSchema,
  workspaceId: IdSchema,
  agentId: IdSchema.nullable(),
  key: z.string(),
  title: z.string(),
  description: z.string(),
  status: TaskStatusSchema,
  priority: z.number().int(),
  dependsOn: z.array(z.string()),
  deliverable: z.string(),
  evaluationCriteria: z.array(z.string()),
  input: JsonValueSchema.nullable(),
  output: JsonValueSchema.nullable(),
  artifactId: IdSchema.nullable(),
  attempts: z.number().int(),
  maxAttempts: z.number().int(),
  error: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
});
export type Task = z.infer<typeof TaskSchema>;

export const ApprovalSchema = z.object({
  id: IdSchema,
  runId: IdSchema,
  workspaceId: IdSchema,
  taskId: IdSchema.nullable(),
  agentId: IdSchema.nullable(),
  kind: z.enum(["tool", "purchase"]),
  status: ApprovalStatusSchema,
  title: z.string(),
  summary: z.string(),
  payload: JsonValueSchema,
  decisionReason: z.string().nullable(),
  createdAt: z.string(),
  decidedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
});
export type Approval = z.infer<typeof ApprovalSchema>;

export const ArtifactSchema = z.object({
  id: IdSchema,
  runId: IdSchema,
  workspaceId: IdSchema,
  taskId: IdSchema.nullable(),
  agentId: IdSchema.nullable(),
  kind: z.enum(["deliverable", "supporting", "review", "final"]),
  format: ArtifactFormatSchema,
  title: z.string(),
  filename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
  createdAt: z.string(),
});
export type Artifact = z.infer<typeof ArtifactSchema>;

export const ActivitySchema = z.object({
  id: IdSchema,
  runId: IdSchema.nullable(),
  workspaceId: IdSchema,
  taskId: IdSchema.nullable(),
  agentId: IdSchema.nullable(),
  type: z.string(),
  level: ActivityLevelSchema,
  message: z.string(),
  data: JsonValueSchema.nullable(),
  createdAt: z.string(),
});
export type Activity = z.infer<typeof ActivitySchema>;

export const IntegrationSchema = z.object({
  id: IdSchema,
  workspaceId: IdSchema,
  provider: z.string(),
  name: z.string(),
  status: z.enum(["connected", "disconnected", "error"]),
  config: JsonValueSchema,
  hasSecret: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Integration = z.infer<typeof IntegrationSchema>;

export const McpServerSchema = z.object({
  id: IdSchema,
  workspaceId: IdSchema,
  name: z.string(),
  transport: z.enum(["http", "stdio"]),
  url: z.string().nullable(),
  command: z.array(z.string()).nullable(),
  status: z.enum(["connected", "disconnected", "error"]),
  lastError: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type McpServer = z.infer<typeof McpServerSchema>;

export const McpToolSchema = z.object({
  id: IdSchema,
  serverId: IdSchema,
  name: z.string(),
  description: z.string(),
  inputSchema: JsonValueSchema,
  requiresApproval: z.boolean(),
  discoveredAt: z.string(),
});
export type McpTool = z.infer<typeof McpToolSchema>;

export const MemorySchema = z.object({
  id: IdSchema,
  workspaceId: IdSchema,
  key: z.string(),
  content: z.string(),
  tags: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Memory = z.infer<typeof MemorySchema>;

export const ToolExecutionSchema = z.object({
  id: IdSchema,
  runId: IdSchema.nullable(),
  taskId: IdSchema.nullable(),
  agentId: IdSchema.nullable(),
  toolName: z.string(),
  source: z.enum(["native", "mcp", "extension"]),
  status: z.enum(["requested", "awaiting_approval", "running", "succeeded", "failed", "denied", "timeout"]),
  requiresApproval: z.boolean(),
  approvalId: IdSchema.nullable(),
  input: JsonValueSchema,
  output: JsonValueSchema.nullable(),
  error: z.string().nullable(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  durationMs: z.number().int().nullable(),
  idempotencyKey: z.string().nullable(),
});
export type ToolExecution = z.infer<typeof ToolExecutionSchema>;

export const ModelCallSchema = z.object({
  id: IdSchema,
  runId: IdSchema.nullable(),
  taskId: IdSchema.nullable(),
  agentId: IdSchema.nullable(),
  provider: z.string(),
  model: z.string(),
  promptTokens: z.number().int(),
  completionTokens: z.number().int(),
  totalTokens: z.number().int(),
  costUsd: z.number().nullable(),
  status: z.enum(["succeeded", "failed"]),
  error: z.string().nullable(),
  createdAt: z.string(),
  durationMs: z.number().int(),
});
export type ModelCall = z.infer<typeof ModelCallSchema>;

export const JobSchema = z.object({
  id: IdSchema,
  type: z.enum(["interpret_goal", "execute_task", "review_run", "finalize_run", "resume_task"]),
  runId: IdSchema,
  taskId: IdSchema.nullable(),
  status: z.enum(["queued", "leased", "done", "failed"]),
  attempts: z.number().int(),
  maxAttempts: z.number().int(),
  availableAt: z.string(),
  leaseUntil: z.string().nullable(),
  idempotencyKey: z.string(),
  payload: JsonValueSchema.nullable(),
  lastError: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Job = z.infer<typeof JobSchema>;

export const CreateWorkspaceInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
});
export type CreateWorkspaceInput = z.infer<typeof CreateWorkspaceInputSchema>;

export const CreateRunInputSchema = z.object({
  goal: z.string().trim().min(10).max(20_000),
});
export type CreateRunInput = z.infer<typeof CreateRunInputSchema>;

export const ApprovalDecisionInputSchema = z.object({
  decision: z.enum(["approved", "denied"]),
  reason: z.string().trim().max(2000).optional(),
});
export type ApprovalDecisionInput = z.infer<typeof ApprovalDecisionInputSchema>;

export const CreateIntegrationInputSchema = z.object({
  provider: z.enum(["github", "slack", "google", "notion", "linear", "figma", "calendar", "telegraph", "custom"]),
  name: z.string().trim().min(1).max(120),
  config: z.record(z.string(), JsonValueSchema).default({}),
  secret: z.string().max(20_000).optional(),
});
export type CreateIntegrationInput = z.infer<typeof CreateIntegrationInputSchema>;

export const CreateMcpServerInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  transport: z.enum(["http", "stdio"]),
  url: z.string().url().optional(),
  command: z.array(z.string().min(1)).min(1).max(20).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
});
export type CreateMcpServerInput = z.infer<typeof CreateMcpServerInputSchema>;

export const UpdateWorkspaceSettingsInputSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  autoApproveReadOnlyMcp: z.boolean().optional(),
  allowExternalHttpWrites: z.boolean().optional(),
  maxAgents: z.number().int().min(1).max(12).optional(),
  maxTasks: z.number().int().min(1).max(24).optional(),
});
export type UpdateWorkspaceSettingsInput = z.infer<typeof UpdateWorkspaceSettingsInputSchema>;
