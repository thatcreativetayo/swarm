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

export interface AnthropicOptions {
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
}

type AnthropicContentBlock = Record<string, unknown>;
interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
}

function mergeMessages(messages: AnthropicMessage[]): AnthropicMessage[] {
  const merged: AnthropicMessage[] = [];
  for (const message of messages) {
    const previous = merged[merged.length - 1];
    if (!previous || previous.role !== message.role) {
      merged.push(message);
      continue;
    }
    const previousBlocks: AnthropicContentBlock[] =
      typeof previous.content === "string" ? [{ type: "text", text: previous.content }] : previous.content;
    const nextBlocks: AnthropicContentBlock[] =
      typeof message.content === "string" ? [{ type: "text", text: message.content }] : message.content;
    previous.content = [...previousBlocks, ...nextBlocks];
  }
  return merged;
}

function toAnthropicMessages(messages: LlmMessage[]): AnthropicMessage[] {
  const result: AnthropicMessage[] = [];
  for (const message of messages) {
    if (message.role === "system") continue;
    if (message.role === "user") {
      result.push({ role: "user", content: message.content });
      continue;
    }
    if (message.role === "assistant") {
      const blocks: AnthropicContentBlock[] = [];
      if (message.content) blocks.push({ type: "text", text: message.content });
      for (const call of message.toolCalls ?? []) {
        blocks.push({ type: "tool_use", id: call.id, name: call.name, input: call.arguments });
      }
      result.push({ role: "assistant", content: blocks.length > 0 ? blocks : " " });
      continue;
    }
    result.push({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: message.toolCallId, content: message.content }],
    });
  }
  return mergeMessages(result);
}

export class AnthropicProvider implements LlmProvider {
  readonly name = "anthropic";
  readonly defaultModel: string;
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(options: AnthropicOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.defaultModel = options.defaultModel;
  }

  async complete(request: LlmRequest, options: LlmCallOptions = {}): Promise<LlmResponse> {
    const model = request.model ?? this.defaultModel;
    const systemParts: string[] = [];
    if (request.system) systemParts.push(request.system);
    for (const message of request.messages) {
      if (message.role === "system") systemParts.push(message.content);
    }

    const body: Record<string, unknown> = {
      model,
      max_tokens: request.maxTokens ?? 4096,
      temperature: request.temperature ?? 0.2,
      messages: toAnthropicMessages(request.messages),
    };
    if (systemParts.length > 0) body.system = systemParts.join("\n\n");
    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema,
      }));
    }

    const endpoint = this.baseUrl.endsWith("/v1") ? `${this.baseUrl}/messages` : `${this.baseUrl}/v1/messages`;
    const data = await postJsonWithRetry({
      url: endpoint,
      headers: {
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body,
      provider: this.name,
      timeoutMs: options.timeoutMs ?? 120_000,
      signal: options.signal,
    });

    const blocks = Array.isArray(data.content) ? data.content : [];
    const textParts: string[] = [];
    const toolCalls: LlmToolCall[] = [];
    for (const value of blocks) {
      const block = asRecord(value);
      if (block.type === "text") textParts.push(asString(block.text));
      if (block.type === "tool_use") {
        const input = asRecord(block.input);
        toolCalls.push({
          id: asString(block.id) || `toolu_${randomUUID().replaceAll("-", "")}`,
          name: asString(block.name),
          arguments: input,
          rawArguments: JSON.stringify(input),
        });
      }
    }

    const usage = asRecord(data.usage);
    const promptTokens = asNumber(usage.input_tokens);
    const completionTokens = asNumber(usage.output_tokens);

    return {
      content: textParts.join("\n").trim(),
      toolCalls,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
      },
      finishReason: asString(data.stop_reason) || null,
      model: asString(data.model) || model,
      provider: this.name,
      raw: data as unknown as LlmResponse["raw"],
    };
  }
}
