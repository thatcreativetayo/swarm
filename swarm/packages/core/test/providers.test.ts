import { afterEach, describe, expect, it, vi } from "vitest";
import { AnthropicProvider } from "../src/providers/anthropic.js";
import { postJsonWithRetry } from "../src/providers/http.js";
import { OpenAiCompatibleProvider } from "../src/providers/openai.js";
import { LlmError } from "../src/providers/types.js";

interface RecordedCall {
  url: string;
  init: RequestInit;
}

const calls: RecordedCall[] = [];
let responses: Response[] = [];

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function stubFetch(): void {
  calls.length = 0;
  responses = [];
  vi.stubGlobal(
    "fetch",
    async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
      calls.push({ url: String(input), init });
      const next = responses.shift();
      if (!next) throw new Error("No mocked response left.");
      return next;
    },
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OpenAI-compatible provider", () => {
  it("sends a chat completion request and parses content, tools and usage", async () => {
    stubFetch();
    responses.push(
      jsonResponse({
        id: "chatcmpl_1",
        model: "test-model",
        choices: [
          {
            message: {
              content: "hello",
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: {
                    name: "web_fetch",
                    arguments: '{"url":"https://example.com"}',
                  },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
        usage: { prompt_tokens: 12, completion_tokens: 7, total_tokens: 19 },
      }),
    );

    const provider = new OpenAiCompatibleProvider({
      name: "openai",
      baseUrl: "https://api.example.test/v1/",
      apiKey: "test-key",
      defaultModel: "default-model",
      jsonMode: true,
    });
    const response = await provider.complete({
      messages: [
        { role: "system", content: "system message" },
        { role: "user", content: "user message" },
      ],
      tools: [
        {
          name: "web_fetch",
          description: "Fetch a URL",
          inputSchema: { type: "object" },
        },
      ],
      jsonMode: true,
      temperature: 0.4,
      maxTokens: 1234,
    });

    expect(response.content).toBe("hello");
    expect(response.toolCalls).toHaveLength(1);
    expect(response.toolCalls[0]).toMatchObject({
      id: "call_1",
      name: "web_fetch",
      arguments: { url: "https://example.com" },
    });
    expect(response.usage).toEqual({ promptTokens: 12, completionTokens: 7, totalTokens: 19 });
    expect(response.finishReason).toBe("tool_calls");
    expect(response.model).toBe("test-model");
    expect(response.provider).toBe("openai");

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.example.test/v1/chat/completions");
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer test-key");
    const body = JSON.parse(String(calls[0]?.init.body)) as Record<string, unknown>;
    expect(body.model).toBe("default-model");
    expect(body.temperature).toBe(0.4);
    expect(body.max_tokens).toBe(1234);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.tool_choice).toBe("auto");
    expect(body.messages).toEqual([
      { role: "system", content: "system message" },
      { role: "user", content: "user message" },
    ]);
  });

  it("maps assistant tool calls and tool results back into the request", async () => {
    stubFetch();
    responses.push(jsonResponse({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }] }));
    const provider = new OpenAiCompatibleProvider({
      name: "local",
      baseUrl: "http://127.0.0.1:1234/v1",
      apiKey: null,
      defaultModel: "local-model",
    });
    await provider.complete({
      messages: [
        {
          role: "assistant",
          content: null,
          toolCalls: [
            {
              id: "call_9",
              name: "web_fetch",
              arguments: { url: "https://example.com" },
              rawArguments: '{"url":"https://example.com"}',
            },
          ],
        },
        { role: "tool", toolCallId: "call_9", name: "web_fetch", content: "result" },
      ],
    });
    const body = JSON.parse(String(calls[0]?.init.body)) as {
      messages: Array<Record<string, unknown>>;
      tools?: unknown;
      response_format?: unknown;
    };
    expect(body.messages[0]).toMatchObject({
      role: "assistant",
      content: "",
      tool_calls: [
        {
          id: "call_9",
          type: "function",
          function: { name: "web_fetch", arguments: '{"url":"https://example.com"}' },
        },
      ],
    });
    expect(body.messages[1]).toEqual({
      role: "tool",
      tool_call_id: "call_9",
      content: "result",
    });
    expect(body.tools).toBeUndefined();
    expect(body.response_format).toBeUndefined();
  });

  it("turns malformed tool arguments into an empty object", async () => {
    stubFetch();
    responses.push(
      jsonResponse({
        choices: [
          {
            message: {
              content: "",
              tool_calls: [
                { id: "call_bad", function: { name: "web_fetch", arguments: "{bad" } },
              ],
            },
          },
        ],
      }),
    );
    const provider = new OpenAiCompatibleProvider({
      name: "local",
      baseUrl: "http://127.0.0.1:1234/v1",
      apiKey: null,
      defaultModel: "local-model",
    });
    const response = await provider.complete({ messages: [{ role: "user", content: "go" }] });
    expect(response.toolCalls[0]?.arguments).toEqual({});
    expect(response.toolCalls[0]?.rawArguments).toBe("{bad");
  });

  it("retries retryable responses and respects retry-after", async () => {
    stubFetch();
    responses.push(
      jsonResponse({ error: "overloaded" }, 503, { "retry-after": "0" }),
      jsonResponse({ choices: [{ message: { content: "recovered" } }] }),
    );
    const provider = new OpenAiCompatibleProvider({
      name: "openai",
      baseUrl: "https://api.example.test/v1",
      apiKey: "key",
      defaultModel: "model",
    });
    const response = await provider.complete({ messages: [{ role: "user", content: "go" }] });
    expect(response.content).toBe("recovered");
    expect(calls).toHaveLength(2);
  });

  it("surfaces non-retryable HTTP errors without retrying", async () => {
    stubFetch();
    responses.push(jsonResponse({ error: "bad key" }, 401));
    const provider = new OpenAiCompatibleProvider({
      name: "openai",
      baseUrl: "https://api.example.test/v1",
      apiKey: "key",
      defaultModel: "model",
    });
    await expect(
      provider.complete({ messages: [{ role: "user", content: "go" }] }),
    ).rejects.toMatchObject({ name: "LlmError", status: 401, retryable: false });
    expect(calls).toHaveLength(1);
  });
});

