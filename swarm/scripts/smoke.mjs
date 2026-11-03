#!/usr/bin/env node
/**
 * SWARM end-to-end smoke test.
 *
 * Boots a mock OpenAI-compatible model server, starts the built API with an
 * isolated SQLite data directory, creates a run, and verifies that the
 * workforce completes it and produces a downloadable final artifact.
 *
 * Prerequisites: `pnpm build`
 * Run: `pnpm smoke`
 */
import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiEntry = path.join(root, "apps", "api", "dist", "server.mjs");
const token = "swarm-smoke-token";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

if (!fs.existsSync(apiEntry)) {
  console.error(`[smoke] Missing ${apiEntry}. Run "pnpm build" first.`);
  process.exit(1);
}

const interpretation = {
  title: "Market entry brief",
  objective: "Produce an evidence-based market entry brief for a new product.",
  domains: ["business"],
  deliverables: ["Market brief", "Recommended entry strategy"],
  constraints: ["Do not contact external parties"],
  risks: ["Market data may be incomplete"],
  complexity: "medium",
  requiresResearch: true,
  requiresExternalActions: false,
};

const plan = {
  agents: [
    {
      key: "business_market_researcher",
      definitionKey: "market_researcher",
      domainPack: "business",
      name: "Market Researcher",
      role: "Evidence-first market and competitor researcher",
      rationale: "The goal needs market evidence.",
    },
  ],
  tasks: [
    {
      key: "market_scan",
      title: "Market and competitor scan",
      description: "Research the market, competitors, and customer segments.",
      agentKey: "business_market_researcher",
      dependsOn: [],
      deliverable: "Market and competitor brief",
      evaluationCriteria: ["Sources are cited", "Assumptions are labelled"],
      priority: 80,
    },
  ],
  notes: ["Smoke test plan."],
};

const agentOutput = {
  summary: "Completed an evidence-based market scan.",
  findings: ["The target segment values speed and transparency."],
  deliverable: {
    title: "Market brief",
    format: "markdown",
    content:
      "# Market brief\n\n## Executive summary\n\nThe target segment values speed and transparency.\n\n## Recommendation\n\nEnter through a focused pilot.",
  },
  citations: [],
  confidence: 0.8,
  openQuestions: ["Validate pricing with primary interviews."],
  needsHumanReview: false,
};

const review = {
  verdict: "pass",
  summary: "The deliverable addresses the goal with clear assumptions.",
  criteria: [
    { criterion: "Completeness", result: "pass", note: "The requested brief and recommendation exist." },
  ],
  issues: [],
  recommendedActions: ["Validate the estimate with primary research."],
};

const finalMarkdown =
  "# Final market entry brief\n\n## Executive summary\n\nEnter through a focused pilot.\n\n## Risks\n\nMarket data is incomplete.\n\n## Next actions\n\n1. Interview five target customers.";

let modelRequests = 0;

function replyFor(system) {
  if (system.includes("goal interpreter for SWARM")) return JSON.stringify(interpretation);
  if (system.includes("workforce architect for SWARM")) return JSON.stringify(plan);
  if (system.includes("specialist agent in SWARM")) return JSON.stringify(agentOutput);
  if (system.includes("independent reviewer for a SWARM")) return JSON.stringify(review);
  if (system.includes("lead synthesizer for a SWARM")) return finalMarkdown;
  throw new Error(`Unexpected model prompt: ${system.slice(0, 160)}`);
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function startMockModel() {
  const server = http.createServer(async (request, response) => {
    try {
      if (request.method !== "POST" || !request.url?.endsWith("/chat/completions")) {
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "not found" }));
        return;
      }
      const raw = await readBody(request);
      const body = JSON.parse(raw);
      const system = Array.isArray(body.messages)
        ? body.messages
            .filter((message) => message.role === "system")
            .map((message) => message.content)
            .join("\n")
        : "";
      const content = replyFor(system);
      modelRequests += 1;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          id: `chatcmpl-smoke-${modelRequests}`,
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: body.model || "smoke-model",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 30, completion_tokens: 20, total_tokens: 50 },
        }),
      );
    } catch (error) {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: error.message }));
    }
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({ server, port: address.port });
    });
  });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}

async function waitForHealth(baseUrl, timeoutMs = 25_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "no response";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error.message;
    }
    await sleep(200);
  }
  throw new Error(`API did not become healthy: ${lastError}`);
}

function makeApi(baseUrl) {
  return async function api(pathname, init = {}) {
    const response = await fetch(`${baseUrl}${pathname}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = text;
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${pathname}: ${text.slice(0, 500)}`);
    }
    return payload;
  };
}

