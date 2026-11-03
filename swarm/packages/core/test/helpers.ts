import os from "node:os";
import path from "node:path";
import { loadConfig, type SwarmConfig } from "../src/config.js";
import type {
  LlmMessage,
  LlmProvider,
  LlmRequest,
  LlmResponse,
  LlmToolCall,
} from "../src/providers/types.js";

export function completion(content: string): LlmResponse {
  return {
    content,
    toolCalls: [],
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    finishReason: "stop",
    model: "scripted-model",
    provider: "scripted",
  };
}

export function toolCompletion(call: LlmToolCall): LlmResponse {
  return {
    ...completion(""),
    toolCalls: [call],
    finishReason: "tool_calls",
  };
}

export function testConfig(overrides: NodeJS.ProcessEnv = {}): SwarmConfig {
  return loadConfig({
    SWARM_LLM_PROVIDER: "openai-compatible",
    SWARM_LLM_MODEL: "scripted-model",
    SWARM_LLM_BASE_URL: "http://127.0.0.1:9/v1",
    SWARM_DATA_DIR: path.join(os.tmpdir(), "swarm-core-tests", "data"),
    ...overrides,
  });
}

/** Returns queued responses in order. Strings are treated as assistant content. */
export class QueueProvider implements LlmProvider {
  readonly name = "scripted";
  readonly defaultModel = "scripted-model";
  readonly requests: LlmRequest[] = [];

  constructor(private readonly responses: Array<string | LlmResponse>) {}

  async complete(request: LlmRequest): Promise<LlmResponse> {
    this.requests.push(request);
    const next = this.responses.shift();
    if (next === undefined) throw new Error("QueueProvider ran out of scripted responses.");
    return typeof next === "string" ? completion(next) : next;
  }
}

export interface EngineScript {
  interpretation: unknown;
  plan: unknown;
  agent: LlmResponse[];
  review: unknown;
  final: string;
}

/**
 * Routes model requests by system-prompt role so tests do not depend on exact
 * call ordering between interpretation, planning, execution, review and final.
 */
export class ScriptedProvider implements LlmProvider {
  readonly name = "scripted";
  readonly defaultModel = "scripted-model";
  readonly requests: LlmRequest[] = [];
  private readonly agentResponses: LlmResponse[];

  constructor(private readonly script: EngineScript) {
    this.agentResponses = [...script.agent];
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    this.requests.push(request);
    const system =
      request.system ??
      request.messages
        .map((message: LlmMessage) => (message.role === "system" ? message.content : ""))
        .filter(Boolean)
        .join("\n");

    if (system.includes("goal interpreter for SWARM")) {
      return completion(JSON.stringify(this.script.interpretation));
    }
    if (system.includes("workforce architect for SWARM")) {
      return completion(JSON.stringify(this.script.plan));
    }
    if (system.includes("independent reviewer for a SWARM")) {
      return completion(JSON.stringify(this.script.review));
    }
    if (system.includes("lead synthesizer for a SWARM")) {
      return completion(this.script.final);
    }
    if (system.includes("specialist agent in SWARM")) {
      const next = this.agentResponses.shift();
      if (!next) throw new Error("ScriptedProvider ran out of agent responses.");
      return next;
    }
    throw new Error(`ScriptedProvider received an unexpected prompt: ${system.slice(0, 160)}`);
  }
}

export const interpretationFixture = {
  title: "Market entry brief",
  objective: "Produce an evidence-based market entry brief for a new product.",
  domains: ["business"],
  deliverables: ["Market brief", "Recommended entry strategy"],
  constraints: ["Do not contact external parties"],
  risks: ["Market data may be incomplete"],
  complexity: "medium" as const,
  requiresResearch: true,
  requiresExternalActions: false,
};

export const planFixture = {
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
      description: "Research the market and competitors.",
      agentKey: "business_market_researcher",
      dependsOn: [],
      deliverable: "Market and competitor brief",
      evaluationCriteria: ["Sources are cited"],
      priority: 80,
    },
  ],
  notes: ["Small focused team."],
};

export const agentOutputFixture = {
  summary: "Completed an evidence-based market scan.",
  findings: ["The target segment values speed."],
  deliverable: {
    title: "Market brief",
    format: "markdown" as const,
    content: "# Market brief\n\nEvidence and recommendations.",
  },
  citations: [],
  confidence: 0.8,
  openQuestions: [],
  needsHumanReview: false,
};

export const reviewFixture = {
  verdict: "pass" as const,
  summary: "The deliverable addresses the goal with clear assumptions.",
  criteria: [{ criterion: "Completeness", result: "pass" as const, note: "All requested sections exist." }],
  issues: [],
  recommendedActions: ["Validate the market estimate with primary research."],
};
