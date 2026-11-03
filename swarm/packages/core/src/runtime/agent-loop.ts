import type { Agent, ArtifactFormat, JsonValue, Memory, Run, Task, ToolRisk } from "../contracts/common.js";
import type { SwarmConfig } from "../config.js";
import type { Store } from "../db/repository.js";
import type { AgentDefinition, AgentOutput, GoalInterpretation } from "../domain/types.js";
import { AgentOutputSchema } from "../domain/types.js";
import { extractJsonValue } from "../providers/structured.js";
import type { LlmMessage, LlmProvider, LlmToolCall } from "../providers/types.js";
import { decideToolPolicy } from "../security/policy.js";
import { redactValue } from "../security/redact.js";
import type { SecretBox } from "../security/secrets.js";
import type { ToolRegistry } from "../tools/types.js";
import { addMs, nowIso, slugify } from "../utils/id.js";
import { hashJson, truncate } from "../utils/json.js";
import { ModelCaller, RunLimitError } from "./accounting.js";
import {
  buildAgentSystemPrompt,
  buildAgentUserPrompt,
  type PromptContext,
} from "./prompts.js";

interface AgentLoopState {
  version: 1;
  messages: LlmMessage[];
  turn: number;
  toolCallCount: number;
  corrections: number;
  pendingToolCalls: LlmToolCall[];
  pendingApprovalId: string | null;
  pendingToolExecutionId: string | null;
}

export interface AgentTaskInput {
  run: Run;
  task: Task;
  agent: Agent;
  definition: AgentDefinition;
  interpretation: GoalInterpretation | null;
  memories: Memory[];
  dependencies: Array<{ task: Task; agentName: string }>;
  signal?: AbortSignal;
}

export type AgentLoopOutcome =
  | { status: "completed"; output: AgentOutput; artifactId: string }
  | { status: "awaiting_approval"; approvalId: string }
  | { status: "cancelled" };

const MIME: Record<ArtifactFormat, string> = {
  markdown: "text/markdown; charset=utf-8",
  text: "text/plain; charset=utf-8",
  json: "application/json; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  html: "text/html; charset=utf-8",
};
const EXT: Record<ArtifactFormat, string> = {
  markdown: "md",
  text: "txt",
  json: "json",
  csv: "csv",
  html: "html",
};

function isCancelled(store: Store, runId: string): boolean {
  return store.isCancelRequested(runId);
}

function parseState(value: JsonValue | null): AgentLoopState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.version !== 1 || !Array.isArray(record.messages)) return null;
  return record as unknown as AgentLoopState;
}

export class AgentRunner {
  private readonly modelCaller: ModelCaller;

  constructor(
    private readonly deps: {
      store: Store;
      config: SwarmConfig;
      provider: LlmProvider;
      registry: ToolRegistry;
      secrets: SecretBox;
      modelCaller?: ModelCaller;
    },
  ) {
    this.modelCaller = deps.modelCaller ?? new ModelCaller(deps.store, deps.config);
  }

  private maxTurns(definition: AgentDefinition): number {
    return Math.max(2, Math.min(definition.maxSteps, this.deps.config.limits.maxToolSteps));
  }

  private allowedTools(definition: AgentDefinition) {
    const allowed = new Set(definition.allowedTools);
    for (const tool of this.deps.registry.list()) {
      if (tool.source !== "native") allowed.add(tool.name);
    }
    return this.deps.registry.filter([...allowed]);
  }

  async start(input: AgentTaskInput): Promise<AgentLoopOutcome> {
    if (isCancelled(this.deps.store, input.run.id)) return { status: "cancelled" };
    const tools = this.allowedTools(input.definition);
    const promptContext: PromptContext = {
      run: input.run,
      task: input.task,
      agent: input.agent,
      definition: input.definition,
      interpretation: input.interpretation,
      memories: input.memories,
      dependencies: input.dependencies,
      tools,
      maxTurns: this.maxTurns(input.definition),
    };
    const state: AgentLoopState = {
      version: 1,
      messages: [
        { role: "system", content: buildAgentSystemPrompt(promptContext) },
        { role: "user", content: buildAgentUserPrompt(promptContext) },
      ],
      turn: 0,
      toolCallCount: 0,
      corrections: 0,
      pendingToolCalls: [],
      pendingApprovalId: null,
      pendingToolExecutionId: null,
    };
    this.saveState(input.task.id, state);
    return this.runLoop(state, input, tools);
  }

