import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SwarmDatabase } from "../src/db/database.js";
import { Store } from "../src/db/repository.js";
import { generateEncryptionKey } from "../src/security/crypto.js";
import { SecretBox } from "../src/security/secrets.js";

let database: SwarmDatabase;
let store: Store;

beforeEach(() => {
  database = new SwarmDatabase({ filename: ":memory:" });
  store = new Store(database);
});

afterEach(() => {
  database.close();
});

describe("workspaces and runs", () => {
  it("creates unique workspace slugs and updates settings", () => {
    const first = store.createWorkspace("Acme Studio");
    const second = store.createWorkspace("Acme Studio");
    expect(first.slug).toBe("acme-studio");
    expect(second.slug).toBe("acme-studio-2");
    expect(store.listWorkspaces()).toHaveLength(2);
    expect(store.getWorkspaceBySlug("acme-studio")?.id).toBe(first.id);

    const updated = store.updateWorkspace(first.id, {
      name: "Acme Labs",
      settings: { allowExternalHttpWrites: true },
    });
    expect(updated.name).toBe("Acme Labs");
    expect(store.getWorkspaceSettings(first.id)).toEqual({
      autoApproveReadOnlyMcp: false,
      allowExternalHttpWrites: true,
    });
  });

  it("creates, updates, lists and cancels runs", () => {
    const workspace = store.createWorkspace("Runs");
    const run = store.createRun(workspace.id, "Produce a market brief");
    expect(run.status).toBe("interpreting");
    expect(store.listRuns(workspace.id)).toHaveLength(1);

    store.setRunInterpretation(run.id, { title: "Brief" });
    store.setRunPlan(run.id, { agents: [] });
    store.updateRun(run.id, {
      title: "Market brief",
      summary: "Summary",
      status: "executing",
      startedAt: new Date().toISOString(),
    });
    expect(store.getRun(run.id)).toMatchObject({
      title: "Market brief",
      status: "executing",
      interpretation: { title: "Brief" },
      plan: { agents: [] },
    });

    store.incrementRunUsage(run.id, 2, 100, 0.0025);
    expect(store.getRunUsage(run.id)).toEqual({
      modelCalls: 2,
      totalTokens: 100,
      costUsd: 0.0025,
    });

    const cancelled = store.requestCancel(run.id);
    expect(cancelled.status).toBe("cancelled");
    expect(store.isCancelRequested(run.id)).toBe(true);
    expect(store.requestCancel(run.id).status).toBe("cancelled");
  });
});

describe("agents and tasks", () => {
  it("materialises tasks, resolves dependencies and exposes ready work", () => {
    const workspace = store.createWorkspace("Tasks");
    const run = store.createRun(workspace.id, "Do work");
    const [agent] = store.insertAgents(run.id, workspace.id, [
      {
        definitionKey: "market_researcher",
        domainPack: "business",
        name: "Market Researcher",
        role: "Research",
      },
    ]);
    expect(agent).toBeDefined();

    const [scan, strategy] = store.insertTasks(run.id, workspace.id, [
      {
        key: "market_scan",
        title: "Scan",
        description: "Scan",
        status: "pending",
        priority: 80,
        dependsOn: [],
        deliverable: "Brief",
        evaluationCriteria: ["Cited"],
        agentId: agent!.id,
        maxAttempts: 2,
      },
      {
        key: "strategy",
        title: "Strategy",
        description: "Strategy",
        status: "pending",
        priority: 70,
        dependsOn: ["market_scan"],
        deliverable: "Memo",
        evaluationCriteria: ["Explicit"],
        agentId: agent!.id,
        maxAttempts: 2,
      },
    ]);

    expect(store.listReadyTasks(run.id).map((task) => task.key)).toEqual(["market_scan"]);
    expect(store.dependenciesComplete(strategy!.id)).toBe(false);
    store.updateTaskStatus(scan!.id, "completed", { completedAt: new Date().toISOString() });
    expect(store.dependenciesComplete(strategy!.id)).toBe(true);
    expect(store.listReadyTasks(run.id).map((task) => task.key)).toEqual(["strategy"]);
    expect(store.getTaskByKey(run.id, "strategy")?.id).toBe(strategy!.id);
    expect(store.countTasksByStatus(run.id)).toEqual({ completed: 1, pending: 1 });

    store.setTaskOutput(strategy!.id, { summary: "done" }, null);
    expect(store.getTask(strategy!.id)?.output).toEqual({ summary: "done" });
    expect(store.incrementTaskAttempts(strategy!.id)).toBe(1);
    store.updateAgentStatus(agent!.id, "done");
    expect(store.getAgent(agent!.id)?.status).toBe("done");
  });
});

