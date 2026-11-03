import type { Agent, Approval, JsonValue, Run, Task } from "../contracts/common.js";
import type { SwarmConfig } from "../config.js";
import type { Store } from "../db/repository.js";
import {
  getAgentDefinition,
  getDomainPack,
} from "../domain/index.js";
import {
  GoalInterpretationSchema,
  ReviewOutputSchema,
  WorkforcePlanSchema,
  type GoalInterpretation,
  type ReviewOutput,
  type WorkforcePlan,
} from "../domain/types.js";
import { loadExtensions, type ExtensionLoadResult } from "../extensions/loader.js";
import { McpManager, createMcpTools } from "../mcp/manager.js";
import { extractJsonValue } from "../providers/structured.js";
import type { LlmProvider } from "../providers/types.js";
import { AgentRunner, type AgentLoopOutcome, type AgentTaskInput } from "../runtime/agent-loop.js";
import { AccountedProvider } from "../runtime/accounted-provider.js";
import { ModelCaller, RunLimitError } from "../runtime/accounting.js";
import {
  buildFinalSystemPrompt,
  buildReviewSystemPrompt,
  type ReviewPromptContext,
} from "../runtime/prompts.js";
import { SecretBox } from "../security/secrets.js";
import { createNativeToolRegistry, type ToolRegistry } from "../tools/index.js";
import type { Job } from "../contracts/common.js";
import { addMs, nowIso, slugify } from "../utils/id.js";
import { truncate } from "../utils/json.js";
import { logger } from "../utils/logger.js";
import { buildWorkforcePlan, interpretGoal } from "../workforce/planner.js";

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

export interface EngineOptions {
  config: SwarmConfig;
  store: Store;
  secrets: SecretBox;
  provider: LlmProvider | null;
}

