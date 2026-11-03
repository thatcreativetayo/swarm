import type { LlmUsage } from "./types.js";

interface Price {
  inputPerMillion: number;
  outputPerMillion: number;
}

/**
 * Approximate public list prices used only for local spend visibility.
 * Unknown models return null instead of inventing a cost.
 */
const PRICES: Array<{ match: RegExp; price: Price }> = [
  { match: /^gpt-4\.1-mini/i, price: { inputPerMillion: 0.4, outputPerMillion: 1.6 } },
  { match: /^gpt-4\.1-nano/i, price: { inputPerMillion: 0.1, outputPerMillion: 0.4 } },
  { match: /^gpt-4\.1/i, price: { inputPerMillion: 2, outputPerMillion: 8 } },
  { match: /^gpt-4o-mini/i, price: { inputPerMillion: 0.15, outputPerMillion: 0.6 } },
  { match: /^gpt-4o/i, price: { inputPerMillion: 2.5, outputPerMillion: 10 } },
  { match: /^o4-mini/i, price: { inputPerMillion: 1.1, outputPerMillion: 4.4 } },
  { match: /^claude-sonnet-4/i, price: { inputPerMillion: 3, outputPerMillion: 15 } },
  { match: /^claude-opus-4/i, price: { inputPerMillion: 15, outputPerMillion: 75 } },
  { match: /^claude-3-5-haiku/i, price: { inputPerMillion: 0.8, outputPerMillion: 4 } },
  { match: /^claude-3-5-sonnet/i, price: { inputPerMillion: 3, outputPerMillion: 15 } },
];

export function estimateModelCost(model: string, usage: LlmUsage): number | null {
  const entry = PRICES.find((candidate) => candidate.match.test(model));
  if (!entry) return null;
  const cost =
    (usage.promptTokens / 1_000_000) * entry.price.inputPerMillion +
    (usage.completionTokens / 1_000_000) * entry.price.outputPerMillion;
  return Math.round(cost * 1_000_000) / 1_000_000;
}