describe("approvals", () => {
  it("creates, lists and decides approvals", () => {
    const workspace = store.createWorkspace("Approvals");
    const run = store.createRun(workspace.id, "Do work");
    const approval = store.createApproval({
      runId: run.id,
      workspaceId: workspace.id,
      taskId: null,
      agentId: null,
      kind: "tool",
      title: "Approve http_request",
      summary: "External write",
      payload: { toolName: "http_request" },
    });
    expect(store.listPendingApprovals(workspace.id)).toHaveLength(1);
    expect(store.findPendingApprovalForTask(approval.taskId ?? "")).toBeNull();

    const decided = store.decideApproval(approval.id, "approved", "Looks good");
    expect(decided.status).toBe("approved");
    expect(decided.decisionReason).toBe("Looks good");
    expect(store.listPendingApprovals(workspace.id)).toHaveLength(0);
    expect(store.listApprovalsByWorkspace(workspace.id)).toHaveLength(1);
  });

  it("expires overdue approvals and cancels pending approvals for a run", () => {
    const workspace = store.createWorkspace("Expiry");
    const run = store.createRun(workspace.id, "Do work");
    const overdue = store.createApproval({
      runId: run.id,
      workspaceId: workspace.id,
      taskId: null,
      agentId: null,
      kind: "purchase",
      title: "Buy",
      summary: "Buy something",
      payload: {},
      expiresAt: "2000-01-01T00:00:00.000Z",
    });
    expect(store.listExpiredApprovals()).toHaveLength(1);
    expect(store.expireApprovals()).toBe(1);
    expect(store.getApproval(overdue.id)?.status).toBe("expired");

    const pending = store.createApproval({
      runId: run.id,
      workspaceId: workspace.id,
      taskId: null,
      agentId: null,
      kind: "tool",
      title: "Pending",
      summary: "Pending",
      payload: {},
    });
    expect(store.cancelPendingApprovalsForRun(run.id)).toBe(1);
    expect(store.getApproval(pending.id)?.status).toBe("cancelled");
  });
});

describe("artifacts, activities and memory", () => {
  it("stores artifact content and exposes run/workspace listings", () => {
    const workspace = store.createWorkspace("Artifacts");
    const run = store.createRun(workspace.id, "Do work");
    const artifact = store.createArtifact({
      runId: run.id,
      workspaceId: workspace.id,
      taskId: null,
      agentId: null,
      kind: "final",
      format: "markdown",
      title: "Final brief",
      filename: "final-brief.md",
      mimeType: "text/markdown; charset=utf-8",
      content: "# Brief\n\nHello",
    });
    expect(artifact.sizeBytes).toBe(Buffer.byteLength("# Brief\n\nHello", "utf8"));
    expect(store.getArtifactContent(artifact.id)).toContain("Hello");
    expect(store.listArtifactsByRun(run.id)).toHaveLength(1);
    expect(store.listArtifactsByWorkspace(workspace.id)).toHaveLength(1);
  });

  it("appends activities and ordered run events", () => {
    const workspace = store.createWorkspace("Events");
    const run = store.createRun(workspace.id, "Do work");
    store.appendActivity({
      runId: run.id,
      workspaceId: workspace.id,
      type: "run_created",
      level: "info",
      message: "Created",
    });
    expect(store.listActivities(run.id)).toHaveLength(1);
    expect(store.listWorkspaceActivities(workspace.id)).toHaveLength(1);

    const first = store.appendRunEvent(run.id, "run_created", { goal: "x" });
    const second = store.appendRunEvent(run.id, "task_started", { taskId: "t" });
    expect(second).toBeGreaterThan(first);
    expect(store.listRunEvents(run.id).map((event) => event.type)).toEqual([
      "run_created",
      "task_started",
    ]);
    expect(store.listRunEvents(run.id, first).map((event) => event.type)).toEqual(["task_started"]);
  });

  it("upserts and searches workspace memory", () => {
    const workspace = store.createWorkspace("Memory");
    const first = store.upsertMemory(workspace.id, "pricing", "Premium pricing strategy", ["business"]);
    const updated = store.upsertMemory(workspace.id, "pricing", "Updated pricing strategy", ["business"]);
    expect(updated.id).toBe(first.id);
    expect(store.getMemory(first.id)?.content).toBe("Updated pricing strategy");
    expect(store.listMemories(workspace.id)).toHaveLength(1);
    expect(store.searchMemories(workspace.id, "pricing strategy")).toHaveLength(1);
    expect(store.searchMemories(workspace.id, "unrelated")).toHaveLength(0);
  });
});

describe("secrets and integrations", () => {
  it("encrypts secrets at rest and decrypts integration credentials", () => {
    const workspace = store.createWorkspace("Secrets");
    const secrets = new SecretBox(store, generateEncryptionKey());
    const secretId = secrets.put(workspace.id, "github-token", "ghp_plaintext");
    expect(store.getSecret(secretId)?.ciphertext).not.toContain("plaintext");
    expect(secrets.get(secretId)).toBe("ghp_plaintext");
    expect(secrets.get(null)).toBeNull();

    const jsonId = secrets.putJson(workspace.id, "mcp-headers", { authorization: "Bearer x" });
    expect(secrets.getJson(jsonId)).toEqual({ authorization: "Bearer x" });

    store.createIntegration({
      workspaceId: workspace.id,
      provider: "github",
      name: "GitHub",
      config: { repo: "acme/repo" },
      secretId,
    });
    expect(secrets.integrationSecret(workspace.id, "github")).toBe("ghp_plaintext");
    expect(secrets.integrationConfig(workspace.id, "github")).toEqual({ repo: "acme/repo" });
    expect(secrets.integrationSecret(workspace.id, "missing")).toBeNull();
  });
});

