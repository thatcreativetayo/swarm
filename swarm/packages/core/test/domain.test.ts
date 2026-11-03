import { describe, expect, it } from "vitest";
import { isLlmConfigured, loadConfig, publicConfig } from "../src/config.js";
import {
  DOMAIN_PACKS,
  findAgentDefinition,
  getAgentDefinition,
  getDomainPack,
  resolveDomainKeys,
  validateDomainPacks,
  type DomainPack,
} from "../src/domain/index.js";
import { businessPack } from "../src/domain/packs.js";
import { createNativeToolRegistry } from "../src/tools/index.js";
import { validateWorkforcePlan } from "../src/workforce/validation.js";

describe("configuration", () => {
  it("provides safe local-first defaults", () => {
    const config = loadConfig({});
    expect(config.port).toBe(8787);
    expect(config.host).toBe("127.0.0.1");
    expect(config.llm.provider).toBeNull();
    expect(config.llm.model).toBeNull();
    expect(config.apiToken).toBeNull();
    expect(config.mcp.allowStdio).toBe(true);
    expect(config.extensions.enabled).toBe(false);
    expect(config.telegraph.nodeUrl).toBe("https://devnode.telegraphprotocol.com");
    expect(config.limits.maxAgents).toBe(8);
    expect(config.limits.maxTasks).toBe(12);
  });

  it("selects provider defaults and clamps numeric limits", () => {
    const openai = loadConfig({
      SWARM_LLM_PROVIDER: "openai",
      SWARM_LLM_API_KEY: "test-key",
    });
    expect(openai.llm.model).toBe("gpt-4.1-mini");
    expect(openai.llm.baseUrl).toBe("https://api.openai.com/v1");
    expect(isLlmConfigured(openai)).toBe(true);

    const anthropic = loadConfig({ SWARM_LLM_PROVIDER: "anthropic", SWARM_LLM_API_KEY: "k" });
    expect(anthropic.llm.baseUrl).toBe("https://api.anthropic.com");
    expect(anthropic.llm.model).toBe("claude-sonnet-4-5");

    const local = loadConfig({
      SWARM_LLM_PROVIDER: "openai-compatible",
      SWARM_MAX_AGENTS: "99",
      SWARM_MAX_TASKS: "0",
      SWARM_MAX_TOOL_STEPS: "not-a-number",
    });
    expect(local.llm.baseUrl).toBe("http://127.0.0.1:11434/v1");
    expect(isLlmConfigured(local)).toBe(true);
    expect(local.limits.maxAgents).toBe(12);
    expect(local.limits.maxTasks).toBe(1);
    expect(local.limits.maxToolSteps).toBe(6);
  });

  it("rejects unsupported providers", () => {
    expect(() => loadConfig({ SWARM_LLM_PROVIDER: "mystery" })).toThrow(/Unsupported/);
  });

  it("does not require an API key for a local OpenAI-compatible endpoint", () => {
    expect(isLlmConfigured(loadConfig({ SWARM_LLM_PROVIDER: "openai" }))).toBe(false);
    expect(
      isLlmConfigured(
        loadConfig({ SWARM_LLM_PROVIDER: "openai-compatible", SWARM_LLM_MODEL: "local" }),
      ),
    ).toBe(true);
  });

  it("never exposes secrets through public config", () => {
    const config = loadConfig({
      SWARM_LLM_PROVIDER: "openai",
      SWARM_LLM_API_KEY: "super-secret",
      SWARM_ENCRYPTION_KEY: "another-secret",
      SWARM_API_TOKEN: "token",
      TELEGRAPH_EVM_PRIVATE_KEY: "0xabc",
    });
    const serialized = JSON.stringify(publicConfig(config));
    expect(serialized).not.toContain("super-secret");
    expect(serialized).not.toContain("another-secret");
    expect(serialized).not.toContain("0xabc");
    expect(serialized).toContain("\"tokenRequired\":true");
    expect(serialized).toContain("\"paymentsConfigured\":true");
  });
});