async function main() {
  const mock = await startMockModel();
  const apiPort = await freePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-smoke-"));
  const baseUrl = `http://127.0.0.1:${apiPort}`;
  const logs = [];

  const child = spawn(process.execPath, [apiEntry], {
    cwd: root,
    env: {
      ...process.env,
      SWARM_HOST: "127.0.0.1",
      SWARM_PORT: String(apiPort),
      SWARM_DATA_DIR: dataDir,
      SWARM_API_TOKEN: token,
      SWARM_INLINE_WORKER: "true",
      SWARM_LLM_PROVIDER: "openai-compatible",
      SWARM_LLM_MODEL: "smoke-model",
      SWARM_LLM_BASE_URL: `http://127.0.0.1:${mock.port}/v1`,
      SWARM_LLM_API_KEY: "smoke-key",
      SWARM_MAX_AGENTS: "3",
      SWARM_MAX_TASKS: "4",
      SWARM_MAX_MODEL_CALLS: "20",
      SWARM_MAX_TOKENS: "100000",
      SWARM_ENABLE_EXTERNAL_EXTENSIONS: "false",
      SWARM_ALLOW_STDIO_MCP: "false",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => logs.push(chunk.toString()));
  child.stderr.on("data", (chunk) => logs.push(chunk.toString()));

  let exitCode = null;
  child.once("exit", (code) => {
    exitCode = code ?? 1;
  });

  const stopChild = async () => {
    if (exitCode !== null) return;
    child.kill();
    const deadline = Date.now() + 5000;
    while (exitCode === null && Date.now() < deadline) await sleep(100);
    if (exitCode === null && process.platform === "win32") {
      spawnSync("taskkill", ["/pid", String(child.pid), "/f", "/t"], { stdio: "ignore" });
    }
  };

  try {
    await waitForHealth(baseUrl);
    const api = makeApi(baseUrl);

    const unauthenticated = await fetch(`${baseUrl}/api/bootstrap`);
    if (unauthenticated.status !== 401) {
      throw new Error(`Expected 401 without a token, got ${unauthenticated.status}.`);
    }

    const bootstrap = await api("/api/bootstrap");
    const workspaceId = bootstrap.workspace?.id;
    if (!workspaceId) throw new Error("Bootstrap did not return a workspace.");

    const created = await api(`/api/workspaces/${workspaceId}/runs`, {
      method: "POST",
      body: JSON.stringify({
        goal: "Create an evidence-based market entry brief for a new product.",
      }),
    });
    const runId = created.run?.id;
    if (!runId) throw new Error("Run creation did not return an id.");

    const deadline = Date.now() + 30_000;
    let detail = null;
    while (Date.now() < deadline) {
      detail = await api(`/api/runs/${runId}`);
      if (["completed", "failed", "cancelled"].includes(detail.run?.status)) break;
      if (detail.run?.status === "awaiting_approval") {
        throw new Error("Smoke run unexpectedly requested approval.");
      }
      await sleep(250);
    }

    if (detail?.run?.status !== "completed") {
      throw new Error(
        `Run did not complete: status=${detail?.run?.status} error=${detail?.run?.error ?? "none"}`,
      );
    }
    if (!detail.tasks?.length || detail.tasks.some((task) => task.status !== "completed")) {
      throw new Error("Not every task completed.");
    }
    const kinds = new Set((detail.artifacts ?? []).map((artifact) => artifact.kind));
    for (const required of ["deliverable", "review", "final"]) {
      if (!kinds.has(required)) throw new Error(`Missing ${required} artifact.`);
    }
    if (detail.usage?.modelCalls !== 5) {
      throw new Error(`Expected 5 accounted model calls, got ${detail.usage?.modelCalls}.`);
    }
    if (detail.modelCalls?.some((call) => call.status !== "succeeded")) {
      throw new Error("At least one model call failed.");
    }

    const final = detail.artifacts.find((artifact) => artifact.kind === "final");
    const download = await fetch(`${baseUrl}/api/artifacts/${final.id}/download`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!download.ok) throw new Error(`Artifact download failed with HTTP ${download.status}.`);
    const content = await download.text();
    if (!content.includes("Final market entry brief")) {
      throw new Error("Downloaded final artifact did not contain the expected content.");
    }

    console.log("[smoke] PASS");
    console.log(`[smoke] workspace=${workspaceId}`);
    console.log(`[smoke] run=${runId}`);
    console.log(`[smoke] modelCalls=${detail.usage.modelCalls} tokens=${detail.usage.totalTokens}`);
    console.log(`[smoke] artifacts=${detail.artifacts.length} mockRequests=${modelRequests}`);
  } catch (error) {
    console.error(`[smoke] FAIL: ${error.message}`);
    if (logs.length > 0) {
      console.error("[smoke] API logs:");
      console.error(logs.join("").slice(-8000));
    }
    process.exitCode = 1;
  } finally {
    await stopChild();
    await new Promise((resolve) => mock.server.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

await main();