  async resume(input: AgentTaskInput, approvalId: string): Promise<AgentLoopOutcome> {
    if (isCancelled(this.deps.store, input.run.id)) return { status: "cancelled" };
    const state = parseState(this.deps.store.getTaskRuntime(input.task.id));
    if (!state) {
      throw new Error(`No resumable runtime state for task ${input.task.id}.`);
    }
    const approval = this.deps.store.getApproval(approvalId);
    if (!approval) throw new Error(`Approval not found: ${approvalId}`);
    if (approval.status === "pending") {
      return { status: "awaiting_approval", approvalId };
    }
    if (state.pendingApprovalId !== approvalId || state.pendingToolCalls.length === 0) {
      throw new Error("Approval does not match the persisted task state.");
    }

    const tools = this.allowedTools(input.definition);
    this.deps.store.updateTaskStatus(input.task.id, "running", { startedAt: input.task.startedAt ?? nowIso() });
    this.deps.store.updateRun(input.run.id, { status: "executing" });
    this.deps.store.updateAgentStatus(input.agent.id, "working");

    const call = state.pendingToolCalls[0]!;
    const executionId = state.pendingToolExecutionId;
    if (approval.status === "approved") {
      const existing = executionId ? this.deps.store.getToolExecution(executionId) : null;
      if (existing?.status === "succeeded") {
        state.messages.push({
          role: "tool",
          toolCallId: call.id,
          name: call.name,
          content:
            typeof existing.output === "string"
              ? existing.output
              : JSON.stringify(existing.output ?? null),
        });
      } else {
        if (executionId) {
          this.deps.store.updateToolExecution(executionId, { status: "running" });
        }
        await this.executeTool(state, input, call, executionId, "approved");
      }
    } else {
      const status = approval.status === "expired" ? "timeout" : "denied";
      if (executionId) {
        this.deps.store.updateToolExecution(executionId, {
          status,
          error: approval.decisionReason ?? `Approval ${approval.status}.`,
          completedAt: nowIso(),
        });
      }
      state.messages.push({
        role: "tool",
        toolCallId: call.id,
        name: call.name,
        content: `Tool call was not executed: approval ${approval.status}${approval.decisionReason ? ` — ${approval.decisionReason}` : ""}. Adapt without this action.`,
      });
      this.activity(input, "tool_denied", "warning", `${call.name} was ${approval.status}.`, {
        approvalId,
      });
    }

    state.pendingToolCalls = state.pendingToolCalls.slice(1);
    state.pendingApprovalId = null;
    state.pendingToolExecutionId = null;
    this.saveState(input.task.id, state);

    if (state.pendingToolCalls.length > 0) {
      const suspended = await this.processToolCalls(state, input, state.pendingToolCalls);
      if (suspended) return { status: "awaiting_approval", approvalId: suspended };
    }
    state.pendingToolCalls = [];
    this.saveState(input.task.id, state);
    return this.runLoop(state, input, tools);
  }

