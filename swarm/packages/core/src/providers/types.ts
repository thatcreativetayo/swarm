import type { JsonValue } from "../contracts/common.js";

export type JsonSchema = Record<string, unknown>;

export interface LlmToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonSchema;
}

export interface LlmToolCall {
  id: string;
  name: string;
  /** Parsed JSON arguments. Invalid provider JSON is surfaced as an empty object. */
  arguments: Record<string, unknown>;
  rawArguments: string;
}

export type LlmMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; toolCalls?: LlmToolCall[] }
  | { role: "tool"; toolCallId: string; name: string; content: string };

export interface LlmUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface LlmRequest {
  model?: string;
  system?: string;
  messages: LlmMessage[];
  tools?: LlmToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  /** Ask compatible providers for a JSON object response when supported. */
  jsonMode?: boolean;
}

export interface LlmResponse {
  content: string;
  toolCalls: LlmToolCall[];
  usage: LlmUsage;
  finishReason: string | null;
  model: string;
  provider: string;
  raw?: JsonValue;
}

export interface LlmCallOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface LlmProvider {
  readonly name: string;
  readonly defaultModel: string;
  complete(request: LlmRequest, options?: LlmCallOptions): Promise<LlmResponse>;
}

export class LlmError extends Error {
  readonly status: number | null;
  readonly retryable: boolean;
  readonly provider: string;

  constructor(
    message: string,
    options: { status?: number | null; retryable?: boolean; provider?: string; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "LlmError";
    this.status = options.status ?? null;
    this.retryable = options.retryable ?? false;
    this.provider = options.provider ?? "unknown";
  }
}

export class LlmLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmLimitError";
  }
}
