import type { SwarmConfig, Workspace } from "@swarm/core";
import type { Store } from "@swarm/core";
import type { SecretBox } from "@swarm/core";
import type { SwarmEngine } from "@swarm/core";
import type { WorkerHandle } from "@swarm/core";

export interface AppContext {
  config: SwarmConfig;
  store: Store;
  secrets: SecretBox;
  engine: SwarmEngine;
  worker: WorkerHandle | null;
  startedAt: number;
  defaultWorkspace: Workspace;
}
