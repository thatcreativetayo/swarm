import { createArtifactTools, createMemoryTools } from "./artifacts.js";
import { createGitHubTools } from "./github.js";
import { createTelegraphTools } from "./telegraph.js";
import { ToolRegistry } from "./types.js";
import { createWebTools } from "./web.js";

export * from "./types.js";
export * from "./artifacts.js";
export * from "./web.js";
export * from "./github.js";
export * from "./telegraph.js";

export function createNativeToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  for (const tool of [
    ...createArtifactTools(),
    ...createMemoryTools(),
    ...createWebTools(),
    ...createGitHubTools(),
    ...createTelegraphTools(),
  ]) {
    registry.register(tool);
  }
  return registry;
}
