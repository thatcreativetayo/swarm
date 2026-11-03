import { assertSafeUrl, UnsafeUrlError } from "../security/ssrf.js";
import { ToolError, type SwarmTool, type ToolResult } from "./types.js";

const MAX_REDIRECTS = 4;
const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_TIMEOUT_MS = 60_000;

function timeoutSignal(timeoutMs: number, external?: AbortSignal): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new DOMException("Request timed out", "TimeoutError")),
    Math.min(MAX_TIMEOUT_MS, Math.max(1_000, timeoutMs)),
  );
  const signal = external ? AbortSignal.any([controller.signal, external]) : controller.signal;
  return { signal, cleanup: () => clearTimeout(timer) };
}

async function readLimited(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let output = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new ToolError(`Response exceeded the ${maxBytes} byte limit.`, "response_too_large");
      }
      output += decoder.decode(value, { stream: true });
    }
    output += decoder.decode();
    return output;
  } finally {
    reader.releaseLock();
  }
}

async function safeFetch(
  rawUrl: string,
  init: RequestInit,
  timeoutMs: number,
  external?: AbortSignal,
): Promise<{ response: Response; finalUrl: string; cleanup: () => void }> {
  let current = rawUrl;
  let method = init.method ?? "GET";
  let body = init.body;
  const { signal, cleanup } = timeoutSignal(timeoutMs, external);

  try {
    for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
      const url = await assertSafeUrl(current, { allowHttp: true });
      const response = await fetch(url, {
        ...init,
        method,
        body,
        redirect: "manual",
        signal,
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location) return { response, finalUrl: url.toString(), cleanup };
        if (redirect === MAX_REDIRECTS) throw new ToolError("Too many redirects.", "too_many_redirects");
        current = new URL(location, url).toString();
        if (response.status === 303 || ((response.status === 301 || response.status === 302) && method !== "GET" && method !== "HEAD")) {
          method = "GET";
          body = undefined;
        }
        continue;
      }
      return { response, finalUrl: url.toString(), cleanup };
    }
    throw new ToolError("Too many redirects.", "too_many_redirects");
  } catch (error) {
    cleanup();
    if (error instanceof ToolError) throw error;
    if (error instanceof UnsafeUrlError) throw new ToolError(error.message, "unsafe_url");
    if (external?.aborted) throw new ToolError("Request was cancelled.", "cancelled");
    throw new ToolError(`Request failed: ${(error as Error).message}`, "request_failed");
  }
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|li|h[1-6]|tr|table|ul|ol)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

const FORBIDDEN_HEADERS = new Set([
  "host",
  "content-length",
  "connection",
  "transfer-encoding",
  "upgrade",
  "proxy-authorization",
  "cookie",
]);

function sanitizeHeaders(input: unknown): Record<string, string> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value !== "string") continue;
    const normalized = key.trim().toLowerCase();
    if (!normalized || FORBIDDEN_HEADERS.has(normalized) || normalized.startsWith("x-forwarded-")) continue;
    headers[normalized] = value.slice(0, 2000);
  }
  return headers;
}

