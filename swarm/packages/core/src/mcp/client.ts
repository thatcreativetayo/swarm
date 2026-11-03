import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import readline from "node:readline";
import type { JsonValue } from "../contracts/common.js";

export interface McpToolDescriptor {
  name: string;
  description: string;
  inputSchema: JsonValue;
  readOnlyHint: boolean;
  destructiveHint: boolean;
}

export interface McpCallResult {
  content: JsonValue;
  isError: boolean;
}

export class McpError extends Error {
  readonly code: number | null;
  constructor(message: string, code: number | null = null) {
    super(message);
    this.name = "McpError";
    this.code = code;
  }
}

interface JsonRpcResponse {
  jsonrpc?: string;
  id?: number | string | null;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

const PROTOCOL_VERSION = "2025-06-18";

abstract class McpTransport {
  abstract request(method: string, params: unknown, signal?: AbortSignal): Promise<unknown>;
  abstract notify(method: string, params: unknown): Promise<void>;
  abstract close(): Promise<void>;
}

class HttpTransport extends McpTransport {
  private nextId = 1;
  private sessionId: string | null = null;
  private readonly url: string;
  private readonly headers: Record<string, string>;
  private readonly timeoutMs: number;

  constructor(url: string, headers: Record<string, string>, timeoutMs: number) {
    super();
    this.url = url;
    this.headers = headers;
    this.timeoutMs = timeoutMs;
  }

  private async post(payload: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const combined = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;
    try {
      return await fetch(this.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          ...(this.sessionId ? { "mcp-session-id": this.sessionId } : {}),
          ...this.headers,
        },
        body: JSON.stringify(payload),
        signal: combined,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async request(method: string, params: unknown, signal?: AbortSignal): Promise<unknown> {
    const id = this.nextId++;
    const response = await this.post({ jsonrpc: "2.0", id, method, params }, signal);
    const session = response.headers.get("mcp-session-id");
    if (session) this.sessionId = session;
    if (!response.ok) {
      const body = (await response.text()).slice(0, 1000);
      throw new McpError(`MCP HTTP ${response.status}: ${body || response.statusText}`, response.status);
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("text/event-stream")) {
      return parseSseResponse(await response.text(), id);
    }
    const body = (await response.json()) as JsonRpcResponse;
    return unwrapRpc(body, id);
  }

  async notify(method: string, params: unknown): Promise<void> {
    const response = await this.post({ jsonrpc: "2.0", method, params });
    if (!response.ok && response.status !== 202) {
      const body = (await response.text()).slice(0, 500);
      throw new McpError(`MCP notification failed: HTTP ${response.status} ${body}`, response.status);
    }
  }

  async close(): Promise<void> {
    // Streamable HTTP sessions are closed by the server; no client-side teardown is required.
  }
}

function parseSseResponse(text: string, id: number): unknown {
  const events = text.split(/\r?\n\r?\n/);
  for (const event of events) {
    const data = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data) continue;
    try {
      const parsed = JSON.parse(data) as JsonRpcResponse;
      if (parsed.id === id || parsed.id === String(id)) return unwrapRpc(parsed, id);
    } catch {
      // Ignore non-JSON SSE events such as heartbeats.
    }
  }
  throw new McpError("MCP stream ended without a matching response.");
}

function unwrapRpc(response: JsonRpcResponse, id: number): unknown {
  if (response.error) {
    throw new McpError(response.error.message ?? "MCP request failed.", response.error.code ?? null);
  }
  if (response.id !== id && response.id !== String(id)) {
    throw new McpError("MCP response id did not match the request.");
  }
  return response.result ?? null;
}

class StdioTransport extends McpTransport {
  private readonly command: string[];
  private readonly env: Record<string, string>;
  private process: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private stderr = "";
  private readonly timeoutMs: number;

  constructor(command: string[], env: Record<string, string>, timeoutMs: number) {
    super();
    this.command = command;
    this.env = env;
    this.timeoutMs = timeoutMs;
  }

  private start(): void {
    if (this.process) return;
    const [executable, ...args] = this.command;
    if (!executable) throw new McpError("MCP stdio command is empty.");
    const child = spawn(executable, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...this.env },
      windowsHide: true,
      shell: false,
    });
    this.process = child;

