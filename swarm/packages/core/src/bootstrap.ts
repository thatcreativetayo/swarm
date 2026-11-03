import path from "node:path";
import { loadConfig, type SwarmConfig } from "./config.js";
import { SwarmDatabase } from "./db/database.js";
import { Store } from "./db/repository.js";
import { SwarmEngine } from "./orchestrator/engine.js";
import { createLlmProvider } from "./providers/factory.js";
import { ensureEncryptionKey, SecretBox } from "./security/secrets.js";
import type { Workspace } from "./contracts/common.js";

export interface SwarmRuntime {
  config: SwarmConfig;
  database: SwarmDatabase;
  store: Store;
  secrets: SecretBox;
  engine: SwarmEngine;
  defaultWorkspace: Workspace;
  close: () => Promise<void>;
}

export interface CreateRuntimeOptions {
  config?: SwarmConfig;
  env?: NodeJS.ProcessEnv;
  databaseFilename?: string;
}

const DEFAULT_WORKSPACE_NAME = "SWARM HQ";

/**
 * Builds the complete server-side runtime: SQLite, encrypted secret box, model
 * provider, orchestration engine, and a default workspace. Shared by the API
 * and the standalone worker so both processes use identical wiring.
 */
export function createRuntime(options: CreateRuntimeOptions = {}): SwarmRuntime {
  const config = options.config ?? loadConfig(options.env ?? process.env);
  const databaseFilename =
    options.databaseFilename ?? path.join(config.dataDir, "swarm.db");
  const database = new SwarmDatabase({ filename: databaseFilename });
  const store = new Store(database);
  const key = ensureEncryptionKey(config.encryptionKey, config.dataDir);
  const secrets = new SecretBox(store, key);
  const provider = createLlmProvider(config);
  const engine = new SwarmEngine({ config, store, secrets, provider });
  const defaultWorkspace = ensureDefaultWorkspace(store);

  return {
    config,
    database,
    store,
    secrets,
    engine,
    defaultWorkspace,
    close: async () => {
      await engine.dispose();
      database.close();
    },
  };
}

export function ensureDefaultWorkspace(store: Store): Workspace {
  const existing = store.listWorkspaces();
  if (existing.length > 0) return existing[0]!;
  return store.createWorkspace(DEFAULT_WORKSPACE_NAME);
}
