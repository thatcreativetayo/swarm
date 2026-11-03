import type { SwarmConfig } from "../config.js";
import { AnthropicProvider } from "./anthropic.js";
import { OpenAiCompatibleProvider } from "./openai.js";
import type { LlmProvider } from "./types.js";

export function createLlmProvider(config: SwarmConfig): LlmProvider | null {
  const { provider, apiKey, model, baseUrl } = config.llm;
  if (!provider || !model || !baseUrl) return null;
  if (provider === "anthropic") {
    if (!apiKey) return null;
    return new AnthropicProvider({ baseUrl, apiKey, defaultModel: model });
  }
  if (provider === "openai" || provider === "openrouter" || provider === "openai-compatible") {
    if (!apiKey && provider !== "openai-compatible") return null;
    return new OpenAiCompatibleProvider({
      name: provider,
      baseUrl,
      apiKey,
      defaultModel: model,
      extraHeaders:
        provider === "openrouter"
          ? {
              "http-referer": "https://github.com/swarm-workforce/swarm",
              "x-title": "SWARM",
            }
          : undefined,
      jsonMode: provider !== "openai-compatible",
    });
  }
  return null;
}