export function createWebTools(): SwarmTool[] {
  return [
    {
      name: "web_fetch",
      description:
        "Fetch a public web page or document and return readable text. Use for research, verifying claims, and reading public sources. Private/internal addresses are blocked. Cite the URL in your output.",
      risk: "read",
      requiresApproval: false,
      source: "native",
      readOnlyHint: true,
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["url"],
        properties: {
          url: { type: "string", format: "uri", maxLength: 2048 },
          maxChars: { type: "integer", minimum: 500, maximum: 50_000 },
        },
      },
      async execute(input, context): Promise<ToolResult> {
        const url = typeof input.url === "string" ? input.url.trim() : "";
        if (!url) throw new ToolError("web_fetch requires a URL.", "invalid_input");
        const maxChars = typeof input.maxChars === "number" ? Math.min(50_000, Math.max(500, Math.trunc(input.maxChars))) : 12_000;
        const { response, finalUrl, cleanup } = await safeFetch(
          url,
          {
            headers: {
              accept: "text/html,application/xhtml+xml,application/json,text/plain,text/markdown;q=0.9,*/*;q=0.5",
              "user-agent": "SWARM/0.1 (+https://github.com/swarm-workforce/swarm)",
            },
          },
          20_000,
          context.signal,
        );
        try {
          if (!response.ok) {
            throw new ToolError(`Fetch returned HTTP ${response.status} ${response.statusText}.`, "http_error");
          }
          const contentType = response.headers.get("content-type") ?? "application/octet-stream";
          const allowed = /^(text\/|application\/(json|xml|xhtml\+xml|ld\+json)|image\/svg\+xml)/i.test(contentType);
          if (!allowed) {
            throw new ToolError(`Unsupported content type: ${contentType}.`, "unsupported_content_type");
          }
          const raw = await readLimited(response, 500_000);
          const text = /html/i.test(contentType) ? htmlToText(raw) : raw;
          const truncated = text.length > maxChars;
          const body = truncated ? `${text.slice(0, maxChars)}\n\n[truncated at ${maxChars} characters]` : text;
          return {
            content: `URL: ${finalUrl}\nContent-Type: ${contentType}\n\n${body}`,
            data: { url: finalUrl, contentType, truncated, characters: text.length },
          };
        } finally {
          cleanup();
        }
      },
    },
    {
      name: "http_request",
      description:
        "Make an HTTP request to a public API. GET and HEAD are read-only. POST, PUT, PATCH, and DELETE are external writes and require explicit user approval. Private/internal addresses are blocked. Never include secrets in the body.",
      risk: "external",
      requiresApproval: false,
      source: "native",
      isWrite: true,
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["method", "url"],
        properties: {
          method: { type: "string", enum: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"] },
          url: { type: "string", format: "uri", maxLength: 2048 },
          headers: { type: "object", additionalProperties: { type: "string" } },
          body: {},
          timeoutMs: { type: "integer", minimum: 1000, maximum: 60_000 },
        },
      },
      async execute(input, context): Promise<ToolResult> {
        const method = typeof input.method === "string" ? input.method.toUpperCase() : "";
        const url = typeof input.url === "string" ? input.url.trim() : "";
        if (!url) throw new ToolError("http_request requires a URL.", "invalid_input");
        if (!["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"].includes(method)) {
          throw new ToolError("Unsupported HTTP method.", "invalid_input");
        }
        const headers = sanitizeHeaders(input.headers);
        let body: string | undefined;
        if (method !== "GET" && method !== "HEAD" && input.body !== undefined) {
          body = typeof input.body === "string" ? input.body : JSON.stringify(input.body);
          if (!headers["content-type"]) headers["content-type"] = "application/json";
        }
        const timeoutMs = typeof input.timeoutMs === "number" ? input.timeoutMs : DEFAULT_TIMEOUT_MS;
        const { response, finalUrl, cleanup } = await safeFetch(
          url,
          {
            method,
            headers: { "user-agent": "SWARM/0.1", accept: "application/json, text/plain, */*", ...headers },
            body,
          },
          timeoutMs,
          context.signal,
        );
        try {
          const contentType = response.headers.get("content-type") ?? "";
          const raw = method === "HEAD" ? "" : await readLimited(response, 1_000_000);
          const text = /html/i.test(contentType) ? htmlToText(raw) : raw;
          const truncated = text.length > 50_000;
          const responseBody = truncated ? `${text.slice(0, 50_000)}\n\n[truncated]` : text;
          const responseHeaders = Object.fromEntries(
            [...response.headers.entries()].filter(([key]) => !["set-cookie", "authorization"].includes(key)),
          );
          const summary = `HTTP ${response.status} ${response.statusText}\nURL: ${finalUrl}\nContent-Type: ${contentType || "unknown"}\n\n${responseBody}`;
          return {
            content: summary,
            data: {
              status: response.status,
              url: finalUrl,
              contentType,
              headers: responseHeaders,
              truncated,
            },
          };
        } finally {
          cleanup();
        }
      },
    },
  ];
}