    const lines = readline.createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      if (!line.trim()) return;
      let message: JsonRpcResponse;
      try {
        message = JSON.parse(line) as JsonRpcResponse;
      } catch {
        return;
      }
      if (typeof message.id !== "number") return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      try {
        pending.resolve(unwrapRpc(message, message.id));
      } catch (error) {
        pending.reject(error as Error);
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      this.stderr = `${this.stderr}${chunk.toString("utf8")}`.slice(-8000);
    });
    child.on("error", (error) => this.failAll(new McpError(`MCP process error: ${error.message}`)));
    child.on("exit", (code) => {
      this.process = null;
      this.failAll(
        new McpError(`MCP process exited with code ${code ?? "unknown"}.${this.stderr ? ` stderr: ${this.stderr.slice(-1500)}` : ""}`),
      );
    });
  }

  private failAll(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
  }

  private send(payload: Record<string, unknown>): void {
    this.start();
    const child = this.process;
    if (!child?.stdin.writable) throw new McpError("MCP process is not writable.");
    child.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  async request(method: string, params: unknown, signal?: AbortSignal): Promise<unknown> {
    const id = this.nextId++;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new McpError(`MCP request '${method}' timed out after ${this.timeoutMs}ms.`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      if (signal) {
        const onAbort = () => {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(new McpError("MCP request was cancelled."));
        };
        signal.addEventListener("abort", onAbort, { once: true });
      }
      try {
        this.send({ jsonrpc: "2.0", id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error as Error);
      }
    });
  }

  async notify(method: string, params: unknown): Promise<void> {
    this.send({ jsonrpc: "2.0", method, params });
  }

  async close(): Promise<void> {
    const child = this.process;
    this.process = null;
    this.failAll(new McpError("MCP process closed."));
    if (child && !child.killed) {
      child.stdin.end();
      child.kill();
    }
  }
}

export interface McpClientOptions {
  transport: "http" | "stdio";
  url?: string | null;
  headers?: Record<string, string>;
  command?: string[] | null;
  env?: Record<string, string>;
  timeoutMs?: number;
}

export class McpClient {
  private transport: McpTransport;
  private connected = false;
  readonly timeoutMs: number;

  constructor(options: McpClientOptions) {
    this.timeoutMs = options.timeoutMs ?? 30_000;
    if (options.transport === "http") {
      if (!options.url) throw new McpError("MCP HTTP server requires a URL.");
      this.transport = new HttpTransport(options.url, options.headers ?? {}, this.timeoutMs);
    } else {
      if (!options.command || options.command.length === 0) {
        throw new McpError("MCP stdio server requires a command.");
      }
      this.transport = new StdioTransport(options.command, options.env ?? {}, this.timeoutMs);
    }
  }

  async connect(signal?: AbortSignal): Promise<void> {
    if (this.connected) return;
    const result = (await this.transport.request(
      "initialize",
      {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        clientInfo: { name: "swarm", version: "0.1.0" },
      },
      signal,
    )) as Record<string, unknown> | null;
    if (!result || typeof result !== "object") throw new McpError("MCP initialize returned no result.");
    await this.transport.notify("notifications/initialized", {});
    this.connected = true;
  }

  async listTools(signal?: AbortSignal): Promise<McpToolDescriptor[]> {
    await this.connect(signal);
    const tools: McpToolDescriptor[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 10; page += 1) {
      const result = (await this.transport.request(
        "tools/list",
        cursor ? { cursor } : {},
        signal,
      )) as Record<string, unknown> | null;
      const items = Array.isArray(result?.tools) ? result.tools : [];
      for (const value of items) {
        const tool = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
        const annotations =
          tool.annotations && typeof tool.annotations === "object"
            ? (tool.annotations as Record<string, unknown>)
            : {};
        tools.push({
          name: String(tool.name ?? ""),
          description: String(tool.description ?? ""),
          inputSchema: (tool.inputSchema ?? { type: "object" }) as JsonValue,
          readOnlyHint: annotations.readOnlyHint === true,
          destructiveHint: annotations.destructiveHint === true,
        });
      }
      const next = result?.nextCursor;
      if (typeof next !== "string" || !next) break;
      cursor = next;
    }
    return tools.filter((tool) => tool.name.length > 0);
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<McpCallResult> {
    await this.connect(signal);
    const result = (await this.transport.request(
      "tools/call",
      { name, arguments: args },
      signal,
    )) as Record<string, unknown> | null;
    const content = Array.isArray(result?.content) ? result.content : [];
    const text = content
      .map((value) => {
        const block = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
        if (block.type === "text") return String(block.text ?? "");
        if (block.type === "resource") return JSON.stringify(block.resource ?? {});
        return JSON.stringify(block);
      })
      .filter(Boolean)
      .join("\n");
    return {
      content: (result?.structuredContent ?? text) as JsonValue,
      isError: result?.isError === true,
    };
  }

  async close(): Promise<void> {
    await this.transport.close();
    this.connected = false;
  }
}
