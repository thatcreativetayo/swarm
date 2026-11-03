import crypto from "node:crypto";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import {
  ApprovalDecisionInputSchema,
  ConfigurationError,
  CreateIntegrationInputSchema,
  CreateMcpServerInputSchema,
  CreateRunInputSchema,
  CreateWorkspaceInputSchema,
  DOMAIN_PACKS,
  UpdateWorkspaceSettingsInputSchema,
  createNativeToolRegistry,
  publicConfig,
} from "@swarm/core";
import type { AppContext } from "./context.js";
import {
  ApiError,
  errorResponse,
  readBody,
  requireRun,
  requireWorkspace,
  runDetail,
  snapshotFor,
  workspaceStats,
} from "./http.js";
import { resolveStatic } from "./static.js";

export interface AppOptions {
  webDist: string | null;
}

const MemoryInputSchema = z.object({
  key: z.string().trim().min(1).max(160),
  content: z.string().trim().min(1).max(20_000),
  tags: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
});

function domainPackSummary() {
  return DOMAIN_PACKS.map((pack) => ({
    key: pack.key,
    name: pack.name,
    description: pack.description,
    keywords: pack.keywords,
    agentCount: pack.agents.length,
    taskCount: pack.taskTemplates.length,
    agents: pack.agents.map((agent) => ({
      key: agent.key,
      name: agent.name,
      role: agent.role,
      responsibilities: agent.responsibilities,
      capabilities: agent.capabilities,
      allowedTools: agent.allowedTools,
      defaultModel: agent.defaultModel ?? null,
      maxSteps: agent.maxSteps,
    })),
    workflows: pack.workflows.map((workflow) => ({
      key: workflow.key,
      name: workflow.name,
      description: workflow.description,
      taskKeys: workflow.taskKeys,
    })),
    evaluationRules: pack.evaluationRules,
  }));
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function createApp(ctx: AppContext, options: AppOptions): Hono {
  const app = new Hono();

  app.use("*", async (c, next) => {
    c.header("x-content-type-options", "nosniff");
    c.header("x-frame-options", "DENY");
    c.header("referrer-policy", "no-referrer");
    await next();
  });

  if (ctx.config.apiToken) {
    app.use("/api/*", async (c, next) => {
      if (c.req.path === "/api/health") return next();
      const header = c.req.header("authorization") ?? "";
      const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
      if (!safeEqual(provided, ctx.config.apiToken!)) {
        return c.json({ error: "Unauthorized. Provide Authorization: Bearer <SWARM_API_TOKEN>." }, 401);
      }
      await next();
    });
  }

  app.use(
    "/api/*",
    bodyLimit({
      maxSize: 1_000_000,
      onError: (c) => c.json({ error: "Request body is too large." }, 413),
    }),
  );

  app.get("/api/health", (c) =>
    c.json({
      ok: true,
      name: "SWARM",
      version: "0.1.0",
      uptimeMs: Date.now() - ctx.startedAt,
      worker: Boolean(ctx.worker),
      llmConfigured: Boolean(ctx.config.llm.provider),
      time: new Date().toISOString(),
    }),
  );

  app.get("/api/settings", (c) =>
    c.json({
      version: "0.1.0",
      runtime: publicConfig(ctx.config),
      storage: "sqlite (node:sqlite, WAL)",
      worker: Boolean(ctx.worker),
      dataMode: "local-first",
    }),
  );

  app.get("/api/domain-packs", (c) => c.json({ packs: domainPackSummary() }));

  // -------------------------------------------------------------------------
  // Bootstrap + workspaces
  // -------------------------------------------------------------------------
  app.get("/api/bootstrap", (c) => {
    const requested = c.req.query("workspaceId");
    const workspace =
      (requested ? ctx.store.getWorkspace(requested) : null) ?? ctx.defaultWorkspace;
    return c.json({
      version: "0.1.0",
      workspace,
      workspaces: ctx.store.listWorkspaces(),
      config: publicConfig(ctx.config),
      domainPacks: domainPackSummary(),
      stats: workspaceStats(ctx, workspace.id),
    });
  });

  app.get("/api/workspaces", (c) => c.json({ workspaces: ctx.store.listWorkspaces() }));

  app.post("/api/workspaces", async (c) => {
    const input = await readBody(c, CreateWorkspaceInputSchema);
    const workspace = ctx.store.createWorkspace(input.name);
    return c.json({ workspace }, 201);
  });

  app.get("/api/workspaces/:workspaceId", (c) => {
    const workspace = requireWorkspace(ctx, c.req.param("workspaceId"));
    return c.json({
      workspace,
      settings: ctx.store.getWorkspaceSettings(workspace.id),
      stats: workspaceStats(ctx, workspace.id),
    });
  });

  app.get("/api/workspaces/:workspaceId/settings", (c) => {
    const workspace = requireWorkspace(ctx, c.req.param("workspaceId"));
    return c.json({ workspace, settings: ctx.store.getWorkspaceSettings(workspace.id) });
  });

  app.patch("/api/workspaces/:workspaceId/settings", async (c) => {
    const workspace = requireWorkspace(ctx, c.req.param("workspaceId"));
    const input = await readBody(c, UpdateWorkspaceSettingsInputSchema);
    const { name, ...settings } = input;
    const updated = ctx.store.updateWorkspace(workspace.id, {
      ...(name ? { name } : {}),
      settings,
    });
    return c.json({ workspace: updated, settings: ctx.store.getWorkspaceSettings(updated.id) });
  });

  // -------------------------------------------------------------------------
  // Runs
  // -------------------------------------------------------------------------
  app.get("/api/workspaces/:workspaceId/runs", (c) => {
    const workspace = requireWorkspace(ctx, c.req.param("workspaceId"));
    const limit = Math.min(200, Math.max(1, Number.parseInt(c.req.query("limit") ?? "50", 10) || 50));
    return c.json({ runs: ctx.store.listRuns(workspace.id, limit) });
  });

  app.post("/api/workspaces/:workspaceId/runs", async (c) => {
    const workspace = requireWorkspace(ctx, c.req.param("workspaceId"));
    const input = await readBody(c, CreateRunInputSchema);
    try {
      const run = ctx.engine.createRun(workspace.id, input.goal);
      return c.json({ run }, 201);
    } catch (error) {
      if (error instanceof ConfigurationError) throw new ApiError(409, error.message);
      throw error;
    }
  });

  app.get("/api/runs/:runId", (c) => {
    const run = requireRun(ctx, c.req.param("runId"));
    const detail = runDetail(ctx, run.id);
    if (!detail) throw new ApiError(404, "Run not found.");
    return c.json(detail);
  });

  app.post("/api/runs/:runId/cancel", (c) => {
    const run = requireRun(ctx, c.req.param("runId"));
    const cancelled = ctx.engine.cancelRun(run.id);
    return c.json({ run: cancelled });
  });

  app.get("/api/runs/:runId/events/poll", (c) => {
    const run = requireRun(ctx, c.req.param("runId"));
    const after = Math.max(0, Number.parseInt(c.req.query("after") ?? "0", 10) || 0);
    return c.json({
      events: ctx.store.listRunEvents(run.id, after, 500),
      snapshot: snapshotFor(ctx, run.id),
    });
  });

  app.get("/api/runs/:runId/events", (c) => {
    const run = requireRun(ctx, c.req.param("runId"));
    let after = Math.max(0, Number.parseInt(c.req.query("after") ?? "0", 10) || 0);

    return streamSSE(c, async (stream) => {
      let aborted = false;
      stream.onAbort(() => {
        aborted = true;
      });
      let lastSnapshot = "";
      while (!aborted) {
        const events = ctx.store.listRunEvents(run.id, after, 200);
        for (const event of events) {
          await stream.writeSSE({
            id: String(event.seq),
            event: event.type,
            data: JSON.stringify(event),
          });
          after = event.seq;
        }

        const snapshot = snapshotFor(ctx, run.id);
        if (!snapshot) {
          await stream.writeSSE({ event: "stream_end", data: "{}" });
          break;
        }
        const serialized = JSON.stringify(snapshot);
        if (serialized !== lastSnapshot) {
          await stream.writeSSE({ event: "snapshot", data: serialized });
          lastSnapshot = serialized;
        }
        const terminal = ["completed", "failed", "cancelled"].includes(snapshot.run.status);
        if (terminal && events.length === 0) {
          await stream.writeSSE({ event: "stream_end", data: "{}" });
          break;
        }
        await stream.sleep(700);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Approvals
  // -------------------------------------------------------------------------
  app.get("/api/workspaces/:workspaceId/approvals", (c) => {
    const workspace = requireWorkspace(ctx, c.req.param("workspaceId"));
    const status = c.req.query("status") ?? "pending";
    if (status === "pending") {
      return c.json({ approvals: ctx.store.listPendingApprovals(workspace.id) });
    }
    const approvals = ctx.store
      .listApprovalsByWorkspace(workspace.id, 200)
      .filter((approval) => status === "all" || approval.status === status);
    return c.json({ approvals });
  });

  app.post("/api/approvals/:approvalId/decide", async (c) => {
    const approvalId = c.req.param("approvalId");
    const approval = ctx.store.getApproval(approvalId);
    if (!approval) throw new ApiError(404, "Approval not found.");
    const input = await readBody(c, ApprovalDecisionInputSchema);
    try {
      const decided = ctx.engine.decideApproval(
        approval.id,
        input.decision,
        input.reason ?? null,
      );
      return c.json({ approval: decided });
    } catch (error) {
      throw new ApiError(409, (error as Error).message);
    }
  });

  // -------------------------------------------------------------------------
  // Artifacts
  // -------------------------------------------------------------------------
  app.get("/api/workspaces/:workspaceId/artifacts", (c) => {
    const workspace = requireWorkspace(ctx, c.req.param("workspaceId"));
    const limit = Math.min(500, Math.max(1, Number.parseInt(c.req.query("limit") ?? "100", 10) || 100));
    return c.json({ artifacts: ctx.store.listArtifactsByWorkspace(workspace.id, limit) });
  });

  app.get("/api/artifacts/:artifactId", (c) => {
    const artifact = ctx.store.getArtifact(c.req.param("artifactId"));
    if (!artifact) throw new ApiError(404, "Artifact not found.");
    return c.json({ artifact, content: ctx.store.getArtifactContent(artifact.id) ?? "" });
  });

  app.get("/api/artifacts/:artifactId/download", (c) => {
    const artifact = ctx.store.getArtifact(c.req.param("artifactId"));
    if (!artifact) throw new ApiError(404, "Artifact not found.");
    const content = ctx.store.getArtifactContent(artifact.id) ?? "";
    const filename = artifact.filename.replace(/[^a-zA-Z0-9._ -]/g, "_");
    return new Response(content, {
      headers: {
        "content-type": artifact.mimeType,
        "content-disposition": `attachment; filename="${filename}"`,
        "x-content-type-options": "nosniff",
        "cache-control": "no-store",
      },
    });
  });

  // -------------------------------------------------------------------------
  // Activity, workforce, tools, memories
  // -------------------------------------------------------------------------
  app.get("/api/workspaces/:workspaceId/activity", (c) => {
    const workspace = requireWorkspace(ctx, c.req.param("workspaceId"));
    const limit = Math.min(500, Math.max(1, Number.parseInt(c.req.query("limit") ?? "200", 10) || 200));
    return c.json({ activities: ctx.store.listWorkspaceActivities(workspace.id, limit) });
  });

  app.get("/api/workspaces/:workspaceId/workforce", (c) => {
    const workspace = requireWorkspace(ctx, c.req.param("workspaceId"));
    return c.json({
      agents: ctx.store.listAgentsByWorkspace(workspace.id, 500),
      packs: domainPackSummary(),
    });
  });

  app.get("/api/workspaces/:workspaceId/tasks", (c) => {
    const workspace = requireWorkspace(ctx, c.req.param("workspaceId"));
    const limit = Math.min(500, Math.max(1, Number.parseInt(c.req.query("limit") ?? "200", 10) || 200));
    return c.json({ tasks: ctx.store.listTasksByWorkspace(workspace.id, limit) });
  });

  app.get("/api/workspaces/:workspaceId/tools", (c) => {
    const workspace = requireWorkspace(ctx, c.req.param("workspaceId"));
    const native = createNativeToolRegistry().list().map((tool) => ({
      name: tool.name,
      description: tool.description,
      risk: tool.risk,
      requiresApproval: tool.requiresApproval,
      source: tool.source,
    }));
    const extensions = ctx.engine.extensions.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      risk: tool.risk,
      requiresApproval: tool.requiresApproval,
      source: tool.source,
    }));
    const mcp = ctx.store.listAllMcpTools(workspace.id).map((tool) => ({
      name: tool.name,
      description: tool.description,
      risk: "external",
      requiresApproval: tool.requiresApproval,
      source: "mcp" as const,
      serverId: tool.serverId,
    }));
    return c.json({ tools: [...native, ...extensions, ...mcp] });
  });

  app.get("/api/workspaces/:workspaceId/memories", (c) => {
    const workspace = requireWorkspace(ctx, c.req.param("workspaceId"));
    return c.json({ memories: ctx.store.listMemories(workspace.id, 200) });
  });

  app.post("/api/workspaces/:workspaceId/memories", async (c) => {
    const workspace = requireWorkspace(ctx, c.req.param("workspaceId"));
    const input = await readBody(c, MemoryInputSchema);
    const memory = ctx.store.upsertMemory(workspace.id, input.key, input.content, input.tags);
    return c.json({ memory }, 201);
  });

  // -------------------------------------------------------------------------
  // Integrations
  // -------------------------------------------------------------------------
  app.get("/api/workspaces/:workspaceId/integrations", (c) => {
    const workspace = requireWorkspace(ctx, c.req.param("workspaceId"));
    return c.json({ integrations: ctx.store.listIntegrations(workspace.id) });
  });

  app.post("/api/workspaces/:workspaceId/integrations", async (c) => {
    const workspace = requireWorkspace(ctx, c.req.param("workspaceId"));
    const input = await readBody(c, CreateIntegrationInputSchema);
    const secretId = input.secret
      ? ctx.secrets.put(workspace.id, `integration:${input.provider}:${input.name}`, input.secret)
      : null;
    try {
      ctx.store.createIntegration({
        workspaceId: workspace.id,
        provider: input.provider,
        name: input.name,
        config: input.config,
        secretId,
      });
    } catch (error) {
      if (secretId) ctx.store.deleteSecret(secretId);
      throw new ApiError(409, `Could not save integration: ${(error as Error).message}`);
    }
    return c.json({ integrations: ctx.store.listIntegrations(workspace.id) }, 201);
  });

  app.delete("/api/workspaces/:workspaceId/integrations/:integrationId", (c) => {
    const workspace = requireWorkspace(ctx, c.req.param("workspaceId"));
    ctx.store.deleteIntegration(workspace.id, c.req.param("integrationId"));
    return c.json({ integrations: ctx.store.listIntegrations(workspace.id) });
  });

  // -------------------------------------------------------------------------
  // MCP servers
  // -------------------------------------------------------------------------
  app.get("/api/workspaces/:workspaceId/mcp", (c) => {
    const workspace = requireWorkspace(ctx, c.req.param("workspaceId"));
    const servers = ctx.store.listMcpServers(workspace.id).map((server) => ({
      ...server,
      tools: ctx.store.listMcpTools(server.id),
    }));
    return c.json({ servers });
  });

  app.post("/api/workspaces/:workspaceId/mcp", async (c) => {
    const workspace = requireWorkspace(ctx, c.req.param("workspaceId"));
    const input = await readBody(c, CreateMcpServerInputSchema);
    if (input.transport === "http") {
      if (!input.url) throw new ApiError(422, "HTTP MCP servers require a URL.");
      let url: URL;
      try {
        url = new URL(input.url);
      } catch {
        throw new ApiError(422, "MCP URL is not valid.");
      }
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new ApiError(422, "MCP URL must use http or https.");
      }
      if (url.username || url.password) {
        throw new ApiError(422, "MCP URLs must not embed credentials.");
      }
    } else {
      if (!ctx.config.mcp.allowStdio) {
        throw new ApiError(403, "Stdio MCP servers are disabled by SWARM_ALLOW_STDIO_MCP=false.");
      }
      if (!input.command || input.command.length === 0) {
        throw new ApiError(422, "Stdio MCP servers require a command.");
      }
    }

    const headersSecretId =
      input.headers && Object.keys(input.headers).length > 0
        ? ctx.secrets.putJson(workspace.id, `mcp:${input.name}:headers`, input.headers)
        : null;
    const envSecretId =
      input.env && Object.keys(input.env).length > 0
        ? ctx.secrets.putJson(workspace.id, `mcp:${input.name}:env`, input.env)
        : null;

    try {
      const server = ctx.store.createMcpServer({
        workspaceId: workspace.id,
        name: input.name,
        transport: input.transport,
        url: input.transport === "http" ? (input.url ?? null) : null,
        command: input.transport === "stdio" ? (input.command ?? null) : null,
        headersSecretId,
        envSecretId,
      });
      return c.json({ server, tools: [] }, 201);
    } catch (error) {
      if (headersSecretId) ctx.store.deleteSecret(headersSecretId);
      if (envSecretId) ctx.store.deleteSecret(envSecretId);
      throw new ApiError(409, `Could not save MCP server: ${(error as Error).message}`);
    }
  });

  app.post("/api/mcp/:serverId/connect", async (c) => {
    const server = ctx.store.getMcpServer(c.req.param("serverId"));
    if (!server) throw new ApiError(404, "MCP server not found.");
    try {
      const result = await ctx.engine.connectMcpServer(server.id);
      return c.json({
        server: ctx.store.getMcpServer(server.id),
        tools: ctx.store.listMcpTools(server.id),
        toolCount: result.tools,
      });
    } catch (error) {
      throw new ApiError(502, `MCP connection failed: ${(error as Error).message}`);
    }
  });

  app.delete("/api/workspaces/:workspaceId/mcp/:serverId", async (c) => {
    const workspace = requireWorkspace(ctx, c.req.param("workspaceId"));
    const server = ctx.store.getMcpServer(c.req.param("serverId"));
    if (!server || server.workspaceId !== workspace.id) throw new ApiError(404, "MCP server not found.");
    await ctx.engine.mcpManager.drop(server.id);
    ctx.store.deleteMcpServer(workspace.id, server.id);
    return c.json({ servers: ctx.store.listMcpServers(workspace.id) });
  });

  // -------------------------------------------------------------------------
  // Fallbacks
  // -------------------------------------------------------------------------
  app.all("/api/*", (c) => c.json({ error: "API route not found." }, 404));

  app.get("*", (c) => {
    const result = resolveStatic(options.webDist, new URL(c.req.url).pathname);
    if (result) {
      const body = typeof result.body === "string" ? result.body : new Uint8Array(result.body);
      return new Response(body, {
        status: result.status,
        headers: result.headers,
      });
    }
    if (!options.webDist) {
      return c.json({
        name: "SWARM API",
        message: "The web app has not been built yet. Run `pnpm build`, or use `pnpm dev:web` for the Vite dev server.",
        health: "/api/health",
      });
    }
    return c.text("Not found", 404);
  });

  app.onError((error, c) => {
    if (!(error instanceof ApiError) && !(error instanceof ConfigurationError)) {
      console.error("[swarm] api error", error);
    }
    if (error instanceof ConfigurationError) {
      return c.json({ error: error.message }, 409);
    }
    return errorResponse(c, error);
  });

  return app;
}
