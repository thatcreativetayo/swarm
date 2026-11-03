import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { createRuntime, defaultEnvCandidates, loadEnvFiles, logger } from "@swarm/core";
import { createApp } from "./app.js";
import type { AppContext } from "./context.js";
import { findWebDist } from "./static.js";

const here = path.dirname(fileURLToPath(import.meta.url));

function webDistCandidates(): string[] {
  return [
    process.env.SWARM_WEB_DIST ?? "",
    path.resolve(process.cwd(), "apps/web/dist"),
    path.resolve(process.cwd(), "../web/dist"),
    path.resolve(process.cwd(), "web/dist"),
    path.resolve(here, "../../web/dist"),
    path.resolve(here, "../../../web/dist"),
  ].filter(Boolean);
}

async function main(): Promise<void> {
  const envFiles = loadEnvFiles(defaultEnvCandidates());
  const runtime = createRuntime();
  const webDist = findWebDist(webDistCandidates());
  const inlineWorker = process.env.SWARM_INLINE_WORKER !== "false";

  const context: AppContext = {
    config: runtime.config,
    store: runtime.store,
    secrets: runtime.secrets,
    engine: runtime.engine,
    worker: inlineWorker ? runtime.engine.startWorker() : null,
    startedAt: Date.now(),
    defaultWorkspace: runtime.defaultWorkspace,
  };

  const app = createApp(context, { webDist });

  const server = serve(
    {
      fetch: app.fetch,
      hostname: runtime.config.host,
      port: runtime.config.port,
    },
    (info) => {
      const address = runtime.config.host === "0.0.0.0" ? "localhost" : runtime.config.host;
      logger.info("SWARM API listening", {
        url: `http://${address}:${info.port}`,
        dataDir: runtime.config.dataDir,
        web: webDist ?? "not built (API only)",
        worker: inlineWorker ? "inline" : "external",
        workspace: runtime.defaultWorkspace.name,
      });
      if (!runtime.engine.provider) {
        logger.warn(
          "No model provider configured. The UI will start in setup mode; set SWARM_LLM_PROVIDER, SWARM_LLM_MODEL, and SWARM_LLM_API_KEY to execute goals.",
        );
      }
      if (!runtime.config.apiToken) {
        logger.warn(
          `SWARM_API_TOKEN is not set. The API is unauthenticated; keep SWARM_HOST bound to ${runtime.config.host}.`,
        );
      }
    },
  );

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("Shutting down", { signal });
    const force = setTimeout(() => {
      logger.warn("Forcing shutdown after timeout.");
      process.exit(1);
    }, 15_000);
    force.unref();
    context.worker?.stop();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await runtime.close().catch((error) => logger.error("runtime close failed", { error: (error as Error).message }));
    clearTimeout(force);
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  logger.info("Environment loaded", { files: envFiles });
}

main().catch((error) => {
  console.error("[swarm] failed to start", error);
  process.exit(1);
});
