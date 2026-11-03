import type { JsonValue, ToolRisk } from "../contracts/common.js";
import type { SwarmConfig } from "../config.js";
import type { Store } from "../db/repository.js";
import type { JsonSchema, LlmToolDefinition } from "../providers/types.js";

export interface ToolContext {
  store: Store;
  config: SwarmConfig;
  workspaceId: string;
  runId: string;
  taskId: string;
  agentId: string;
  domainPack: string;
  signal?: AbortSignal;
  idempotencyKey?: string;
  /** Returns the decrypted secret for a workspace integration, if configured. */
  getIntegrationSecret: (provider: string) => string | null;
  getIntegrationConfig: (provider: string) => Record<string, unknown> | null;
}

export interface ToolResult {
  content: string;
  data?: JsonValue;
}

export interface SwarmTool {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  risk: ToolRisk;
  requiresApproval: boolean;
  source: "native" | "mcp" | "extension";
  readOnlyHint?: boolean;
  isWrite?: boolean;
  execute: (input: Record<string, unknown>, context: ToolContext) => Promise<ToolResult>;
}

export class ToolError extends Error {
  readonly code: string;
  constructor(message: string, code = "tool_error") {
    super(message);
    this.name = "ToolError";
    this.code = code;
  }
}

export class ToolRegistry {
  private readonly tools = new Map<string, SwarmTool>();

  register(tool: SwarmTool): void {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(tool.name)) {
      throw new Error(`Invalid tool name: ${tool.name}`);
    }
    if (this.tools.has(tool.name)) throw new Error(`Duplicate tool name: ${tool.name}`);
    this.tools.set(tool.name, tool);
  }

  get(name: string): SwarmTool | undefined {
    return this.tools.get(name);
  }

  list(): SwarmTool[] {
    return [...this.tools.values()];
  }

  filter(allowedNames: readonly string[] | null): SwarmTool[] {
    if (!allowedNames) return this.list();
    const allowed = new Set(allowedNames);
    return this.list().filter((tool) => allowed.has(tool.name));
  }

  toLlmTools(allowedNames: readonly string[] | null = null): LlmToolDefinition[] {
    return this.filter(allowedNames).map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));
  }
}
