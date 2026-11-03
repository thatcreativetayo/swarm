import { describe, expect, it } from "vitest";
import {
  extractJsonValue,
  generateJson,
  StructuredOutputError,
} from "../src/providers/structured.js";
import { QueueProvider } from "./helpers.js";

describe("extractJsonValue", () => {
  it("parses plain objects and arrays", () => {
    expect(extractJsonValue('{"a":1}')).toEqual({ a: 1 });
    expect(extractJsonValue("[1,2,3]")).toEqual([1, 2, 3]);
  });

  it("parses fenced JSON", () => {
    expect(extractJsonValue('```json\n{"ok":true}\n```')).toEqual({ ok: true });
    expect(extractJsonValue("```\n[1,2]\n```")).toEqual([1, 2]);
  });

  it("extracts a JSON value surrounded by prose", () => {
    expect(extractJsonValue('Here is the result:\n{"a":{"b":"}"}}\nThanks')).toEqual({
      a: { b: "}" },
    });
  });

  it("handles braces and escapes inside strings", () => {
    expect(extractJsonValue('prefix {"text":"a \\"quoted\\" } brace"} suffix')).toEqual({
      text: 'a "quoted" } brace',
    });
  });

  it("rejects empty, malformed and incomplete JSON", () => {
    expect(() => extractJsonValue("   ")).toThrow(StructuredOutputError);
    expect(() => extractJsonValue("no json here")).toThrow(StructuredOutputError);
    expect(() => extractJsonValue('{"a":}')).toThrow(StructuredOutputError);
    expect(() => extractJsonValue('{"a":1')).toThrow(StructuredOutputError);
  });
});

describe("generateJson", () => {
  it("retries once with a correction prompt after invalid JSON", async () => {
    const provider = new QueueProvider(["not json", '{"ok":true}']);
    const result = await generateJson({
      provider,
      system: "system",
      prompt: "prompt",
      attempts: 2,
    });
    expect(result).toEqual({ ok: true });
    expect(provider.requests).toHaveLength(2);
    const secondPrompt = provider.requests[1]?.messages[0];
    expect(secondPrompt?.content).toContain("previous response was not valid JSON");
  });

  it("throws after exhausting attempts", async () => {
    const provider = new QueueProvider(["nope", "nope"]);
    await expect(
      generateJson({ provider, system: "system", prompt: "prompt", attempts: 2 }),
    ).rejects.toBeInstanceOf(StructuredOutputError);
    expect(provider.requests).toHaveLength(2);
  });
});