describe("tool executions and model calls", () => {
  it("records tool executions and enforces idempotency keys", () => {
    const workspace = store.createWorkspace("Tools");
    const run = store.createRun(workspace.id, "Do work");
    const execution = store.createToolExecution({
      runId: run.id,
      taskId: null,
      agentId: null,
      toolName: "web_fetch",
      source: "native",
      status: "running",
      requiresApproval: false,
      approvalId: null,
      input: { url: "https://example.com" },
      idempotencyKey: "idem-1",
    });
    expect(store.getToolExecutionByIdempotencyKey("idem-1")?.id).toBe(execution.id);
    store.updateToolExecution(execution.id, {
      status: "succeeded",
      output: { status: 200 },
      completedAt: new Date().toISOString(),
      durationMs: 12,
    });
    expect(store.getToolExecution(execution.id)).toMatchObject({
      status: "succeeded",
      output: { status: 200 },
      durationMs: 12,
    });
    expect(store.listToolExecutions(run.id)).toHaveLength(1);
    expect(() =>
      store.createToolExecution({
        runId: run.id,
        taskId: null,
        agentId: null,
        toolName: "web_fetch",
        source: "native",
        status: "running",
        requiresApproval: false,
        approvalId: null,
        input: {},
        idempotencyKey: "idem-1",
      }),
    ).toThrow();
  });

  it("records model calls", () => {
    const workspace = store.createWorkspace("Models");
    const run = store.createRun(workspace.id, "Do work");
    store.createModelCall({
      runId: run.id,
      taskId: null,
      agentId: null,
      provider: "openai",
      model: "gpt-4.1-mini",
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
      costUsd: 0.0001,
      status: "succeeded",
      error: null,
      durationMs: 42,
    });
    const calls = store.listModelCalls(run.id);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ model: "gpt-4.1-mini", totalTokens: 15, durationMs: 42 });
  });
});

describe("leased job queue", () => {
  it("deduplicates jobs by idempotency key and leases work once", () => {
    const workspace = store.createWorkspace("Jobs");
    const run = store.createRun(workspace.id, "Do work");
    const first = store.enqueueJob({
      type: "interpret_goal",
      runId: run.id,
      idempotencyKey: "interpret:1",
    });
    const duplicate = store.enqueueJob({
      type: "interpret_goal",
      runId: run.id,
      idempotencyKey: "interpret:1",
    });
    expect(duplicate.id).toBe(first.id);

    const claimed = store.claimJob();
    expect(claimed?.id).toBe(first.id);
    expect(claimed?.status).toBe("leased");
    expect(claimed?.attempts).toBe(1);
    expect(store.claimJob()).toBeNull();
    store.completeJob(first.id);
    expect(store.getJob(first.id)?.status).toBe("done");
  });

  it("requeues retryable failures until attempts are exhausted", () => {
    const workspace = store.createWorkspace("Retries");
    const run = store.createRun(workspace.id, "Do work");
    const job = store.enqueueJob({
      type: "execute_task",
      runId: run.id,
      idempotencyKey: "execute:1",
      maxAttempts: 2,
    });
    expect(store.claimJob()?.attempts).toBe(1);
    store.failJob(job.id, "temporary", new Date().toISOString());
    expect(store.getJob(job.id)).toMatchObject({ status: "queued", attempts: 1, lastError: "temporary" });

    expect(store.claimJob()?.attempts).toBe(2);
    store.failJob(job.id, "final", new Date().toISOString());
    expect(store.getJob(job.id)).toMatchObject({ status: "failed", attempts: 2, lastError: "final" });
  });

  it("recovers expired leases and cancels queued jobs for a run", () => {
    const workspace = store.createWorkspace("Leases");
    const run = store.createRun(workspace.id, "Do work");
    const job = store.enqueueJob({
      type: "execute_task",
      runId: run.id,
      idempotencyKey: "execute:lease",
      availableAt: "2020-01-01T00:00:00.000Z",
    });
    expect(store.claimJob("2020-01-01T00:00:01.000Z", 1000)?.id).toBe(job.id);
    expect(store.recoverExpiredLeases("2020-01-01T00:00:05.000Z")).toBe(1);
    expect(store.getJob(job.id)?.status).toBe("queued");

    const queued = store.enqueueJob({
      type: "review_run",
      runId: run.id,
      idempotencyKey: "review:1",
    });
    expect(store.cancelQueuedJobsForRun(run.id)).toBeGreaterThanOrEqual(1);
    expect(store.getJob(queued.id)?.status).toBe("done");
  });
});
