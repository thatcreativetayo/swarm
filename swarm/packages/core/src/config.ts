import path from "node:path";

export type LlmProviderName = "openai" | "openrouter" | "anthropic" | "openai-compatible";

export interface LlmConfig {
  provider: LlmProviderName | null;
  apiKey: string | null;
  model: string | null;
  baseUrl: string | null;
}

export interface SwarmLimits {
  maxAgents: number;
  maxTasks: number;
  maxToolSteps: number;
  maxModelCalls: number;
  maxTokens: number;
  runTimeoutMs: number;
  modelTimeoutMs: number;
  toolTimeoutMs: number;
  taskMaxAttempts: number;
}

export interface SwarmConfig {
  port: number;
  host: string;
  dataDir: string;
  apiToken: string | null;
  encryptionKey: string | null;
  llm: LlmConfig;
  limits: SwarmLimits;
  telegraph: {
    nodeUrl: string;
    evmPrivateKey: string | null;
  };
  mcp: {
    allowStdio: boolean;
  };
  extensions: {
    enabled: boolean;
    dir: string;
  };
}

const DEFAULT_MODELS: Record<LlmProviderName, string> = {
  openai: "gpt-4.1-mini",
  openrouter: "openai/gpt-4.1-mini",
  anthropic: "claude-sonnet-4-5",
  "openai-compatible": "local-model",
};

const DEFAULT_BASE_URLS: Record<LlmProviderName, string> = {
  openai: "https://api.openai.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
  anthropic: "https://api.anthropic.com",
  "openai-compatible": "http://127.0.0.1:11434/v1",
};

function intFromEnv(value: string | undefined, fallback: number, min: number, max: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function normalizeProvider(value: string | undefined): LlmProviderName | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "openai" ||
    normalized === "openrouter" ||
    normalized === "anthropic" ||
    normalized === "openai-compatible"
  ) {
    return normalized;
  }
  throw new Error(
    `Unsupported SWARM_LLM_PROVIDER '${value}'. Use openai, openrouter, anthropic, or openai-compatible.`,
  );
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): SwarmConfig {
  const provider = normalizeProvider(env.SWARM_LLM_PROVIDER);
  const model = env.SWARM_LLM_MODEL?.trim() || (provider ? DEFAULT_MODELS[provider] : null);
  const baseUrl = env.SWARM_LLM_BASE_URL?.trim() || (provider ? DEFAULT_BASE_URLS[provider] : null);

  return {
    port: intFromEnv(env.SWARM_PORT, 8787, 1, 65535),
    host: env.SWARM_HOST?.trim() || "127.0.0.1",
    dataDir: path.resolve(env.SWARM_DATA_DIR?.trim() || "./data"),
    apiToken: env.SWARM_API_TOKEN?.trim() || null,
    encryptionKey: env.SWARM_ENCRYPTION_KEY?.trim() || null,
    llm: {
      provider,
      apiKey: env.SWARM_LLM_API_KEY?.trim() || null,
      model,
      baseUrl,
    },
    limits: {
      maxAgents: intFromEnv(env.SWARM_MAX_AGENTS, 8, 1, 12),
      maxTasks: intFromEnv(env.SWARM_MAX_TASKS, 12, 1, 24),
      maxToolSteps: intFromEnv(env.SWARM_MAX_TOOL_STEPS, 6, 1, 12),
      maxModelCalls: intFromEnv(env.SWARM_MAX_MODEL_CALLS, 40, 1, 200),
      maxTokens: intFromEnv(env.SWARM_MAX_TOKENS, 120_000, 10_000, 2_000_000),
      runTimeoutMs: intFromEnv(env.SWARM_RUN_TIMEOUT_MS, 1_800_000, 60_000, 24 * 60 * 60 * 1000),
      modelTimeoutMs: intFromEnv(env.SWARM_MODEL_TIMEOUT_MS, 120_000, 10_000, 600_000),
      toolTimeoutMs: intFromEnv(env.SWARM_TOOL_TIMEOUT_MS, 60_000, 5_000, 300_000),
      taskMaxAttempts: intFromEnv(env.SWARM_TASK_MAX_ATTEMPTS, 2, 1, 5),
    },
    telegraph: {
      nodeUrl: env.TELEGRAPH_NODE_URL?.trim() || "https://devnode.telegraphprotocol.com",
      evmPrivateKey: env.TELEGRAPH_EVM_PRIVATE_KEY?.trim() || null,
    },
    mcp: {
      allowStdio: env.SWARM_ALLOW_STDIO_MCP !== "false",
    },
    extensions: {
      enabled: env.SWARM_ENABLE_EXTERNAL_EXTENSIONS === "true",
      dir: path.resolve(env.SWARM_EXTENSION_DIR?.trim() || "./data/extensions"),
    },
  };
}

export function isLlmConfigured(config: SwarmConfig): boolean {
  return Boolean(config.llm.provider && config.llm.model && (config.llm.apiKey || config.llm.provider === "openai-compatible"));
}

export function publicConfig(config: SwarmConfig): Record<string, unknown> {
  return {
    llm: {
      configured: isLlmConfigured(config),
      provider: config.llm.provider,
      model: config.llm.model,
      baseUrl: config.llm.provider === "openai-compatible" ? config.llm.baseUrl : undefined,
    },
    limits: config.limits,
    telegraph: {
      nodeUrl: config.telegraph.nodeUrl,
      paymentsConfigured: Boolean(config.telegraph.evmPrivateKey),
    },
    mcp: {
      allowStdio: config.mcp.allowStdio,
    },
    extensions: {
      enabled: config.extensions.enabled,
    },
    auth: {
      tokenRequired: Boolean(config.apiToken),
    },
  };
}
