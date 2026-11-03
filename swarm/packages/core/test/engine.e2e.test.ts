import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SwarmDatabase } from "../src/db/database.js";
import { Store } from "../src/db/repository.js";
import { SwarmEngine } from "../src/orchestrator/engine.js";
import { generateEncryptionKey } from "../src/security/crypto.js";
import { SecretBox } from "../src/security/secrets.js";
import {
  agentOutputFixture,
  completion,
  interpretationFixture,
  planFixture,
  reviewFixture,
  ScriptedProvider,
  testConfig,
  toolCompletion,
} from "./helpers.js";

let database: SwarmDatabase;
let store: Store;
let engine: SwarmEngine | null = null;

beforeEach(() => {
  database = new SwarmDatabase({ filename: ":memory:" });
  store = new Store(database);
});

afterEach(async () => {
  await engine?.dispose();
  engine = null;
  database.close();
});

function buildEngine(provider: ScriptedProvider, env: NodeJS.ProcessEnv = {}): SwarmEngine {
  engine = new SwarmEngine({
    config: testConfig(env),
    store,
    secrets: new SecretBox(store, generateEncryptionKey()),
    provider,
  });
  return engine;
}

describe("end-to-end orchestration", () => {
  it("runs interpret, plan, execute, review and finalize to completion", async () => {
    const provider = new ScriptedProvider({
      interpretation: interpretationFixture,
      plan: planFixture,
      agent: [completion(JSON.stringify(agentOutputFixture))],
      review: reviewFixture,
      final: "# Final market brief\n\nIntegrated recommendations.",
    });
    const app = buildEngine(provider);
    const workspace = store.createWorkspace("E2E");
    const run = app.createRun(workspace.id, "Create an evidence-based market entry brief");

    const processed = await app.runUntilIdle();
    expect(processed).toBe(4);

    const finished = store.getRun(run.id);
    expect(finished?.status).toBe("completed");
    expect(finished?.error).toBeNull();
    expect(finished?.completedAt).not.toBeNull();

    const tasks = store.listTasks(run.id);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ status: "completed", key: "market_scan" });
    expect(tasks[0]?.artifactId).toBeTruthy();

    const agents = store.listAgents(run.id);
    expect(agents).toHaveLength(1);
    expect(agents[0]?.status).toBe("done");

    const artifacts = store.listArtifactsByRun(run.id);
    expect(artifacts.map((artifact) => artifact.kind).sort()).toEqual([
      "deliverable",
      "final",
      "review",
    ]);
    const final = artifacts.find((artifact) => artifact.kind === "final");
    expect(store.getArtifactContent(final!.id)).toContain("Integrated recommendations");

    expect(store.listMemories(workspace.id)).toHaveLength(1);
    expect(store.listModelCalls(run.id)).toHaveLength(5);
    expect(store.getRunUsage(run.id)).toMatchObject({ modelCalls: 5, totalTokens: 75 });
    expect(store.listRunEvents(run.id).some((event) => event.type === "run_completed")).toBe(true);
    expect(provider.requests).toHaveLength(5);
  });

  it("suspends on an approval-gated action and resumes after denial", async () => {
    const provider = new ScriptedProvider({
      interpretation: { ...interpretationFixture, requiresExternalActions: true },
      plan: planFixture,
      agent: [
        toolCompletion({
          id: "call_http_1",
          name: "http_request",
          arguments: {
            method: "POST",
            url: "https://example.com/hook",
            body: { message: "hello" },
          },
          rawArguments: JSON.stringify({
            method: "POST",
            url: "https://example.com/hook",
            body: { message: "hello" },
          }),
        }),
        completion(JSON.stringify(agentOutputFixture)),
      ],
      review: reviewFixture,
      final: "# Final\n\nThe external action was not performed.",
    });
    const app = buildEngine(provider);
    const workspace = store.createWorkspace("Approvals E2E");
    store.updateWorkspace(workspace.id, { settings: { allowExternalHttpWrites: true } });
    const run = app.createRun(workspace.id, "Create a market brief and notify the team");

    expect(await app.runUntilIdle()).toBe(2);
    expect(store.getRun(run.id)?.status).toBe("awaiting_approval");
    const pending = store.listPendingApprovals(workspace.id);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ kind: "tool", status: "pending" });
    expect(store.listTasks(run.id)[0]?.status).toBe("awaiting_approval");
    expect(store.listToolExecutions(run.id)[0]?.status).toBe("awaiting_approval");

    app.decideApproval(pending[0]!.id, "denied", "No external call needed");
    expect(await app.runUntilIdle()).toBe(3);

    expect(store.getRun(run.id)?.status).toBe("completed");
    expect(store.getApproval(pending[0]!.id)?.status).toBe("denied");
    expect(store.listToolExecutions(run.id)[0]?.status).toBe("denied");
    expect(store.listTasks(run.id)[0]?.status).toBe("completed");
    expect(store.listArtifactsByRun(run.id).some((artifact) => artifact.kind === "final")).toBe(
      true,
    );
    expect(provider.requests).toHaveLength(6);
  });

  it("cancels a run and stops scheduling work", async () => {
    const provider = new ScriptedProvider({
      interpretation: interpretationFixture,
      plan: planFixture,
      agent: [completion(JSON.stringify(agentOutputFixture))],
      review: reviewFixture,
      final: "# Final",
    });
    const app = buildEngine(provider);
    const workspace = store.createWorkspace("Cancel");
    const run = app.createRun(workspace.id, "Create a market entry brief");
    app.cancelRun(run.id);

    expect(store.getRun(run.id)?.status).toBe("cancelled");
    expect(store.isCancelRequested(run.id)).toBe(true);
    expect(await app.runUntilIdle()).toBe(0);
    expect(store.listJobsForRun(run.id).every((job) => job.status === "done")).toBe(true);
  });

  it("fails the run when the model cannot produce a valid deliverable", async () => {
    const provider = new ScriptedProvider({
      interpretation: interpretationFixture,
      plan: planFixture,
      agent: [completion("not json"), completion("still not json"), completion("no")],
      review: reviewFixture,
      final: "# Final",
    });
    const app = buildEngine(provider, { SWARM_TASK_MAX_ATTEMPTS: "1" });
    const workspace = store.createWorkspace("Failure");
    const run = app.createRun(workspace.id, "Create a market entry brief");

    await app.runUntilIdle();
    const failed = store.getRun(run.id);
    expect(failed?.status).toBe("failed");
    expect(failed?.error).toBeTruthy();
    expect(store.listTasks(run.id)[0]?.status).toBe("failed");
  });
});
