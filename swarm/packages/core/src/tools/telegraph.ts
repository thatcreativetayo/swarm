import type { JsonValue } from "../contracts/common.js";
import { ToolError, type SwarmTool, type ToolContext, type ToolResult } from "./types.js";

const DEFAULT_MAX_PRICE_USD = 0.02;

function normalizeNodeUrl(value: string): string {
  return value.trim().replace(/\/+$/, "").replace(/\/engine$/i, "");
}

function nodeUrl(context: ToolContext): string {
  const configured = context.getIntegrationConfig("telegraph")?.nodeUrl;
  return normalizeNodeUrl(typeof configured === "string" && configured.trim() ? configured : context.config.telegraph.nodeUrl);
}

function timeoutSignal(context: ToolContext, ms = 30_000): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  const signal = context.signal ? AbortSignal.any([controller.signal, context.signal]) : controller.signal;
  return { signal, cleanup: () => clearTimeout(timer) };
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : { value: parsed };
  } catch {
    return { error: text.slice(0, 1000) };
  }
}

interface TelegraphQuote {
  priceUsd: number;
  amount: string;
  asset: string;
  network: string;
  payTo: string;
  maxTimeoutSeconds: number;
  challenge: Record<string, unknown>;
}

function decodeChallenge(response: Response): TelegraphQuote | null {
  const header = response.headers.get("payment-required") ?? response.headers.get("x-payment-required");
  if (!header) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(header, "base64").toString("utf8");
  } catch {
    return null;
  }
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(decoded) as Record<string, unknown>;
  } catch {
    return null;
  }
  const accepts = Array.isArray(payload.accepts) ? payload.accepts : [];
  const option = accepts.find(
    (value): value is Record<string, unknown> =>
      Boolean(value) && typeof value === "object" && !Array.isArray(value),
  );
  if (!option) return null;
  const amount = typeof option.amount === "string" ? option.amount : String(option.amount ?? "0");
  const numericAmount = Number(amount);
  return {
    priceUsd: Number.isFinite(numericAmount) ? numericAmount / 1_000_000 : 0,
    amount,
    asset: typeof option.asset === "string" ? option.asset : "",
    network: typeof option.network === "string" ? option.network : "",
    payTo: typeof option.payTo === "string" ? option.payTo : "",
    maxTimeoutSeconds: typeof option.maxTimeoutSeconds === "number" ? option.maxTimeoutSeconds : 60,
    challenge: payload,
  };
}

async function requestQuote(context: ToolContext, query: string): Promise<TelegraphQuote> {
  const { signal, cleanup } = timeoutSignal(context);
  try {
    const response = await fetch(`${nodeUrl(context)}/engine/v1/ask`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ query }),
      signal,
    });
    if (response.ok) {
      throw new ToolError(
        "Telegraph answered without a payment challenge. No quote is available for this request.",
        "quote_unavailable",
      );
    }
    if (response.status !== 402) {
      const body = await readJson(response);
      throw new ToolError(
        `Telegraph quote failed with HTTP ${response.status}: ${String(body.error ?? response.statusText)}`,
        "quote_failed",
      );
    }
    const quote = decodeChallenge(response);
    if (!quote) throw new ToolError("Telegraph returned a payment challenge that could not be decoded.", "quote_failed");
    return quote;
  } catch (error) {
    if (error instanceof ToolError) throw error;
    if (context.signal?.aborted) throw new ToolError("Telegraph quote was cancelled.", "cancelled");
    throw new ToolError(`Telegraph quote failed: ${(error as Error).message}`, "quote_failed");
  } finally {
    cleanup();
  }
}

async function paidFetch(
  context: ToolContext,
  query: string,
  minerId: string | null,
  privateKey: string,
  maxPriceUsd: number,
  signal: AbortSignal,
): Promise<Response> {
  const { wrapFetchWithPaymentFromConfig } = await import("@x402/fetch");
  const { ExactEvmScheme } = await import("@x402/evm");
  const { privateKeyToAccount } = await import("viem/accounts");
  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const paid = wrapFetchWithPaymentFromConfig(fetch, {
    schemes: [{ network: "eip155:*", client: new ExactEvmScheme(account) }],
    // Re-check the approved ceiling at payment time, not only at quote time.
    spendControls: { maxAmountPerPayment: maxPriceUsd },
  });
  const endpoint = minerId
    ? `${nodeUrl(context)}/engine/v1/ask/${encodeURIComponent(minerId)}`
    : `${nodeUrl(context)}/engine/v1/ask`;
  return paid(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ query }),
    signal,
  });
}

