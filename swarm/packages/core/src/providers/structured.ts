import type { LlmProvider } from "./types.js";
import { LlmError } from "./types.js";

export class StructuredOutputError extends Error {
  readonly content: string;
  constructor(message: string, content: string) {
    super(message);
    this.name = "StructuredOutputError";
    this.content = content;
  }
}

export function extractJsonValue(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) throw new StructuredOutputError("Model returned an empty response.", text);

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? trimmed).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    // Fall through to balanced-brace extraction.
  }

  const start = candidate.search(/[\[{]/);
  if (start < 0) throw new StructuredOutputError("Model response did not contain JSON.", text);
  const opening = candidate[start];
  const closing = opening === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < candidate.length; index += 1) {
    const character = candidate[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === opening) depth += 1;
    if (character === closing) {
      depth -= 1;
      if (depth === 0) {
        const slice = candidate.slice(start, index + 1);
        try {
          return JSON.parse(slice);
        } catch (error) {
          throw new StructuredOutputError(
            `Model returned malformed JSON: ${(error as Error).message}`,
            text,
          );
        }
      }
    }
  }
  throw new StructuredOutputError("Model returned incomplete JSON.", text);
}

export interface GenerateJsonOptions {
  provider: LlmProvider;
  system: string;
  prompt: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
  attempts?: number;
}

export async function generateJson(options: GenerateJsonOptions): Promise<unknown> {
  const attempts = options.attempts ?? 2;
  let correction = "";
  let lastContent = "";

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const response = await options.provider.complete(
      {
        model: options.model,
        system: options.system,
        messages: [
          {
            role: "user",
            content: correction
              ? `${options.prompt}\n\nYour previous response was not valid JSON. Return only one JSON value with no prose or markdown.\n\nPrevious response:\n${correction.slice(0, 2000)}`
              : options.prompt,
          },
        ],
        temperature: options.temperature ?? 0.2,
        maxTokens: options.maxTokens ?? 4096,
        jsonMode: true,
      },
      { signal: options.signal, timeoutMs: options.timeoutMs },
    );
    lastContent = response.content;
    try {
      return extractJsonValue(response.content);
    } catch (error) {
      if (!(error instanceof StructuredOutputError)) throw error;
      correction = response.content;
      if (attempt === attempts - 1) throw error;
    }
  }

  throw new LlmError("Structured generation failed without a response.", {
    provider: options.provider.name,
    cause: new StructuredOutputError("No response", lastContent),
  });
}