describe("Anthropic provider", () => {
  it("sends system, messages and tools, and parses text and tool_use blocks", async () => {
    stubFetch();
    responses.push(
      jsonResponse({
        model: "claude-test",
        content: [
          { type: "text", text: "hello" },
          { type: "tool_use", id: "toolu_1", name: "web_fetch", input: { url: "https://example.com" } },
        ],
        stop_reason: "tool_use",
        usage: { input_tokens: 11, output_tokens: 5 },
      }),
    );
    const provider = new AnthropicProvider({
      baseUrl: "https://api.anthropic.test",
      apiKey: "anthropic-key",
      defaultModel: "claude-test",
    });
    const response = await provider.complete({
      system: "system prompt",
      messages: [{ role: "user", content: "user prompt" }],
      tools: [{ name: "web_fetch", description: "Fetch", inputSchema: { type: "object" } }],
    });

    expect(response.content).toBe("hello");
    expect(response.toolCalls[0]).toMatchObject({
      id: "toolu_1",
      name: "web_fetch",
      arguments: { url: "https://example.com" },
    });
    expect(response.usage).toEqual({ promptTokens: 11, completionTokens: 5, totalTokens: 16 });
    expect(response.finishReason).toBe("tool_use");

    expect(calls[0]?.url).toBe("https://api.anthropic.test/v1/messages");
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("anthropic-key");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    const body = JSON.parse(String(calls[0]?.init.body)) as Record<string, unknown>;
    expect(body.system).toBe("system prompt");
    expect(body.tools).toEqual([
      { name: "web_fetch", description: "Fetch", input_schema: { type: "object" } },
    ]);
  });

  it("uses the /messages endpoint when the base URL already ends in /v1", async () => {
    stubFetch();
    responses.push(jsonResponse({ content: [{ type: "text", text: "ok" }] }));
    const provider = new AnthropicProvider({
      baseUrl: "https://api.anthropic.test/v1",
      apiKey: "key",
      defaultModel: "claude-test",
    });
    await provider.complete({ messages: [{ role: "user", content: "go" }] });
    expect(calls[0]?.url).toBe("https://api.anthropic.test/v1/messages");
  });
});

describe("postJsonWithRetry", () => {
  it("wraps network failures in LlmError after retries are exhausted", async () => {
    stubFetch();
    responses.push(
      jsonResponse({}, 500, { "retry-after": "0" }),
      jsonResponse({}, 500, { "retry-after": "0" }),
    );
    await expect(
      postJsonWithRetry({
        url: "https://api.example.test",
        headers: {},
        body: {},
        provider: "test",
        timeoutMs: 1000,
        retries: 1,
      }),
    ).rejects.toBeInstanceOf(LlmError);
    expect(calls).toHaveLength(2);
  });

  it("returns parsed JSON on success", async () => {
    stubFetch();
    responses.push(jsonResponse({ ok: true }));
    const result = await postJsonWithRetry({
      url: "https://api.example.test",
      headers: {},
      body: {},
      provider: "test",
      timeoutMs: 1000,
      retries: 0,
    });
    expect(result).toEqual({ ok: true });
  });
});
