import { describe, expect, it } from "vitest";
import {
  buildWorkforcePlan,
  fallbackInterpretation,
  interpretGoal,
} from "../src/workforce/planner.js";
import { validateWorkforcePlan } from "../src/workforce/validation.js";
import {
  interpretationFixture,
  planFixture,
  QueueProvider,
} from "./helpers.js";

describe("goal interpretation", () => {
  it("derives a bounded fallback interpretation from the goal", () => {
    const interpretation = fallbackInterpretation(
      "Research the latest competitor pricing and send a launch email to customers.",
    );
    expect(interpretation.domains).toContain("business");
    expect(interpretation.requiresResearch).toBe(true);
    expect(interpretation.requiresExternalActions).toBe(true);
    expect(interpretation.deliverables.length).toBeGreaterThanOrEqual(1);
    expect(interpretation.objective.length).toBeLessThanOrEqual(4000);
  });

  it("marks long goals as high complexity and short goals as low", () => {
    expect(fallbackInterpretation("a".repeat(1300)).complexity).toBe("high");
    expect(fallbackInterpretation("a".repeat(400)).complexity).toBe("medium");
    expect(fallbackInterpretation("short goal")).toMatchObject({ complexity: "low" });
  });

  it("uses a valid model interpretation", async () => {
    const provider = new QueueProvider([JSON.stringify(interpretationFixture)]);
    const result = await interpretGoal(provider, "Create a market entry brief for a new product");
    expect(result.fallback).toBe(false);
    expect(result.warning).toBeNull();
    expect(result.interpretation.title).toBe("Market entry brief");
    expect(result.interpretation.domains).toEqual(["business"]);
  });

  it("drops unknown domains and repairs an empty domain list", async () => {
    const provider = new QueueProvider([
      JSON.stringify({ ...interpretationFixture, domains: ["unknown_pack"] }),
    ]);
    const result = await interpretGoal(provider, "Plan a startup launch");
    expect(result.fallback).toBe(false);
    expect(result.interpretation.domains.length).toBeGreaterThan(0);
    expect(result.interpretation.domains).not.toContain("unknown_pack");
  });

  it("falls back when the model does not return valid JSON", async () => {
    const provider = new QueueProvider(["not json", "still not json"]);
    const result = await interpretGoal(provider, "Plan a startup launch");
    expect(result.fallback).toBe(true);
    expect(result.warning).toContain("fallback");
    expect(provider.requests).toHaveLength(2);
  });
});

describe("workforce planning", () => {
  const limits = { maxAgents: 5, maxTasks: 5 };

  it("accepts a valid model plan", async () => {
    const provider = new QueueProvider([JSON.stringify(planFixture)]);
    const result = await buildWorkforcePlan(
      provider,
      interpretationFixture,
      "Create a market entry brief",
      { limits },
    );
    expect(result.fallback).toBe(false);
    expect(result.warnings).toEqual([]);
    expect(result.plan.agents).toHaveLength(1);
    expect(validateWorkforcePlan(result.plan, limits)).toEqual([]);
  });

  it("retries an invalid model plan before falling back to domain templates", async () => {
    const invalidPlan = {
      ...planFixture,
      agents: [{ ...planFixture.agents[0]!, domainPack: "does_not_exist" }],
    };
    const provider = new QueueProvider([
      JSON.stringify(invalidPlan),
      JSON.stringify(invalidPlan),
    ]);
    const result = await buildWorkforcePlan(
      provider,
      interpretationFixture,
      "Create a market entry brief",
      { limits },
    );
    expect(result.fallback).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(validateWorkforcePlan(result.plan, limits)).toEqual([]);
    expect(result.plan.tasks.length).toBeGreaterThan(0);
  });

  it("builds a valid deterministic plan within low agent and task limits", async () => {
    const provider = new QueueProvider(["not a plan", "still not a plan"]);
    const result = await buildWorkforcePlan(
      provider,
      interpretationFixture,
      "Create a market entry brief",
      { limits: { maxAgents: 2, maxTasks: 4 } },
    );
    expect(result.fallback).toBe(true);
    expect(result.plan.agents.length).toBeLessThanOrEqual(2);
    expect(result.plan.tasks.length).toBeLessThanOrEqual(4);
    expect(validateWorkforcePlan(result.plan, { maxAgents: 2, maxTasks: 4 })).toEqual([]);
  });

  it("always returns at least one task for an unmatched goal", async () => {
    const provider = new QueueProvider(["nope", "nope"]);
    const result = await buildWorkforcePlan(
      provider,
      fallbackInterpretation("zzz unknown goal"),
      "zzz unknown goal",
      { limits: { maxAgents: 1, maxTasks: 1 } },
    );
    expect(result.fallback).toBe(true);
    expect(result.plan.tasks).toHaveLength(1);
    expect(validateWorkforcePlan(result.plan, { maxAgents: 1, maxTasks: 1 })).toEqual([]);
  });
});