describe("domain packs", () => {
  it("ships valid, unique packs", () => {
    expect(DOMAIN_PACKS.length).toBeGreaterThanOrEqual(6);
    expect(validateDomainPacks()).toEqual([]);
  });

  it("references only registered native tools in agent allowlists", () => {
    const tools = new Set(createNativeToolRegistry().list().map((tool) => tool.name));
    for (const pack of DOMAIN_PACKS) {
      for (const agent of pack.agents) {
        for (const toolName of agent.allowedTools) {
          expect(tools.has(toolName), `${pack.key}:${agent.key} references unknown tool ${toolName}`).toBe(true);
        }
      }
    }
  });

  it("looks up packs and agent definitions", () => {
    expect(getDomainPack("business")?.name).toContain("Business");
    expect(getDomainPack("missing")).toBeUndefined();
    expect(getAgentDefinition("business", "market_researcher")?.name).toBe("Market Researcher");
    expect(getAgentDefinition("business", "missing")).toBeUndefined();
    const found = findAgentDefinition("writer");
    expect(found?.pack.key).toBe("general");
  });

  it("resolves domains from goal keywords and honours suggestions", () => {
    const business = resolveDomainKeys("Plan a startup launch and market entry strategy");
    expect(business).toContain("business");
    expect(resolveDomainKeys("zzz unknown goal")).toEqual(["general"]);
    expect(resolveDomainKeys("something", ["health"])).toContain("health");
  });

  it("reports duplicate agents, unknown task agents, bad dependencies and workflows", () => {
    const invalid: DomainPack = {
      ...businessPack,
      agents: [...businessPack.agents, businessPack.agents[0]!],
      taskTemplates: [
        ...businessPack.taskTemplates,
        {
          key: "broken",
          title: "Broken",
          description: "Broken task",
          agentKey: "missing_agent",
          dependsOn: ["not_defined_earlier"],
          deliverable: "Nothing",
          evaluationCriteria: [],
          priority: 50,
        },
      ],
      workflows: [
        ...businessPack.workflows,
        { key: "broken_workflow", name: "Broken", description: "Broken", taskKeys: ["missing_task"] },
      ],
    };
    const errors = validateDomainPacks([invalid, { ...businessPack }]);
    expect(errors.some((error) => error.includes("duplicate agent key"))).toBe(true);
    expect(errors.some((error) => error.includes("unknown agent missing_agent"))).toBe(true);
    expect(errors.some((error) => error.includes("not defined earlier"))).toBe(true);
    expect(errors.some((error) => error.includes("unknown task missing_task"))).toBe(true);
    expect(errors.some((error) => error.includes("duplicate domain pack key"))).toBe(true);
  });
});

describe("workforce plan validation", () => {
  const limits = { maxAgents: 3, maxTasks: 3 };
  const valid = {
    agents: [
      {
        key: "business_market_researcher",
        definitionKey: "market_researcher",
        domainPack: "business",
        name: "Market Researcher",
        role: "Research",
        rationale: "Needed",
      },
      {
        key: "general_reviewer",
        definitionKey: "reviewer",
        domainPack: "general",
        name: "Reviewer",
        role: "Review",
        rationale: "Quality gate",
      },
    ],
    tasks: [
      {
        key: "market_scan",
        title: "Market scan",
        description: "Scan the market",
        agentKey: "business_market_researcher",
        dependsOn: [],
        deliverable: "Brief",
        evaluationCriteria: [],
        priority: 80,
      },
    ],
    notes: [],
  };

  it("accepts a valid plan, including a reviewer without a task", () => {
    expect(validateWorkforcePlan(valid, limits)).toEqual([]);
  });

  it("rejects limits, unknown packs and definitions", () => {
    const errors = validateWorkforcePlan(
      {
        ...valid,
        agents: [
          ...valid.agents,
          { ...valid.agents[0]!, key: "extra" },
          { ...valid.agents[0]!, key: "unknown_pack", domainPack: "nope" },
          { ...valid.agents[0]!, key: "unknown_definition", definitionKey: "nope" },
        ],
        tasks: [...valid.tasks, ...valid.tasks.map((task) => ({ ...task, key: `${task.key}_2` }))],
      },
      limits,
    );
    expect(errors.some((error) => error.includes("limit is 3"))).toBe(true);
    expect(errors.some((error) => error.includes("unknown domain pack"))).toBe(true);
    expect(errors.some((error) => error.includes("unknown definition"))).toBe(true);
  });

  it("rejects duplicate keys, unknown task agents and forward dependencies", () => {
    const errors = validateWorkforcePlan(
      {
        agents: [valid.agents[0]!, { ...valid.agents[0]! }],
        tasks: [
          {
            ...valid.tasks[0]!,
            key: "first",
            dependsOn: ["second"],
            agentKey: "missing_agent",
          },
          { ...valid.tasks[0]!, key: "second" },
          { ...valid.tasks[0]!, key: "first" },
        ],
        notes: [],
      },
      { maxAgents: 5, maxTasks: 5 },
    );
    expect(errors.some((error) => error.includes("Duplicate agent key"))).toBe(true);
    expect(errors.some((error) => error.includes("unknown agent 'missing_agent'"))).toBe(true);
    expect(errors.some((error) => error.includes("not an earlier task"))).toBe(true);
    expect(errors.some((error) => error.includes("Duplicate task key"))).toBe(true);
  });

  it("rejects working agents with no assigned task", () => {
    expect(
      validateWorkforcePlan(
        {
          ...valid,
          agents: [...valid.agents, { ...valid.agents[0]!, key: "idle_specialist" }],
        },
        { maxAgents: 5, maxTasks: 5 },
      ).some((error) => error.includes("has no assigned task")),
    ).toBe(true);
  });
});
