export type RunStatus =
  | "interpreting"
  | "planning"
  | "executing"
  | "awaiting_approval"
  | "reviewing"
  | "completed"
  | "failed"
  | "cancelled";

export type TaskStatus =
  | "pending"
  | "ready"
  | "running"
  | "awaiting_approval"
  | "blocked"
  | "completed"
  | "failed"
  | "cancelled"
  | "skipped";

export type AgentStatus = "idle" | "working" | "awaiting_approval" | "done" | "failed";
export type ApprovalStatus = "pending" | "approved" | "denied" | "expired" | "cancelled";
export type ActivityLevel = "info" | "success" | "warning" | "error";
export type ToolRisk = "read" | "internal_write" | "external" | "purchase" | "destructive";
export type ArtifactFormat = "markdown" | "text" | "json" | "csv" | "html";

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
}

export interface GoalInterpretation {
  title: string;
  objective: string;
  domains: string[];
  deliverables: string[];
  constraints: string[];
  risks: string[];
  complexity: "low" | "medium" | "high";
  requiresResearch: boolean;
  requiresExternalActions: boolean;
}

export interface PlannedAgent {
  key: string;
  definitionKey: string;
  domainPack: string;
  name: string;
  role: string;
  rationale: string;
}

export interface PlannedTask {
  key: string;
  title: string;
  description: string;
  agentKey: string;
  dependsOn: string[];
  deliverable: string;
  evaluationCriteria: string[];
  priority: number;
}

export interface WorkforcePlan {
  agents: PlannedAgent[];
  tasks: PlannedTask[];
  notes: string[];
}

export interface Run {
  id: string;
  workspaceId: string;
  goal: string;
  title: string | null;
  summary: string | null;
  status: RunStatus;
  interpretation: GoalInterpretation | null;
  plan: WorkforcePlan | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
}

export interface Agent {
  id: string;
  runId: string;
  workspaceId: string;
  definitionKey: string;
  domainPack: string;
  name: string;
  role: string;
  status: AgentStatus;
  model: string | null;
  createdAt: string;
}

export interface Task {
  id: string;
  runId: string;
  workspaceId: string;
  agentId: string | null;
  key: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: number;
  dependsOn: string[];
  deliverable: string;
  evaluationCriteria: string[];
  input: unknown;
  output: unknown;
  artifactId: string | null;
  attempts: number;
  maxAttempts: number;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface Approval {
  id: string;
  runId: string;
  workspaceId: string;
  taskId: string | null;
  agentId: string | null;
  kind: "tool" | "purchase";
  status: ApprovalStatus;
  title: string;
  summary: string;
  payload: unknown;
  decisionReason: string | null;
  createdAt: string;
  decidedAt: string | null;
  expiresAt: string | null;
}

export interface Artifact {
  id: string;
  runId: string;
  workspaceId: string;
  taskId: string | null;
  agentId: string | null;
  kind: "deliverable" | "supporting" | "review" | "final";
  format: ArtifactFormat;
  title: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface Activity {
  id: string;
  runId: string | null;
  workspaceId: string;
  taskId: string | null;
  agentId: string | null;
  type: string;
  level: ActivityLevel;
  message: string;
  data: unknown;
  createdAt: string;
}

export interface ToolExecution {
  id: string;
  runId: string | null;
  taskId: string | null;
  agentId: string | null;
  toolName: string;
  source: "native" | "mcp" | "extension";
  status: "requested" | "awaiting_approval" | "running" | "succeeded" | "failed" | "denied" | "timeout";
  requiresApproval: boolean;
  approvalId: string | null;
  input: unknown;
  output: unknown;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  idempotencyKey: string | null;
}

export interface ModelCall {
  id: string;
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
  createdAt: string;
  durationMs: number;
}

export interface Job {
  id: string;
  type: "interpret_goal" | "execute_task" | "review_run" | "finalize_run" | "resume_task";
  status: "queued" | "leased" | "done" | "failed";
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  updatedAt: string;
}

export interface RunDetail {
  run: Run;
  workspace: Workspace | null;
  agents: Agent[];
  tasks: Task[];
  approvals: Approval[];
  artifacts: Artifact[];
  activities: Activity[];
  toolExecutions: ToolExecution[];
  modelCalls: ModelCall[];
  jobs: Job[];
  usage: { modelCalls: number; totalTokens: number; costUsd: number };
}

export type RunSnapshot = Omit<RunDetail, "workspace" | "modelCalls">;

export interface Integration {
  id: string;
  workspaceId: string;
  provider: string;
  name: string;
  status: "connected" | "disconnected" | "error";
  config: Record<string, unknown>;
  hasSecret: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface McpTool {
  id: string;
  serverId: string;
  name: string;
  description: string;
  inputSchema: unknown;
  requiresApproval: boolean;
  discoveredAt: string;
}

export interface McpServer {
  id: string;
  workspaceId: string;
  name: string;
  transport: "http" | "stdio";
  url: string | null;
  command: string[] | null;
  status: "connected" | "disconnected" | "error";
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  tools: McpTool[];
}

export interface Memory {
  id: string;
  workspaceId: string;
  key: string;
  content: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface AgentDefinition {
  key: string;
  name: string;
  role: string;
  responsibilities: string[];
  capabilities: string[];
  allowedTools: string[];
  defaultModel: string | null;
  maxSteps: number;
}

export interface DomainPack {
  key: string;
  name: string;
  description: string;
  keywords: string[];
  agentCount: number;
  taskCount: number;
  agents: AgentDefinition[];
  workflows: Array<{ key: string; name: string; description: string; taskKeys: string[] }>;
  evaluationRules: string[];
}

export interface PublicConfig {
  llm: {
    configured: boolean;
    provider: string | null;
    model: string | null;
    baseUrl?: string;
  };
  limits: {
    maxAgents: number;
    maxTasks: number;
    maxToolSteps: number;
    maxModelCalls: number;
    maxTokens: number;
    runTimeoutMs: number;
    modelTimeoutMs: number;
    toolTimeoutMs: number;
    taskMaxAttempts: number;
  };
  telegraph: { nodeUrl: string; paymentsConfigured: boolean };
  mcp: { allowStdio: boolean };
  extensions: { enabled: boolean };
  auth: { tokenRequired: boolean };
}

export interface WorkspaceSettings {
  autoApproveReadOnlyMcp: boolean;
  allowExternalHttpWrites: boolean;
  maxAgents?: number;
  maxTasks?: number;
}

export interface Bootstrap {
  version: string;
  workspace: Workspace;
  workspaces: Workspace[];
  config: PublicConfig;
  domainPacks: DomainPack[];
  stats: { runs: number; activeRuns: number; pendingApprovals: number; artifacts: number };
}

export interface ToolInfo {
  name: string;
  description: string;
  risk: ToolRisk;
  requiresApproval: boolean;
  source: "native" | "mcp" | "extension";
  serverId?: string;
}
