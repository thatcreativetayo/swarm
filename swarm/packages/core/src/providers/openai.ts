import { randomUUID } from "node:crypto";
import { asNumber, asRecord, asString, postJsonWithRetry } from "./http.js";
import type {
  LlmCallOptions,
  LlmMessage,
  LlmProvider,
  LlmRequest,
  LlmResponse,
  LlmToolCall,
} from "./types.js";

export interface OpenAiCompatibleOptions {
  name: string;
  baseUrl: string;
  apiKey: string | null;
  defaultModel: string;
  extraHeaders?: Record<string, string>;
  jsonMode?: boolean;
}

interface OpenAiToolCall {
  id?: string;
  function?: { name?: string; arguments?: string };
}

function parseArguments(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return asRecord(parsed);
  } catch {
    return {};
  }
}

function toOpenAiMessage(message: LlmMessage): Record<string, unknown> {
  if (message.role === "tool") {
    return { role: "tool", tool_call_id: message.toolCallId, content: message.content };
  }
  if (message.role === "assistant") {
    const result: Record<string, unknown> = { role: "assistant", content: message.content ?? "" };
    if (message.toolCalls && message.toolCalls.length > 0) {
      result.tool_calls = message.toolCalls.map((call) => ({
        id: call.id,
        type: "function",
        function: { name: call.name, arguments: call.rawArguments || JSON.stringify(call.arguments) },
      }));
    }
    return result;
  }
  return { role: message.role, content: message.content };
}

export class OpenAiCompatibleProvider implements LlmProvider {
  readonly name: string;
  readonly defaultModel: string;
  private readonly baseUrl: string;
  private readonly apiKey: string | null;
  private readonly extraHeaders: Record<string, string>;
  private readonly jsonMode: boolean;

  constructor(options: OpenAiCompatibleOptions) {
    this.name = options.name;
    this.defaultModel = options.defaultModel;
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.extraHeaders = options.extraHeaders ?? {};
    this.jsonMode = options.jsonMode ?? false;
  }

  async complete(request: LlmRequest, options: LlmCallOptions = {}): Promise<LlmResponse> {
    const model = request.model ?? this.defaultModel;
    const messages: Record<string, unknown>[] = [];
    if (request.system) messages.push({ role: "system", content: request.system });
    for (const message of request.messages) messages.push(toOpenAiMessage(message));

    const body: Record<string, unknown> = {
      model,
      messages,
      temperature: request.temperature ?? 0.2,
      max_tokens: request.maxTokens ?? 4096,
    };
    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map((tool) => ({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema,
        },
      }));
      body.tool_choice = "auto";
    }
    if (request.jsonMode && this.jsonMode) {
      body.response_format = { type: "json_object" };
    }

    const headers: Record<string, string> = { ...this.extraHeaders };
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;

    const data = await postJsonWithRetry({
      url: `${this.baseUrl}/chat/completions`,
      headers,
      body,
      provider: this.name,
      timeoutMs: options.timeoutMs ?? 120_000,
      signal: options.signal,
    });

    const choices = Array.isArray(data.choices) ? data.choices : [];
    const choice = asRecord(choices[0]);
    const message = asRecord(choice.message);
    const content = asString(message.content);
    const rawToolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];

    const toolCalls: LlmToolCall[] = rawToolCalls.map((value) => {
      const call = asRecord(value) as OpenAiToolCall;
      const fn = asRecord(call.function);
      const rawArguments = asString(fn.arguments) || "{}";
      return {
        id: call.id || `call_${randomUUID().replaceAll("-", "")}`,
        name: asString(fn.name),
        arguments: parseArguments(rawArguments),
        rawArguments,
      };
    }).filter((call) => call.name.length > 0);

    const usage = asRecord(data.usage);
    const promptTokens = asNumber(usage.prompt_tokens);
    const completionTokens = asNumber(usage.completion_tokens);

    return {
      content,
      toolCalls,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: asNumber(usage.total_tokens) || promptTokens + completionTokens,
      },
      finishReason: asString(choice.finish_reason) || null,
      model: asString(data.model) || model,
      provider: this.name,
      raw: data as unknown as LlmResponse["raw"],
    };
  }
}
