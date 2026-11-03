import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRuntime, defaultEnvCandidates, loadEnvFiles, logger } from "@swarm/core";

const here = path.dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  const envFiles = loadEnvFiles([
    ...defaultEnvCandidates(),
    path.resolve(here, "../../../.env"),
  ]);
  const runtime = createRuntime();
  const pollMs = Math.min(
    10_000,
    Math.max(250, Number.parseInt(process.env.SWARM_WORKER_POLL_MS ?? "750", 10) || 750),
  );

  if (!runtime.engine.provider) {
    logger.warn("Worker started without a model provider. Jobs that need a model will fail until one is configured.");
  }

  const worker = runtime.engine.startWorker({ pollMs });
  const expiryTimer = setInterval(() => {
    void runtime.engine.expireApprovals().catch((error) =>
      logger.warn("approval expiry sweep failed", { error: (error as Error).message }),
    );
  }, 30_000);
  expiryTimer.unref();

  logger.info("SWARM worker started", {
    dataDir: runtime.config.dataDir,
    workspace: runtime.defaultWorkspace.name,
    pollMs,
    envFiles,
  });

  let stopping = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    logger.info("SWARM worker stopping", { signal });
    worker.stop();
    clearInterval(expiryTimer);
    await runtime.close().catch((error) =>
      logger.error("worker runtime close failed", { error: (error as Error).message }),
    );
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error) => {
  console.error("[swarm] worker failed to start", error);
  process.exit(1);
});