  private async runLoop(
    state: AgentLoopState,
    input: AgentTaskInput,
    tools: ReturnType<AgentRunner["allowedTools"]>,
  ): Promise<AgentLoopOutcome> {
    const maxTurns = this.maxTurns(input.definition);
    const toolDefinitions = tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));
    const toolCallLimit = maxTurns * 3;

    while (state.turn < maxTurns) {
      if (isCancelled(this.deps.store, input.run.id)) return { status: "cancelled" };
      this.modelCaller.assertBudget(input.run.id);
      const response = await this.modelCaller.call(
        this.deps.provider,
        {
          model: input.agent.model ?? undefined,
          messages: state.messages,
          tools: toolDefinitions,
          temperature: 0.2,
          maxTokens: 4096,
        },
        { runId: input.run.id, taskId: input.task.id, agentId: input.agent.id },
        { signal: input.signal },
      );
      state.turn += 1;
      state.messages.push({
        role: "assistant",
        content: response.content || null,
        toolCalls: response.toolCalls.length > 0 ? response.toolCalls : undefined,
      });

      if (response.toolCalls.length > 0) {
        state.toolCallCount += response.toolCalls.length;
        if (state.toolCallCount > toolCallLimit) {
          throw new RunLimitError(
            `Agent ${input.agent.name} exceeded the ${toolCallLimit} tool-call limit.`,
            "tool_call_limit",
          );
        }
        const suspended = await this.processToolCalls(state, input, response.toolCalls);
        if (suspended) {
          this.saveState(input.task.id, state);
          return { status: "awaiting_approval", approvalId: suspended };
        }
        this.saveState(input.task.id, state);
        continue;
      }

      const parsed = this.parseOutput(response.content);
      if (!parsed.ok) {
        if (state.corrections >= 2) {
          throw new Error(`Agent ${input.agent.name} did not return a valid deliverable: ${parsed.error}`);
        }
        state.corrections += 1;
        state.messages.push({
          role: "user",
          content: [
            "Your previous response could not be accepted.",
            parsed.error,
            "Return ONLY one valid JSON object matching the required shape. Do not wrap it in markdown fences.",
          ].join("\n"),
        });
        this.saveState(input.task.id, state);
        continue;
      }

      const output = parsed.output;
      const format: ArtifactFormat = output.deliverable.format;
      const artifact = this.deps.store.createArtifact({
        runId: input.run.id,
        workspaceId: input.run.workspaceId,
        taskId: input.task.id,
        agentId: input.agent.id,
        kind: "deliverable",
        format,
        title: output.deliverable.title,
        filename: `${slugify(output.deliverable.title).slice(0, 60) || "deliverable"}.${EXT[format]}`,
        mimeType: MIME[format],
        content: output.deliverable.content,
      });
      this.deps.store.setTaskOutput(input.task.id, output as unknown as JsonValue, artifact.id);
      this.deps.store.upsertMemory(
        input.run.workspaceId,
        `run:${input.run.id}:${input.task.key}`.slice(0, 120),
        truncate(
          [
            `Task: ${input.task.title}`,
            `Summary: ${output.summary}`,
            output.findings.length ? `Findings:\n${output.findings.map((finding) => `- ${finding}`).join("\n")}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
          8000,
        ),
        [input.definition.key, input.agent.domainPack, input.task.key].slice(0, 8),
      );
      this.deps.store.deleteTaskRuntime(input.task.id);
      this.activity(input, "task_deliverable", "success", `${input.agent.name} produced "${output.deliverable.title}".`, {
        artifactId: artifact.id,
        confidence: output.confidence,
      });
      return { status: "completed", output, artifactId: artifact.id };
    }

    throw new RunLimitError(
      `Agent ${input.agent.name} reached the ${maxTurns}-turn limit without a deliverable.`,
      "turn_limit",
    );
  }

  private async processToolCalls(
    state: AgentLoopState,
    input: AgentTaskInput,
    calls: LlmToolCall[],
  ): Promise<string | null> {
    for (let index = 0; index < calls.length; index += 1) {
      if (isCancelled(this.deps.store, input.run.id)) {
        throw new RunLimitError("Run was cancelled.", "cancelled");
      }
      const call = calls[index]!;
      const tool = this.deps.registry.get(call.name);
      if (!tool) {
        state.messages.push({
          role: "tool",
          toolCallId: call.id,
          name: call.name,
          content: `Tool '${call.name}' is not available to this agent.`,
        });
        continue;
      }

      const httpMethod =
        typeof call.arguments.method === "string" ? call.arguments.method.toUpperCase() : null;
      const dynamicWrite =
        tool.name === "http_request" && httpMethod !== null
          ? httpMethod !== "GET" && httpMethod !== "HEAD"
          : Boolean(tool.isWrite);
      const risk: ToolRisk =
        tool.name === "http_request" && !dynamicWrite ? "read" : tool.risk;
      const policy = decideToolPolicy({
        toolName: tool.name,
        risk,
        requiresApproval: tool.requiresApproval,
        source: tool.source,
        readOnlyHint: tool.readOnlyHint,
        isWrite: dynamicWrite,
        domainPack: input.agent.domainPack,
        workspacePolicy: this.deps.store.getWorkspaceSettings(input.run.workspaceId),
      });
      const idempotencyKey =
        risk === "read" && !dynamicWrite
          ? null
          : hashJson({
              taskId: input.task.id,
              callId: call.id,
              tool: tool.name,
              input: call.arguments,
            });

      if (idempotencyKey) {
        const existing = this.deps.store.getToolExecutionByIdempotencyKey(idempotencyKey);
        if (existing) {
          if (existing.status === "succeeded") {
            state.messages.push({
              role: "tool",
              toolCallId: call.id,
              name: call.name,
              content: typeof existing.output === "string" ? existing.output : JSON.stringify(existing.output ?? null),
            });
            continue;
          }
          state.messages.push({
            role: "tool",
            toolCallId: call.id,
            name: call.name,
            content: `A previous execution of this exact tool call is in status '${existing.status}'. It was not repeated automatically to avoid a duplicate external action.`,
          });
          continue;
        }
      }

      if (policy.action === "deny") {
        const execution = this.deps.store.createToolExecution({
          runId: input.run.id,
          taskId: input.task.id,
          agentId: input.agent.id,
          toolName: tool.name,
          source: tool.source,
          status: "denied",
          requiresApproval: false,
          approvalId: null,
          input: call.arguments as JsonValue,
          idempotencyKey,
        });
        this.deps.store.updateToolExecution(execution.id, {
          status: "denied",
          error: policy.reason,
          completedAt: nowIso(),
        });
        state.messages.push({
          role: "tool",
          toolCallId: call.id,
          name: call.name,
          content: `Tool call denied by policy: ${policy.reason}`,
        });
        this.activity(input, "tool_denied", "warning", `${tool.name} denied by policy.`, {
          reason: policy.reason,
        });
        continue;
      }

      if (policy.action === "approval") {
        const execution = this.deps.store.createToolExecution({
          runId: input.run.id,
          taskId: input.task.id,
          agentId: input.agent.id,
          toolName: tool.name,
          source: tool.source,
          status: "awaiting_approval",
          requiresApproval: true,
          approvalId: null,
          input: call.arguments as JsonValue,
          idempotencyKey,
        });
        const approval = this.deps.store.createApproval({
          runId: input.run.id,
          workspaceId: input.run.workspaceId,
          taskId: input.task.id,
          agentId: input.agent.id,
          kind: risk === "purchase" ? "purchase" : "tool",
          title: risk === "purchase" ? `Approve purchase: ${tool.name}` : `Approve ${tool.name}`,
          summary: `${input.agent.name} wants to run ${tool.name} (${risk}). ${policy.reason}`,
          payload: {
            toolExecutionId: execution.id,
            toolName: tool.name,
            toolCallId: call.id,
            source: tool.source,
            risk,
            input: redactValue(call.arguments) as JsonValue,
            taskId: input.task.id,
            agentId: input.agent.id,
          },
          expiresAt: addMs(nowIso(), 24 * 60 * 60 * 1000),
        });
        this.deps.store.setToolExecutionApproval(execution.id, approval.id);
        this.deps.store.updateTaskStatus(input.task.id, "awaiting_approval");
        this.deps.store.updateRun(input.run.id, { status: "awaiting_approval" });
        this.deps.store.updateAgentStatus(input.agent.id, "awaiting_approval");
        state.pendingToolCalls = calls.slice(index);
        state.pendingApprovalId = approval.id;
        state.pendingToolExecutionId = execution.id;
        this.saveState(input.task.id, state);
        this.activity(input, "approval_requested", "warning", `Approval requested for ${tool.name}.`, {
          approvalId: approval.id,
          risk,
        });
        this.deps.store.appendRunEvent(input.run.id, "approval_requested", {
          approvalId: approval.id,
          toolName: tool.name,
          risk,
        });
        return approval.id;
      }

      const execution = this.deps.store.createToolExecution({
        runId: input.run.id,
        taskId: input.task.id,
        agentId: input.agent.id,
        toolName: tool.name,
        source: tool.source,
        status: "running",
        requiresApproval: false,
        approvalId: null,
        input: call.arguments as JsonValue,
        idempotencyKey,
      });
      await this.executeTool(state, input, call, execution.id, "policy");
    }
    return null;
  }

  private async executeTool(
    state: AgentLoopState,
    input: AgentTaskInput,
    call: LlmToolCall,
    executionId: string | null,
    reason: "policy" | "approved",
  ): Promise<void> {
    const tool = this.deps.registry.get(call.name);
    if (!tool) {
      state.messages.push({
        role: "tool",
        toolCallId: call.id,
        name: call.name,
        content: `Tool '${call.name}' is no longer available.`,
      });
      return;
    }
    if (!executionId) {
      state.messages.push({
        role: "tool",
        toolCallId: call.id,
        name: call.name,
        content: "The approved tool execution record is missing; the action was not run.",
      });
      return;
    }

    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new DOMException("Tool timed out", "TimeoutError")),
      this.deps.config.limits.toolTimeoutMs,
    );
    const signal = input.signal ? AbortSignal.any([controller.signal, input.signal]) : controller.signal;
    this.deps.store.updateToolExecution(executionId, { status: "running" });

    try {
      const result = await tool.execute(call.arguments, {
        store: this.deps.store,
        config: this.deps.config,
        workspaceId: input.run.workspaceId,
        runId: input.run.id,
        taskId: input.task.id,
        agentId: input.agent.id,
        domainPack: input.agent.domainPack,
        signal,
        getIntegrationSecret: (provider) =>
          this.deps.secrets.integrationSecret(input.run.workspaceId, provider),
        getIntegrationConfig: (provider) =>
          this.deps.secrets.integrationConfig(input.run.workspaceId, provider),
      });
      const durationMs = Date.now() - started;
      this.deps.store.updateToolExecution(executionId, {
        status: "succeeded",
        output: (result.data ?? result.content) as JsonValue,
        completedAt: nowIso(),
        durationMs,
      });
      state.messages.push({
        role: "tool",
        toolCallId: call.id,
        name: call.name,
        content: truncate(result.content, 30_000),
      });
      this.activity(input, "tool_succeeded", "success", `${tool.name} completed in ${durationMs}ms.`, {
        executionId,
        reason,
      });
      this.deps.store.appendRunEvent(input.run.id, "tool_completed", {
        toolName: tool.name,
        executionId,
        status: "succeeded",
        durationMs,
      });
    } catch (error) {
      const durationMs = Date.now() - started;
      const timedOut = controller.signal.aborted;
      const message = timedOut
        ? `Tool ${tool.name} timed out after ${this.deps.config.limits.toolTimeoutMs}ms.`
        : (error as Error).message;
      this.deps.store.updateToolExecution(executionId, {
        status: timedOut ? "timeout" : "failed",
        error: message.slice(0, 4000),
        completedAt: nowIso(),
        durationMs,
      });
      state.messages.push({
        role: "tool",
        toolCallId: call.id,
        name: call.name,
        content: `Tool error (${tool.name}): ${message}\nThe action did not complete. Adapt your approach; do not claim it succeeded.`,
      });
      this.activity(input, "tool_failed", "warning", `${tool.name} failed: ${message}`, {
        executionId,
      });
      this.deps.store.appendRunEvent(input.run.id, "tool_completed", {
        toolName: tool.name,
        executionId,
        status: timedOut ? "timeout" : "failed",
        error: message.slice(0, 1000),
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private parseOutput(content: string): { ok: true; output: AgentOutput } | { ok: false; error: string } {
    if (!content.trim()) return { ok: false, error: "The response was empty." };
    try {
      const raw = extractJsonValue(content);
      const parsed = AgentOutputSchema.safeParse(raw);
      if (!parsed.success) {
        return {
          ok: false,
          error: `The JSON did not match the required output schema: ${parsed.error.issues
            .map((issue) => `${issue.path.join(".") || "value"}: ${issue.message}`)
            .join("; ")}`,
        };
      }
      return { ok: true, output: parsed.data };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  }

  private saveState(taskId: string, state: AgentLoopState): void {
    this.deps.store.saveTaskRuntime(taskId, state as unknown as JsonValue);
  }

  private activity(
    input: AgentTaskInput,
    type: string,
    level: "info" | "success" | "warning" | "error",
    message: string,
    data: Record<string, unknown> | null = null,
  ): void {
    this.deps.store.appendActivity({
      runId: input.run.id,
      workspaceId: input.run.workspaceId,
      taskId: input.task.id,
      agentId: input.agent.id,
      type,
      level,
      message,
      data: data as JsonValue | null,
    });
  }
}
