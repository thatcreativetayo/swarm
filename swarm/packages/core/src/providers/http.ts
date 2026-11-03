import { LlmError } from "./types.js";

export interface JsonHttpOptions {
  url: string;
  headers: Record<string, string>;
  body: unknown;
  provider: string;
  timeoutMs: number;
  signal?: AbortSignal;
  retries?: number;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function retryDelayMs(response: Response | null, attempt: number): number {
  const header = response?.headers.get("retry-after");
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(30_000, seconds * 1000);
    const date = Date.parse(header);
    if (Number.isFinite(date)) return Math.max(0, Math.min(30_000, date - Date.now()));
  }
  return Math.min(8_000, 500 * 2 ** attempt + Math.floor(Math.random() * 250));
}

function combineSignals(timeoutMs: number, external?: AbortSignal): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException("Request timed out", "TimeoutError")), timeoutMs);
  const signals: AbortSignal[] = [controller.signal];
  if (external) signals.push(external);
  const signal = AbortSignal.any(signals);
  return {
    signal,
    cleanup: () => clearTimeout(timer),
  };
}

export async function postJsonWithRetry(options: JsonHttpOptions): Promise<Record<string, unknown>> {
  const retries = options.retries ?? 2;
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const { signal, cleanup } = combineSignals(options.timeoutMs, options.signal);
    let response: Response | null = null;
    try {
      response = await fetch(options.url, {
        method: "POST",
        headers: { "content-type": "application/json", ...options.headers },
        body: JSON.stringify(options.body),
        signal,
      });
    } catch (error) {
      cleanup();
      const aborted = options.signal?.aborted === true;
      if (aborted) throw new LlmError("Model request was cancelled.", { provider: options.provider, cause: error });
      lastError = error;
      if (attempt < retries) {
        await sleep(retryDelayMs(null, attempt), options.signal);
        continue;
      }
      throw new LlmError(`Could not reach ${options.provider}: ${(error as Error).message}`, {
        provider: options.provider,
        retryable: true,
        cause: error,
      });
    }

    try {
      if (response.ok) {
        return (await response.json()) as Record<string, unknown>;
      }

      const bodyText = (await response.text()).slice(0, 1200);
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
      lastError = new LlmError(
        `${options.provider} returned HTTP ${response.status}: ${bodyText || response.statusText}`,
        { status: response.status, retryable, provider: options.provider },
      );
      if (retryable && attempt < retries) {
        await sleep(retryDelayMs(response, attempt), options.signal);
        continue;
      }
      throw lastError;
    } catch (error) {
      if (error instanceof LlmError) throw error;
      if (options.signal?.aborted) {
        throw new LlmError("Model request was cancelled.", { provider: options.provider, cause: error });
      }
      lastError = error;
      if (attempt < retries) {
        await sleep(retryDelayMs(response, attempt), options.signal);
        continue;
      }
      throw new LlmError(`Invalid response from ${options.provider}: ${(error as Error).message}`, {
        provider: options.provider,
        retryable: true,
        cause: error,
      });
    } finally {
      cleanup();
    }
  }

  throw new LlmError(`Model request failed: ${(lastError as Error)?.message ?? "unknown error"}`, {
    provider: options.provider,
    cause: lastError,
  });
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}