export interface WorkerHandle {
  stop: () => void;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function parseJsonRecord(value: JsonValue | null): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export class SwarmEngine {
  readonly config: SwarmConfig;
  readonly store: Store;
  readonly secrets: SecretBox;
  readonly provider: LlmProvider | null;
  readonly mcpManager: McpManager;
  readonly extensions: ExtensionLoadResult;
  private readonly modelCaller: ModelCaller;

  constructor(options: EngineOptions) {
    this.config = options.config;
    this.store = options.store;
    this.secrets = options.secrets;
    this.provider = options.provider;
    this.modelCaller = new ModelCaller(options.store, options.config);
    this.mcpManager = new McpManager(options.store, options.secrets, {
      allowStdio: options.config.mcp.allowStdio,
      timeoutMs: 30_000,
    });
    this.extensions = loadExtensions(options.config.extensions.dir, options.config.extensions.enabled);
    for (const error of this.extensions.errors) {
      logger.warn("extension manifest rejected", error);
    }
  }

  requireProvider(): LlmProvider {
    if (!this.provider) {
      throw new ConfigurationError(
        "No model provider is configured. Set SWARM_LLM_PROVIDER, SWARM_LLM_MODEL, and SWARM_LLM_API_KEY (or use openai-compatible with a local model).",
      );
    }
    return this.provider;
  }

  private registryFor(workspaceId: string): ToolRegistry {
    const registry = createNativeToolRegistry();
    for (const tool of this.extensions.tools) registry.register(tool);
    for (const tool of createMcpTools(this.store, this.mcpManager, workspaceId)) {
      registry.register(tool);
    }
    return registry;
  }

  private planLimits(workspaceId: string): { maxAgents: number; maxTasks: number } {
    const settings = this.store.getWorkspaceSettings(workspaceId);
    return {
      maxAgents: Math.min(this.config.limits.maxAgents, settings.maxAgents ?? this.config.limits.maxAgents),
      maxTasks: Math.min(this.config.limits.maxTasks, settings.maxTasks ?? this.config.limits.maxTasks),
    };
  }

  createRun(workspaceId: string, goal: string): Run {
    this.requireProvider();
    const workspace = this.store.getWorkspace(workspaceId);
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`);
    const run = this.store.createRun(workspaceId, goal);
    this.activity(run.id, workspaceId, "run_created", "info", "Goal received. Interpreting the request.");
    this.store.appendRunEvent(run.id, "run_created", { goal });
    this.store.enqueueJob({
      type: "interpret_goal",
      runId: run.id,
      idempotencyKey: `interpret:${run.id}`,
      maxAttempts: 3,
    });
    return run;
  }

  cancelRun(runId: string): Run {
    const run = this.store.getRun(runId);
    if (!run) throw new Error(`Run not found: ${runId}`);
    if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") return run;
    const cancelled = this.store.requestCancel(runId);
    this.store.cancelPendingApprovalsForRun(runId);
    for (const task of this.store.listTasks(runId)) {
      if (["pending", "ready", "running", "awaiting_approval", "blocked"].includes(task.status)) {
        this.store.updateTaskStatus(task.id, "cancelled", { completedAt: nowIso() });
      }
    }
    for (const agent of this.store.listAgents(runId)) {
      if (agent.status !== "done") this.store.updateAgentStatus(agent.id, "failed");
    }
    this.activity(runId, run.workspaceId, "run_cancelled", "warning", "Run cancelled by the user.");
    this.store.appendRunEvent(runId, "run_cancelled", {});
    return cancelled;
  }

  decideApproval(
    approvalId: string,
    decision: "approved" | "denied",
    reason: string | null,
  ): Approval {
    const approval = this.store.getApproval(approvalId);
    if (!approval) throw new Error(`Approval not found: ${approvalId}`);
    if (approval.status !== "pending") throw new Error(`Approval is already ${approval.status}.`);
    const run = this.store.getRun(approval.runId);
    if (!run) throw new Error("Run not found.");
    if (run.status === "cancelled" || run.status === "failed") {
      throw new Error("Run is no longer active.");
    }

    const decided = this.store.decideApproval(approvalId, decision, reason);
    const payload = parseJsonRecord(approval.payload);
    const executionId = typeof payload.toolExecutionId === "string" ? payload.toolExecutionId : null;
    if (executionId) {
      this.store.updateToolExecution(executionId, {
        status: decision === "approved" ? "requested" : "denied",
        error: decision === "denied" ? (reason ?? "Denied by user.") : null,
        completedAt: decision === "denied" ? nowIso() : null,
      });
    }

    if (approval.taskId) {
      const task = this.store.getTask(approval.taskId);
      if (task && task.status !== "completed" && task.status !== "cancelled") {
        this.store.updateTaskStatus(task.id, "running", { startedAt: task.startedAt ?? nowIso() });
        this.store.updateRun(run.id, { status: "executing" });
        if (approval.agentId) this.store.updateAgentStatus(approval.agentId, "working");
        this.store.enqueueJob({
          type: "resume_task",
          runId: run.id,
          taskId: task.id,
          idempotencyKey: `resume:${task.id}:${approval.id}:${decided.decidedAt ?? decided.status}`,
          payload: { approvalId: approval.id },
          maxAttempts: 3,
        });
      }
    }

    this.activity(
      run.id,
      run.workspaceId,
      decision === "approved" ? "approval_approved" : "approval_denied",
      decision === "approved" ? "success" : "warning",
      `${approval.title} was ${decision}${reason ? `: ${reason}` : "."}`,
      { approvalId: approval.id, taskId: approval.taskId },
    );
    this.store.appendRunEvent(run.id, "approval_decided", {
      approvalId: approval.id,
      decision,
      reason,
    });
    return decided;
  }

  async connectMcpServer(serverId: string): Promise<{ tools: number }> {
    const tools = await this.mcpManager.discover(serverId);
    return { tools: tools.length };
  }

  async expireApprovals(): Promise<number> {
    const expired = this.store.listExpiredApprovals();
    for (const approval of expired) {
      const marked = this.store.markApprovalExpired(approval.id);
      const payload = parseJsonRecord(approval.payload);
      const executionId = typeof payload.toolExecutionId === "string" ? payload.toolExecutionId : null;
      if (executionId) {
        this.store.updateToolExecution(executionId, {
          status: "timeout",
          error: "Approval expired before a decision was made.",
          completedAt: nowIso(),
        });
      }
      if (approval.taskId) {
        const task = this.store.getTask(approval.taskId);
        if (task && task.status === "awaiting_approval") {
          this.store.updateTaskStatus(task.id, "running");
          this.store.updateRun(approval.runId, { status: "executing" });
          if (approval.agentId) this.store.updateAgentStatus(approval.agentId, "working");
          this.store.enqueueJob({
            type: "resume_task",
            runId: approval.runId,
            taskId: task.id,
            idempotencyKey: `resume:${task.id}:${approval.id}:${marked.decidedAt ?? "expired"}`,
            payload: { approvalId: approval.id },
            maxAttempts: 2,
          });
        }
      }
      this.activity(
        approval.runId,
        approval.workspaceId,
        "approval_expired",
        "warning",
        `${approval.title} expired without a decision.`,
        { approvalId: approval.id },
      );
    }
    return expired.length;
  }

  async runNextJob(): Promise<Job | null> {
    const job = this.store.claimJob(nowIso(), 10 * 60_000);
    if (!job) return null;
    try {
      await this.dispatch(job);
      this.store.completeJob(job.id);
      return job;
    } catch (error) {
      const message = (error as Error).message;
      const run = this.store.getRun(job.runId);
      if (!run || run.status === "cancelled" || run.status === "failed" || run.status === "completed") {
        this.store.completeJob(job.id);
        return job;
      }
      if (error instanceof RunLimitError && error.code === "cancelled") {
        this.store.completeJob(job.id);
        return job;
      }
      const retryAt = addMs(nowIso(), Math.min(30_000, 1000 * 2 ** job.attempts));
      this.store.failJob(job.id, message, retryAt);
      logger.warn("job failed", { jobId: job.id, type: job.type, attempt: job.attempts, error: message });
      if (job.attempts >= job.maxAttempts) {
        this.failRun(job.runId, `Job ${job.type} failed: ${message}`);
      }
      return job;
    }
  }

  private async dispatch(job: Job): Promise<void> {
    switch (job.type) {
      case "interpret_goal":
        return this.handleInterpret(job);
      case "execute_task":
        return this.handleExecute(job);
      case "resume_task":
        return this.handleResume(job);
      case "review_run":
        return this.handleReview(job);
      case "finalize_run":
        return this.handleFinalize(job);
    }
  }

  startWorker(options: { pollMs?: number } = {}): WorkerHandle {
    const pollMs = options.pollMs ?? 750;
    const controller = new AbortController();
    let stopped = false;
    void (async () => {
      this.store.recoverExpiredLeases();
      await this.expireApprovals();
      let nextApprovalSweep = Date.now() + 30_000;
      while (!stopped) {
        try {
          if (Date.now() >= nextApprovalSweep) {
            await this.expireApprovals();
            nextApprovalSweep = Date.now() + 30_000;
          }
          const job = await this.runNextJob();
          if (!job) {
            await this.mcpManager.closeIdle();
            await sleep(pollMs, controller.signal);
          }
        } catch (error) {
          logger.error("worker loop error", { error: (error as Error).message });
          await sleep(1500, controller.signal);
        }
      }
    })();
    return {
      stop: () => {
        stopped = true;
        controller.abort();
      },
    };
  }

  async runUntilIdle(maxJobs = 100): Promise<number> {
    let processed = 0;
    while (processed < maxJobs) {
      const job = await this.runNextJob();
      if (!job) break;
      processed += 1;
    }
    return processed;
  }

  async dispose(): Promise<void> {
    await this.mcpManager.closeAll();
  }

  // -------------------------------------------------------------------------
  // Interpretation + planning
  // -------------------------------------------------------------------------
  private async handleInterpret(job: Job): Promise<void> {
    const run = this.store.getRun(job.runId);
    if (!run) return;
    if (run.status === "cancelled" || run.status === "failed" || run.status === "completed") return;
    if (run.status === "executing" || run.status === "reviewing") return;

    const provider = this.requireProvider();
    const accounted = new AccountedProvider(provider, this.modelCaller, {
      runId: run.id,
      taskId: null,
      agentId: null,
    });
    if (!run.startedAt) this.store.updateRun(run.id, { startedAt: nowIso() });
    this.store.updateRun(run.id, { status: "interpreting" });

    let interpretation = GoalInterpretationSchema.safeParse(run.interpretation);
    let interpretationValue: GoalInterpretation;
    if (interpretation.success) {
      interpretationValue = interpretation.data;
    } else {
      const result = await interpretGoal(accounted, run.goal, {
        model: this.config.llm.model ?? undefined,
      });
      interpretationValue = result.interpretation;
      this.store.setRunInterpretation(run.id, interpretationValue as unknown as JsonValue);
      this.store.updateRun(run.id, { title: interpretationValue.title, summary: interpretationValue.objective });
      this.activity(run.id, run.workspaceId, "goal_interpreted", "info", `Objective: ${interpretationValue.objective}`, {
        domains: interpretationValue.domains,
        complexity: interpretationValue.complexity,
      });
      if (result.fallback && result.warning) {
        this.activity(run.id, run.workspaceId, "interpreter_fallback", "warning", result.warning);
      }
    }

    if (this.store.isCancelRequested(run.id)) return;
    this.store.updateRun(run.id, { status: "planning" });

    let planValue: WorkforcePlan | null = null;
    const existingPlan = WorkforcePlanSchema.safeParse(run.plan);
    if (existingPlan.success) {
      planValue = existingPlan.data;
    } else {
      const limits = this.planLimits(run.workspaceId);
      const settings = this.store.getWorkspaceSettings(run.workspaceId);
      const result = await buildWorkforcePlan(accounted, interpretationValue, run.goal, {
        model: this.config.llm.model ?? undefined,
        limits,
        workspacePolicyNote: `Workspace policy: external HTTP writes are ${settings.allowExternalHttpWrites ? "allowed with approval" : "disabled"}; read-only MCP auto-approval is ${settings.autoApproveReadOnlyMcp ? "on" : "off"}.`,
      });
      planValue = result.plan;
      this.store.setRunPlan(run.id, planValue as unknown as JsonValue);
      for (const warning of result.warnings) {
        this.activity(run.id, run.workspaceId, "planning_warning", "warning", warning);
      }
      this.activity(
        run.id,
        run.workspaceId,
        "plan_created",
        result.fallback ? "warning" : "success",
        `Workforce planned: ${planValue.agents.length} specialists, ${planValue.tasks.length} tasks.`,
        { agents: planValue.agents.map((agent) => agent.name), tasks: planValue.tasks.map((task) => task.title) },
      );
      this.store.appendRunEvent(run.id, "plan_created", {
        agents: planValue.agents.length,
        tasks: planValue.tasks.length,
        fallback: result.fallback,
      });
    }

    if (this.store.isCancelRequested(run.id)) return;
    this.materializePlan(run, planValue);
    this.store.updateRun(run.id, { status: "executing" });
    this.activity(run.id, run.workspaceId, "execution_started", "info", "Workforce is executing the plan.");
    this.enqueueReadyTasks(run.id);
    this.afterTaskSettled(run.id);
  }

  private materializePlan(run: Run, plan: WorkforcePlan): void {
    const existingAgents = this.store.listAgents(run.id);
    const byPlanKey = new Map<string, Agent>();
    const missing: Array<{
      definitionKey: string;
      domainPack: string;
      name: string;
      role: string;
      model: string | null;
    }> = [];

    for (const planned of plan.agents) {
      const found = existingAgents.find(
        (agent) => agent.definitionKey === planned.definitionKey && agent.domainPack === planned.domainPack,
      );
      if (found) {
        byPlanKey.set(planned.key, found);
        continue;
      }
      const definition = getAgentDefinition(planned.domainPack, planned.definitionKey);
      missing.push({
        definitionKey: planned.definitionKey,
        domainPack: planned.domainPack,
        name: planned.name,
        role: planned.role,
        model: definition?.defaultModel ?? this.config.llm.model,
      });
    }

    if (missing.length > 0) {
      const inserted = this.store.insertAgents(run.id, run.workspaceId, missing);
      const missingPlanKeys = plan.agents
        .filter((planned) => !byPlanKey.has(planned.key))
        .map((planned) => planned.key);
      missingPlanKeys.forEach((key, index) => {
        const agent = inserted[index];
        if (agent) byPlanKey.set(key, agent);
      });
    }

    if (this.store.listTasks(run.id).length > 0) return;
    this.store.insertTasks(
      run.id,
      run.workspaceId,
      plan.tasks.map((task) => {
        const agent = byPlanKey.get(task.agentKey);
        if (!agent) throw new Error(`Plan task ${task.key} has no materialized agent ${task.agentKey}.`);
        return {
          key: task.key,
          title: task.title,
          description: task.description,
          status: "pending" as const,
          priority: task.priority,
          dependsOn: task.dependsOn,
          deliverable: task.deliverable,
          evaluationCriteria: task.evaluationCriteria,
          agentId: agent.id,
          maxAttempts: this.config.limits.taskMaxAttempts,
        };
      }),
    );
  }

  private enqueueReadyTasks(runId: string): number {
    const run = this.store.getRun(runId);
    if (!run || run.status === "cancelled" || run.status === "failed" || run.status === "completed") return 0;
    if (run.status === "awaiting_approval") return 0;
    const ready = this.store.listReadyTasks(runId);
    for (const task of ready) {
      this.store.enqueueJob({
        type: "execute_task",
        runId,
        taskId: task.id,
        idempotencyKey: `execute:${task.id}:${task.attempts + 1}`,
        maxAttempts: 2,
      });
    }
    if (ready.length > 0) this.store.updateRun(runId, { status: "executing" });
    return ready.length;
  }

  // -------------------------------------------------------------------------
  // Task execution
  // -------------------------------------------------------------------------
  private buildTaskInput(run: Run, task: Task, agent: Agent): AgentTaskInput {
    const definition = getAgentDefinition(agent.domainPack, agent.definitionKey);
    if (!definition) throw new Error(`Unknown agent definition ${agent.domainPack}:${agent.definitionKey}.`);
    const agents = this.store.listAgents(run.id);
    const dependencies = task.dependsOn
      .map((key) => this.store.getTaskByKey(run.id, key))
      .filter((dependency): dependency is Task => Boolean(dependency))
      .map((dependency) => ({
        task: dependency,
        agentName: agents.find((candidate) => candidate.id === dependency.agentId)?.name ?? "Prior specialist",
      }));
    const interpretation = GoalInterpretationSchema.safeParse(run.interpretation);
    return {
      run,
      task,
      agent,
      definition,
      interpretation: interpretation.success ? interpretation.data : null,
      memories: this.store.searchMemories(run.workspaceId, `${run.goal} ${task.title}`, 8),
      dependencies,
    };
  }

  private async handleExecute(job: Job): Promise<void> {
    if (!job.taskId) return;
    const task = this.store.getTask(job.taskId);
    const run = this.store.getRun(job.runId);
    if (!task || !run) return;
    if (run.status === "cancelled" || run.status === "failed" || run.status === "completed") return;
    if (["completed", "cancelled", "skipped", "awaiting_approval"].includes(task.status)) return;
    if (!this.store.dependenciesComplete(task.id)) return;
    if (this.store.isCancelRequested(run.id)) {
      this.store.updateTaskStatus(task.id, "cancelled", { completedAt: nowIso() });
      return;
    }
    const agent = task.agentId ? this.store.getAgent(task.agentId) : null;
    if (!agent) {
      this.failRun(run.id, `Task ${task.title} has no assigned agent.`);
      return;
    }

    const attempts = this.store.incrementTaskAttempts(task.id);
    if (attempts > task.maxAttempts) {
      this.failRun(run.id, `Task "${task.title}" exhausted its ${task.maxAttempts} attempts.`);
      return;
    }
    this.store.updateTaskStatus(task.id, "running", {
      startedAt: task.startedAt ?? nowIso(),
      error: null,
    });
    this.store.updateAgentStatus(agent.id, "working");
    this.store.updateRun(run.id, { status: "executing" });
    this.activity(run.id, run.workspaceId, "task_started", "info", `${agent.name} started "${task.title}".`, {
      taskId: task.id,
      attempt: attempts,
    });
    this.store.appendRunEvent(run.id, "task_started", { taskId: task.id, title: task.title, agent: agent.name });

    const input = this.buildTaskInput(run, task, agent);
    const runner = new AgentRunner({
      store: this.store,
      config: this.config,
      provider: this.requireProvider(),
      registry: this.registryFor(run.workspaceId),
      secrets: this.secrets,
      modelCaller: this.modelCaller,
    });

    try {
      const outcome = await runner.start(input);
      this.handleTaskOutcome(run, task, agent, outcome);
    } catch (error) {
      this.handleTaskFailure(run, task, agent, error);
    }
  }

  private async handleResume(job: Job): Promise<void> {
    if (!job.taskId) return;
    const payload = parseJsonRecord(job.payload);
    const approvalId = typeof payload.approvalId === "string" ? payload.approvalId : "";
    if (!approvalId) throw new Error("Resume job is missing approvalId.");
    const approval = this.store.getApproval(approvalId);
    if (!approval) throw new Error(`Approval not found: ${approvalId}`);
    if (approval.status === "pending") return;
    const task = this.store.getTask(job.taskId);
    const run = this.store.getRun(job.runId);
    if (!task || !run) return;
    if (run.status === "cancelled" || run.status === "failed" || run.status === "completed") return;
    if (["completed", "cancelled", "skipped"].includes(task.status)) return;
    const agent = task.agentId ? this.store.getAgent(task.agentId) : null;
    if (!agent) {
      this.failRun(run.id, `Task ${task.title} has no assigned agent.`);
      return;
    }

    const input = this.buildTaskInput(run, task, agent);
    const runner = new AgentRunner({
      store: this.store,
      config: this.config,
      provider: this.requireProvider(),
      registry: this.registryFor(run.workspaceId),
      secrets: this.secrets,
      modelCaller: this.modelCaller,
    });

    try {
      const outcome = await runner.resume(input, approvalId);
      this.handleTaskOutcome(run, task, agent, outcome);
    } catch (error) {
      this.handleTaskFailure(run, task, agent, error);
    }
  }

  private handleTaskOutcome(run: Run, task: Task, agent: Agent, outcome: AgentLoopOutcome): void {
    const currentRun = this.store.getRun(run.id);
    if (!currentRun) return;
    if (outcome.status === "awaiting_approval") {
      this.refreshAgentStatuses(run.id);
      return;
    }
    if (outcome.status === "cancelled" || currentRun.status === "cancelled" || this.store.isCancelRequested(run.id)) {
      this.store.updateTaskStatus(task.id, "cancelled", { completedAt: nowIso() });
      this.refreshAgentStatuses(run.id);
      return;
    }
    this.store.updateTaskStatus(task.id, "completed", { completedAt: nowIso(), error: null });
    this.activity(run.id, run.workspaceId, "task_completed", "success", `${agent.name} completed "${task.title}".`, {
      taskId: task.id,
      artifactId: this.store.getTask(task.id)?.artifactId ?? null,
    });
    this.store.appendRunEvent(run.id, "task_completed", { taskId: task.id, title: task.title });
    this.afterTaskSettled(run.id);
  }

  private handleTaskFailure(run: Run, task: Task, agent: Agent, error: unknown): void {
    const message = (error as Error).message;
    if (error instanceof RunLimitError && error.code === "cancelled") {
      this.store.updateTaskStatus(task.id, "cancelled", { completedAt: nowIso() });
      return;
    }
    const current = this.store.getTask(task.id);
    const attempts = current?.attempts ?? 1;
    const maxAttempts = current?.maxAttempts ?? 1;
    if (
      error instanceof RunLimitError &&
      ["model_call_limit", "token_limit", "timeout", "turn_limit", "tool_call_limit"].includes(error.code)
    ) {
      this.store.updateTaskStatus(task.id, "failed", { error: message, completedAt: nowIso() });
      this.failRun(run.id, message);
      return;
    }
    if (attempts < maxAttempts) {
      this.store.updateTaskStatus(task.id, "pending", { error: message });
      this.store.updateAgentStatus(agent.id, "idle");
      this.activity(run.id, run.workspaceId, "task_retry", "warning", `${agent.name} will retry "${task.title}".`, {
        taskId: task.id,
        attempt: attempts,
        error: message,
      });
      this.store.enqueueJob({
        type: "execute_task",
        runId: run.id,
        taskId: task.id,
        idempotencyKey: `execute:${task.id}:${attempts + 1}`,
        availableAt: addMs(nowIso(), Math.min(30_000, 1500 * 2 ** attempts)),
        maxAttempts: 2,
      });
      return;
    }
    this.store.updateTaskStatus(task.id, "failed", { error: message, completedAt: nowIso() });
    this.failRun(run.id, `Task "${task.title}" failed: ${message}`);
  }

  private afterTaskSettled(runId: string): void {
    const run = this.store.getRun(runId);
    if (!run) return;
    if (run.status === "cancelled" || run.status === "failed" || run.status === "completed") return;
    const tasks = this.store.listTasks(runId);
    if (tasks.length === 0) return;
    this.refreshAgentStatuses(runId);

    const failed = tasks.filter((task) => task.status === "failed");
    if (failed.length > 0) {
      this.failRun(runId, `Task "${failed[0]!.title}" failed.`);
      return;
    }
    const awaiting = tasks.filter((task) => task.status === "awaiting_approval");
    if (awaiting.length > 0) {
      this.store.updateRun(runId, { status: "awaiting_approval" });
      return;
    }
    const allSettled = tasks.every((task) => task.status === "completed" || task.status === "skipped");
    if (allSettled) {
      this.store.updateRun(runId, { status: "reviewing" });
      this.store.enqueueJob({
        type: "review_run",
        runId,
        idempotencyKey: `review:${runId}`,
        maxAttempts: 3,
      });
      return;
    }

    const running = tasks.filter((task) => task.status === "running").length;
    const ready = this.enqueueReadyTasks(runId);
    if (running === 0 && ready === 0) {
      const pending = tasks.filter((task) => task.status === "pending" || task.status === "blocked").length;
      if (pending > 0) {
        this.failRun(runId, "Workflow is blocked: no runnable tasks remain.");
      }
    }
  }

  private refreshAgentStatuses(runId: string): void {
    const tasks = this.store.listTasks(runId);
    for (const agent of this.store.listAgents(runId)) {
      const own = tasks.filter((task) => task.agentId === agent.id);
      if (own.some((task) => task.status === "awaiting_approval")) {
        this.store.updateAgentStatus(agent.id, "awaiting_approval");
      } else if (own.some((task) => task.status === "running")) {
        this.store.updateAgentStatus(agent.id, "working");
      } else if (own.some((task) => task.status === "failed")) {
        this.store.updateAgentStatus(agent.id, "failed");
      } else if (own.length > 0 && own.every((task) => task.status === "completed" || task.status === "skipped")) {
        this.store.updateAgentStatus(agent.id, "done");
      } else {
        this.store.updateAgentStatus(agent.id, "idle");
      }
    }
  }

  // -------------------------------------------------------------------------
  // Review + finalization
  // -------------------------------------------------------------------------
  private reviewContext(run: Run): ReviewPromptContext {
    const agents = this.store.listAgents(run.id);
    const tasks = this.store.listTasks(run.id);
    const interpretation = GoalInterpretationSchema.safeParse(run.interpretation);
    return {
      run,
      interpretation: interpretation.success ? interpretation.data : null,
      outputs: tasks
        .filter((task) => task.status === "completed")
        .map((task) => ({
          task,
          agentName: agents.find((agent) => agent.id === task.agentId)?.name ?? "Specialist",
        })),
      toolExecutions: this.store.listToolExecutions(run.id).map((execution) => ({
        toolName: execution.toolName,
        status: execution.status,
        error: execution.error,
      })),
      approvals: this.store.listApprovalsByRun(run.id).map((approval) => ({
        title: approval.title,
        status: approval.status,
      })),
    };
  }

  private async handleReview(job: Job): Promise<void> {
    const run = this.store.getRun(job.runId);
    if (!run) return;
    if (run.status === "cancelled" || run.status === "failed" || run.status === "completed") return;
    const tasks = this.store.listTasks(run.id);
    if (tasks.length === 0) {
      this.failRun(run.id, "Run has no tasks to review.");
      return;
    }
    if (!tasks.every((task) => task.status === "completed" || task.status === "skipped")) return;
    this.store.updateRun(run.id, { status: "reviewing" });
    const provider = this.requireProvider();
    const context = this.reviewContext(run);
    const reviewer = this.store.listAgents(run.id).find((agent) => agent.definitionKey === "reviewer");
    const accounted = new AccountedProvider(provider, this.modelCaller, {
      runId: run.id,
      taskId: null,
      agentId: reviewer?.id ?? null,
    });

    let review: ReviewOutput;
    try {
      const response = await accounted.complete({
        model: this.config.llm.model ?? undefined,
        system: buildReviewSystemPrompt(context),
        messages: [{ role: "user", content: "Return the review JSON now." }],
        temperature: 0.2,
        maxTokens: 2500,
      });
      const parsed = ReviewOutputSchema.safeParse(extractJsonValue(response.content));
      if (!parsed.success) {
        throw new Error(
          parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
        );
      }
      review = parsed.data;
    } catch (error) {
      review = {
        verdict: "pass",
        summary:
          "The automated reviewer could not complete. The final synthesis includes every specialist deliverable; review the listed issues before acting.",
        criteria: [],
        issues: [`Reviewer unavailable: ${(error as Error).message}`],
        recommendedActions: ["Review the final deliverable and specialist artifacts manually."],
      };
      this.activity(run.id, run.workspaceId, "review_fallback", "warning", "Automated review fallback used.", {
        error: (error as Error).message,
      });
    }

    const reviewMarkdown = [
      "# Quality review",
      "",
      `**Verdict:** ${review.verdict.toUpperCase()}`,
      "",
      review.summary,
      "",
      review.criteria.length > 0 ? "## Criteria" : "",
      review.criteria.length > 0
        ? `| Criterion | Result | Note |\n| --- | --- | --- |\n${review.criteria
            .map((criterion) => `| ${criterion.criterion} | ${criterion.result} | ${criterion.note} |`)
            .join("\n")}`
        : "",
      review.issues.length > 0 ? "## Issues" : "",
      review.issues.length > 0 ? review.issues.map((issue) => `- ${issue}`).join("\n") : "",
      review.recommendedActions.length > 0 ? "## Recommended actions" : "",
      review.recommendedActions.length > 0
        ? review.recommendedActions.map((action) => `- ${action}`).join("\n")
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    const artifact = this.store.createArtifact({
      runId: run.id,
      workspaceId: run.workspaceId,
      taskId: null,
      agentId: reviewer?.id ?? null,
      kind: "review",
      format: "markdown",
      title: "Quality review",
      filename: "quality-review.md",
      mimeType: "text/markdown; charset=utf-8",
      content: reviewMarkdown,
    });
    this.activity(run.id, run.workspaceId, "review_completed", review.verdict === "pass" ? "success" : "warning", `Review verdict: ${review.verdict}.`, {
      artifactId: artifact.id,
      issues: review.issues.length,
    });
    this.store.appendRunEvent(run.id, "review_completed", {
      verdict: review.verdict,
      artifactId: artifact.id,
    });
    this.store.enqueueJob({
      type: "finalize_run",
      runId: run.id,
      idempotencyKey: `finalize:${run.id}`,
      maxAttempts: 3,
    });
  }

  private async handleFinalize(job: Job): Promise<void> {
    const run = this.store.getRun(job.runId);
    if (!run) return;
    if (run.status === "cancelled" || run.status === "failed" || run.status === "completed") return;
    const context = this.reviewContext(run);
    if (context.outputs.length === 0) {
      this.failRun(run.id, "No completed task outputs are available to finalize.");
      return;
    }
    const provider = this.requireProvider();
    const accounted = new AccountedProvider(provider, this.modelCaller, {
      runId: run.id,
      taskId: null,
      agentId: null,
    });

    let content = "";
    try {
      const response = await accounted.complete({
        model: this.config.llm.model ?? undefined,
        system: buildFinalSystemPrompt(context),
        messages: [{ role: "user", content: "Write the final deliverable now." }],
        temperature: 0.3,
        maxTokens: 7000,
      });
      content = response.content.trim();
    } catch (error) {
      this.activity(run.id, run.workspaceId, "finalize_fallback", "warning", "Final synthesis fallback used.", {
        error: (error as Error).message,
      });
    }

    if (!content) {
      content = this.fallbackFinal(run, context);
    }

    const title = run.title ?? "SWARM final deliverable";
    const artifact = this.store.createArtifact({
      runId: run.id,
      workspaceId: run.workspaceId,
      taskId: null,
      agentId: null,
      kind: "final",
      format: "markdown",
      title,
      filename: `${slugify(title).slice(0, 60) || "final-deliverable"}.md`,
      mimeType: "text/markdown; charset=utf-8",
      content,
    });
    this.store.updateRun(run.id, {
      status: "completed",
      summary: truncate(content, 1200),
      completedAt: nowIso(),
      error: null,
    });
    for (const agent of this.store.listAgents(run.id)) {
      this.store.updateAgentStatus(agent.id, "done");
    }
    this.activity(run.id, run.workspaceId, "run_completed", "success", "Run completed. Final deliverable is ready.", {
      artifactId: artifact.id,
    });
    this.store.appendRunEvent(run.id, "run_completed", { artifactId: artifact.id });
  }

  private fallbackFinal(run: Run, context: ReviewPromptContext): string {
    const sections = context.outputs.map((entry) => {
      const output = entry.task.output as Record<string, unknown> | null;
      const deliverable = output?.deliverable as Record<string, unknown> | undefined;
      const title = typeof deliverable?.title === "string" ? deliverable.title : entry.task.deliverable;
      const body = typeof deliverable?.content === "string" ? deliverable.content : "";
      return `## ${title}\n\n${body}`;
    });
    return [
      `# ${run.title ?? "SWARM final deliverable"}`,
      "",
      "> Automated synthesis was unavailable. This deliverable combines the specialist outputs directly.",
      "",
      ...sections,
    ].join("\n");
  }

  failRun(runId: string, error: string): void {
    const run = this.store.getRun(runId);
    if (!run) return;
    if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") return;
    this.store.updateRun(runId, { status: "failed", error: error.slice(0, 4000), completedAt: nowIso() });
    for (const task of this.store.listTasks(runId)) {
      if (task.status === "completed" || task.status === "failed" || task.status === "cancelled" || task.status === "skipped") {
        continue;
      }
      this.store.updateTaskStatus(
        task.id,
        task.status === "running" || task.status === "awaiting_approval" ? "failed" : "skipped",
        { error: task.status === "running" || task.status === "awaiting_approval" ? error.slice(0, 4000) : null, completedAt: nowIso() },
      );
    }
    for (const agent of this.store.listAgents(runId)) {
      if (agent.status !== "done") this.store.updateAgentStatus(agent.id, "failed");
    }
    this.store.cancelPendingApprovalsForRun(runId);
    this.store.cancelQueuedJobsForRun(runId);
    this.activity(runId, run.workspaceId, "run_failed", "error", `Run failed: ${error}`, null);
    this.store.appendRunEvent(runId, "run_failed", { error: error.slice(0, 1000) });
  }

  private activity(
    runId: string,
    workspaceId: string,
    type: string,
    level: "info" | "success" | "warning" | "error",
    message: string,
    data: Record<string, unknown> | null = null,
  ): void {
    this.store.appendActivity({
      runId,
      workspaceId,
      type,
      level,
      message,
      data: data as JsonValue | null,
    });
  }
}

export function workspacePolicyNote(config: SwarmConfig): string {
  return `Model timeout ${config.limits.modelTimeoutMs}ms, tool timeout ${config.limits.toolTimeoutMs}ms.`;
}
