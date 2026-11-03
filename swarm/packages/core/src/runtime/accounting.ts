import type { SwarmConfig } from "../config.js";
import type { Store } from "../db/repository.js";
import { estimateModelCost } from "../providers/pricing.js";
import type { LlmCallOptions, LlmProvider, LlmRequest, LlmResponse } from "../providers/types.js";

export class RunLimitError extends Error {
  readonly code: string;
  constructor(message: string, code = "run_limit") {
    super(message);
    this.name = "RunLimitError";
    this.code = code;
  }
}

export interface ModelCallMeta {
  runId: string;
  taskId: string | null;
  agentId: string | null;
}

export class ModelCaller {
  constructor(
    private readonly store: Store,
    private readonly config: SwarmConfig,
  ) {}

  assertBudget(runId: string): void {
    const run = this.store.getRun(runId);
    if (!run) throw new RunLimitError(`Run not found: ${runId}`, "run_not_found");
    if (run.status === "cancelled" || this.store.isCancelRequested(runId)) {
      throw new RunLimitError("Run was cancelled.", "cancelled");
    }
    const usage = this.store.getRunUsage(runId);
    if (usage.modelCalls >= this.config.limits.maxModelCalls) {
      throw new RunLimitError(
        `Run reached the ${this.config.limits.maxModelCalls} model-call limit.`,
        "model_call_limit",
      );
    }
    if (usage.totalTokens >= this.config.limits.maxTokens) {
      throw new RunLimitError(
        `Run reached the ${this.config.limits.maxTokens} token limit.`,
        "token_limit",
      );
    }
    if (run.startedAt) {
      const elapsed = Date.now() - new Date(run.startedAt).getTime();
      if (elapsed > this.config.limits.runTimeoutMs) {
        throw new RunLimitError("Run exceeded its time limit.", "timeout");
      }
    }
  }

  async call(
    provider: LlmProvider,
    request: LlmRequest,
    meta: ModelCallMeta,
    options: LlmCallOptions = {},
  ): Promise<LlmResponse> {
    this.assertBudget(meta.runId);
    const started = Date.now();
    try {
      const response = await provider.complete(request, {
        signal: options.signal,
        timeoutMs: options.timeoutMs ?? this.config.limits.modelTimeoutMs,
      });
      const cost = estimateModelCost(response.model, response.usage);
      this.store.createModelCall({
        runId: meta.runId,
        taskId: meta.taskId,
        agentId: meta.agentId,
        provider: response.provider,
        model: response.model,
        promptTokens: response.usage.promptTokens,
        completionTokens: response.usage.completionTokens,
        totalTokens: response.usage.totalTokens,
        costUsd: cost,
        status: "succeeded",
        error: null,
        durationMs: Date.now() - started,
      });
      this.store.incrementRunUsage(meta.runId, 1, response.usage.totalTokens, cost ?? 0);
      this.store.appendRunEvent(meta.runId, "model_call", {
        provider: response.provider,
        model: response.model,
        tokens: response.usage.totalTokens,
        costUsd: cost,
      });
      return response;
    } catch (error) {
      this.store.createModelCall({
        runId: meta.runId,
        taskId: meta.taskId,
        agentId: meta.agentId,
        provider: provider.name,
        model: request.model ?? provider.defaultModel,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        costUsd: null,
        status: "failed",
        error: (error as Error).message.slice(0, 2000),
        durationMs: Date.now() - started,
      });
      throw error;
    }
  }
}