export function createTelegraphTools(): SwarmTool[] {
  return [
    {
      name: "telegraph_discover",
      description:
        "Discover live Telegraph miners (specialist intelligence providers) and their supported intents and prices. Free. Use this before requesting paid intelligence.",
      risk: "read",
      requiresApproval: false,
      source: "native",
      readOnlyHint: true,
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          intent: { type: "string", maxLength: 120 },
          limit: { type: "integer", minimum: 1, maximum: 25 },
        },
      },
      async execute(input, context): Promise<ToolResult> {
        const intent = typeof input.intent === "string" ? input.intent.trim() : "";
        const limit = typeof input.limit === "number" ? Math.min(25, Math.max(1, Math.trunc(input.limit))) : 10;
        const url = new URL(`${nodeUrl(context)}/api/miners`);
        if (intent) url.searchParams.set("intent", intent);
        url.searchParams.set("limit", String(limit));
        const { signal, cleanup } = timeoutSignal(context);
        try {
          const response = await fetch(url, { headers: { accept: "application/json" }, signal });
          const body = await readJson(response);
          if (!response.ok) {
            throw new ToolError(
              `Telegraph discovery failed with HTTP ${response.status}: ${String(body.error ?? response.statusText)}`,
              "discovery_failed",
            );
          }
          const miners = Array.isArray(body) ? body : Array.isArray(body.miners) ? body.miners : [];
          const compact = miners.slice(0, limit).map((value) => {
            const miner = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
            return {
              id: miner.id ?? null,
              slug: miner.slug ?? null,
              name: miner.name ?? null,
              intents: miner.supported_intents ?? miner.intents ?? [],
              minPriceUsdc: miner.min_price_usdc ?? null,
              status: miner.activation_status ?? miner.status ?? null,
              endpoints: Array.isArray(miner.endpoints)
                ? miner.endpoints.slice(0, 5).map((endpoint) => {
                    const record = endpoint && typeof endpoint === "object" ? (endpoint as Record<string, unknown>) : {};
                    return { path: record.path ?? null, method: record.method ?? null };
                  })
                : [],
            };
          });
          return {
            content: `Telegraph miners${intent ? ` for intent ${intent}` : ""}:\n${JSON.stringify(compact, null, 2)}`,
            data: compact as unknown as JsonValue,
          };
        } catch (error) {
          if (error instanceof ToolError) throw error;
          if (context.signal?.aborted) throw new ToolError("Discovery was cancelled.", "cancelled");
          throw new ToolError(`Telegraph discovery failed: ${(error as Error).message}`, "discovery_failed");
        } finally {
          cleanup();
        }
      },
    },
    {
      name: "telegraph_quote",
      description:
        "Get the current x402 price and payment terms for a Telegraph intelligence request without paying. Free. Always quote before requesting approval for a purchase.",
      risk: "read",
      requiresApproval: false,
      source: "native",
      readOnlyHint: true,
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["query"],
        properties: {
          query: { type: "string", minLength: 3, maxLength: 4000 },
        },
      },
      async execute(input, context): Promise<ToolResult> {
        const query = typeof input.query === "string" ? input.query.trim() : "";
        if (!query) throw new ToolError("telegraph_quote requires a query.", "invalid_input");
        const quote = await requestQuote(context, query);
        const compact = {
          priceUsd: quote.priceUsd,
          amount: quote.amount,
          asset: quote.asset,
          network: quote.network,
          payTo: quote.payTo,
          maxTimeoutSeconds: quote.maxTimeoutSeconds,
        };
        return {
          content: `Telegraph quote: $${quote.priceUsd.toFixed(4)} on ${quote.network} (asset ${quote.asset}). Payment is required before the request runs.`,
          data: compact as JsonValue,
        };
      },
    },
    {
      name: "telegraph_purchase",
      description:
        "Buy one Telegraph intelligence answer with x402. This spends testnet USDC and always requires explicit user approval. Use telegraph_quote first and set maxPriceUsd to the quoted price. The private key stays server-side.",
      risk: "purchase",
      requiresApproval: true,
      source: "native",
      isWrite: true,
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["query"],
        properties: {
          query: { type: "string", minLength: 3, maxLength: 4000 },
          minerId: { type: "string", maxLength: 120 },
          maxPriceUsd: { type: "number", minimum: 0.000001, maximum: 1 },
        },
      },
      async execute(input, context): Promise<ToolResult> {
        const query = typeof input.query === "string" ? input.query.trim() : "";
        if (!query) throw new ToolError("telegraph_purchase requires a query.", "invalid_input");
        const minerId = typeof input.minerId === "string" && input.minerId.trim() ? input.minerId.trim() : null;
        const maxPriceUsd =
          typeof input.maxPriceUsd === "number" ? input.maxPriceUsd : DEFAULT_MAX_PRICE_USD;

        const privateKey = context.getIntegrationSecret("telegraph") ?? context.config.telegraph.evmPrivateKey;
        if (!privateKey) {
          throw new ToolError(
            "Telegraph payments are not configured. Add a burner wallet key to the Telegraph integration or TELEGRAPH_EVM_PRIVATE_KEY.",
            "payment_not_configured",
          );
        }

        const quote = await requestQuote(context, query);
        if (quote.priceUsd > maxPriceUsd + 1e-9) {
          throw new ToolError(
            `Quoted price $${quote.priceUsd.toFixed(4)} exceeds the approved maximum $${maxPriceUsd.toFixed(4)}.`,
            "price_exceeds_limit",
          );
        }

        const { signal, cleanup } = timeoutSignal(context, 90_000);
        try {
          const response = await paidFetch(context, query, minerId, privateKey, maxPriceUsd, signal);
          const body = await readJson(response);
          if (!response.ok) {
            throw new ToolError(
              `Paid Telegraph request failed with HTTP ${response.status}: ${String(body.error ?? response.statusText)}. Failed calls are not charged.`,
              "purchase_failed",
            );
          }
          const result = {
            ...body,
            payment: {
              paidUsd: quote.priceUsd,
              paymentResponse: response.headers.get("payment-response"),
              receipt: response.headers.get("x-telegraph-receipt"),
            },
          };
          return {
            content: `Telegraph answer (paid $${quote.priceUsd.toFixed(4)}):\n${JSON.stringify(result, null, 2)}`,
            data: result as JsonValue,
          };
        } catch (error) {
          if (error instanceof ToolError) throw error;
          if (context.signal?.aborted) throw new ToolError("Telegraph purchase was cancelled.", "cancelled");
          throw new ToolError(`Telegraph purchase failed: ${(error as Error).message}`, "purchase_failed");
        } finally {
          cleanup();
        }
      },
    },
    {
      name: "telegraph_signal",
      description:
        "Verify or inspect a Telegraph signal by its signal_hash. Free. Use it to audit a paid answer and its receipt.",
      risk: "read",
      requiresApproval: false,
      source: "native",
      readOnlyHint: true,
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["signalHash"],
        properties: {
          signalHash: { type: "string", pattern: "^0x[0-9a-fA-F]{1,128}$", maxLength: 130 },
        },
      },
      async execute(input, context): Promise<ToolResult> {
        const signalHash = typeof input.signalHash === "string" ? input.signalHash.trim() : "";
        if (!/^0x[0-9a-fA-F]{1,128}$/.test(signalHash)) {
          throw new ToolError("Invalid signal hash.", "invalid_input");
        }
        const { signal, cleanup } = timeoutSignal(context);
        try {
          const response = await fetch(`${nodeUrl(context)}/engine/v1/signal/${signalHash}`, {
            headers: { accept: "application/json" },
            signal,
          });
          const body = await readJson(response);
          if (!response.ok) {
            throw new ToolError(
              `Signal lookup failed with HTTP ${response.status}: ${String(body.error ?? response.statusText)}`,
              "signal_lookup_failed",
            );
          }
          return { content: JSON.stringify(body, null, 2), data: body as JsonValue };
        } catch (error) {
          if (error instanceof ToolError) throw error;
          throw new ToolError(`Signal lookup failed: ${(error as Error).message}`, "signal_lookup_failed");
        } finally {
          cleanup();
        }
      },
    },
  ];
}
