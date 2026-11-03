import type { JsonValue } from "../contracts/common.js";
import type { Store } from "../db/repository.js";
import type { SecretBox } from "../security/secrets.js";
import { slugify } from "../utils/id.js";
import { McpClient, McpError, type McpToolDescriptor } from "./client.js";
import { ToolError, type SwarmTool, type ToolResult } from "../tools/types.js";

export interface McpManagerOptions {
  allowStdio: boolean;
  timeoutMs?: number;
  idleMs?: number;
}

interface CachedClient {
  client: McpClient;
  lastUsed: number;
}

export class McpManager {
  private readonly clients = new Map<string, CachedClient>();
  private readonly allowStdio: boolean;
  private readonly timeoutMs: number;
  private readonly idleMs: number;

  constructor(
    private readonly store: Store,
    private readonly secrets: SecretBox,
    options: McpManagerOptions,
  ) {
    this.allowStdio = options.allowStdio;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.idleMs = options.idleMs ?? 5 * 60_000;
  }

  private async clientFor(serverId: string): Promise<McpClient> {
    const cached = this.clients.get(serverId);
    if (cached) {
      cached.lastUsed = Date.now();
      return cached.client;
    }
    const server = this.store.getMcpServer(serverId);
    if (!server) throw new McpError("MCP server not found.");
    if (server.transport === "stdio" && !this.allowStdio) {
      throw new McpError("Stdio MCP servers are disabled by server configuration.");
    }
    const headers = this.secrets.getJson(this.store.getMcpHeadersSecretId(serverId)) ?? {};
    const env = this.secrets.getJson(this.store.getMcpEnvSecretId(serverId)) ?? {};
    const client = new McpClient({
      transport: server.transport,
      url: server.url,
      headers,
      command: server.command,
      env,
      timeoutMs: this.timeoutMs,
    });
    this.clients.set(serverId, { client, lastUsed: Date.now() });
    return client;
  }

  async discover(serverId: string): Promise<McpToolDescriptor[]> {
    const server = this.store.getMcpServer(serverId);
    if (!server) throw new McpError("MCP server not found.");
    try {
      const client = await this.clientFor(serverId);
      const tools = await client.listTools();
      this.store.replaceMcpTools(
        serverId,
        tools.map((tool) => ({
          name: tool.name,
          description: tool.description || `MCP tool ${tool.name}`,
          inputSchema: tool.inputSchema,
          requiresApproval: !tool.readOnlyHint,
        })),
      );
      this.store.updateMcpServerStatus(serverId, "connected", null);
      return tools;
    } catch (error) {
      this.store.updateMcpServerStatus(serverId, "error", (error as Error).message.slice(0, 1000));
      await this.drop(serverId);
      throw error;
    }
  }

  async callTool(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<{ content: JsonValue; isError: boolean }> {
    try {
      const client = await this.clientFor(serverId);
      const result = await client.callTool(toolName, args, signal);
      this.store.updateMcpServerStatus(serverId, "connected", null);
      return result;
    } catch (error) {
      this.store.updateMcpServerStatus(serverId, "error", (error as Error).message.slice(0, 1000));
      await this.drop(serverId);
      throw error;
    }
  }

  async drop(serverId: string): Promise<void> {
    const cached = this.clients.get(serverId);
    if (!cached) return;
    this.clients.delete(serverId);
    await cached.client.close().catch(() => undefined);
  }

  async closeIdle(now = Date.now()): Promise<void> {
    for (const [serverId, cached] of [...this.clients.entries()]) {
      if (now - cached.lastUsed > this.idleMs) {
        this.clients.delete(serverId);
        await cached.client.close().catch(() => undefined);
      }
    }
  }

  async closeAll(): Promise<void> {
    const clients = [...this.clients.values()];
    this.clients.clear();
    await Promise.allSettled(clients.map((cached) => cached.client.close()));
  }
}

function toolNameFor(serverName: string, toolName: string): string {
  const base = `mcp_${slugify(serverName).replaceAll("-", "_")}_${toolName.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  return base.slice(0, 64);
}

export function createMcpTools(
  store: Store,
  manager: McpManager,
  workspaceId: string,
): SwarmTool[] {
  const servers = store.listMcpServers(workspaceId);
  const used = new Set<string>();
  const tools: SwarmTool[] = [];

  for (const server of servers) {
    for (const mcpTool of store.listMcpTools(server.id)) {
      let name = toolNameFor(server.name, mcpTool.name);
      if (used.has(name)) name = `${name.slice(0, 55)}_${mcpTool.id.slice(-6)}`;
      used.add(name);
      const schema =
        mcpTool.inputSchema && typeof mcpTool.inputSchema === "object" && !Array.isArray(mcpTool.inputSchema)
          ? (mcpTool.inputSchema as Record<string, unknown>)
          : { type: "object", properties: {} };
      tools.push({
        name,
        description: `[MCP: ${server.name}] ${mcpTool.description}`,
        inputSchema: schema,
        risk: "external",
        requiresApproval: mcpTool.requiresApproval,
        source: "mcp",
        readOnlyHint: !mcpTool.requiresApproval,
        isWrite: mcpTool.requiresApproval,
        async execute(input, context): Promise<ToolResult> {
          try {
            const result = await manager.callTool(server.id, mcpTool.name, input, context.signal);
            if (result.isError) {
              throw new ToolError(`MCP tool '${mcpTool.name}' returned an error.`, "mcp_tool_error");
            }
            return {
              content:
                typeof result.content === "string"
                  ? result.content
                  : JSON.stringify(result.content, null, 2),
              data: result.content,
            };
          } catch (error) {
            if (error instanceof ToolError) throw error;
            throw new ToolError((error as Error).message, "mcp_error");
          }
        },
      });
    }
  }

  return tools;
}
