import { z } from "zod";
import { DOMAIN_PACKS, getDomainPack, resolveDomainKeys } from "../domain/index.js";
import {
  GoalInterpretationSchema,
  WorkforcePlanSchema,
  type GoalInterpretation,
  type PlannedAgent,
  type PlannedTask,
  type WorkforcePlan,
} from "../domain/types.js";
import { generateJson } from "../providers/structured.js";
import type { LlmProvider } from "../providers/types.js";
import type { PlanLimits } from "./validation.js";
import { validateWorkforcePlan } from "./validation.js";

export interface InterpretationResult {
  interpretation: GoalInterpretation;
  fallback: boolean;
  warning: string | null;
}

export interface PlanResult {
  plan: WorkforcePlan;
  fallback: boolean;
  warnings: string[];
}

export interface PlanningOptions {
  model?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  limits: PlanLimits;
  workspacePolicyNote?: string;
}

function errorMessage(error: unknown): string {
  if (error instanceof z.ZodError) {
    return error.issues.map((issue) => `${issue.path.join(".") || "value"}: ${issue.message}`).join("; ");
  }
  return (error as Error).message;
}

export function fallbackInterpretation(goal: string): GoalInterpretation {
  const domains = resolveDomainKeys(goal).slice(0, 3);
  const firstLine = goal.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? goal;
  const title = firstLine.length > 120 ? `${firstLine.slice(0, 117)}...` : firstLine;
  return {
    title: title || "New workforce run",
    objective: goal.slice(0, 4000),
    domains: domains.length > 0 ? domains : ["general"],
    deliverables: [
      "A clear, evidence-based final deliverable that directly addresses the goal",
      "Supporting research, analysis, and decisions with assumptions made explicit",
      "A concise list of risks, open questions, and recommended next actions",
    ],
    constraints: [],
    risks: [],
    complexity: goal.length > 1200 ? "high" : goal.length > 300 ? "medium" : "low",
    requiresResearch: /\b(research|market|competitor|source|evidence|latest|news)\b/i.test(goal),
    requiresExternalActions: /\b(send|publish|post|create issue|email|contact|purchase|buy|book)\b/i.test(goal),
  };
}

function normalizeInterpretation(value: GoalInterpretation, goal: string): GoalInterpretation {
  const validPacks = new Set(DOMAIN_PACKS.map((pack) => pack.key));
  const domains = value.domains.filter((domain) => validPacks.has(domain)).slice(0, 4);
  if (domains.length === 0) domains.push(...resolveDomainKeys(goal).slice(0, 3));
  return {
    ...value,
    title: value.title.trim().slice(0, 160) || fallbackInterpretation(goal).title,
    objective: value.objective.trim().slice(0, 4000) || goal.slice(0, 4000),
    domains: domains.length > 0 ? domains : ["general"],
    deliverables: value.deliverables.filter(Boolean).slice(0, 8),
  };
}

export async function interpretGoal(
  provider: LlmProvider,
  goal: string,
  options: Omit<PlanningOptions, "limits"> = {},
): Promise<InterpretationResult> {
  const system = [
    "You are the goal interpreter for SWARM, a universal autonomous AI workforce.",
    "SWARM is not a coding assistant. It works across business, education, software, careers, health information, and general knowledge work.",
    "Read the user's goal and produce a precise, bounded interpretation that a workforce planner can execute.",
    "Return only a JSON object matching this schema:",
    JSON.stringify({
      title: "string, max 160 chars",
      objective: "string, max 4000 chars",
      domains: "array of pack keys, 1-4 items",
      deliverables: "array of 1-8 concrete deliverables",
      constraints: "array of constraints explicitly stated or necessarily implied",
      risks: "array of material risks",
      complexity: "low | medium | high",
      requiresResearch: "boolean",
      requiresExternalActions: "boolean",
    }),
    `Available domain pack keys: ${DOMAIN_PACKS.map((pack) => `${pack.key} (${pack.name})`).join(", ")}.`,
    "Never invent facts about the user. Do not add constraints the user did not state unless they are necessary for safety or legality.",
    "Health is information and preparation support only, never diagnosis, prescribing, or emergency care.",
  ].join("\n");

  try {
    const raw = await generateJson({
      provider,
      system,
      prompt: `User goal:\n${goal}`,
      model: options.model,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
      maxTokens: 2500,
      attempts: 2,
    });
    const parsed = GoalInterpretationSchema.parse(raw);
    return { interpretation: normalizeInterpretation(parsed, goal), fallback: false, warning: null };
  } catch (error) {
    return {
      interpretation: fallbackInterpretation(goal),
      fallback: true,
      warning: `Goal interpreter fallback used: ${errorMessage(error)}`,
    };
  }
}

function packCatalog(): string {
  return DOMAIN_PACKS.map((pack) => {
    return [
      `PACK ${pack.key}: ${pack.name} — ${pack.description}`,
      "Agents:",
      ...pack.agents.map(
        (agent) =>
          `- ${agent.key}: ${agent.name} — ${agent.role}. Capabilities: ${agent.capabilities.join(", ")}. Tools: ${agent.allowedTools.join(", ")}.`,
      ),
      "Task templates (dependencies must point to earlier tasks):",
      ...pack.taskTemplates.map(
        (task) =>
          `- ${task.key}: ${task.title} | agent=${task.agentKey} | dependsOn=${task.dependsOn.join(",") || "none"} | deliverable=${task.deliverable}`,
      ),
      `Workflows: ${pack.workflows.map((workflow) => `${workflow.key} (${workflow.taskKeys.join(" -> ")})`).join("; ") || "none"}`,
    ].join("\n");
  }).join("\n\n");
}

function fallbackPlan(interpretation: GoalInterpretation, limits: PlanLimits, reason: string): WorkforcePlan {
  const requested = interpretation.domains.filter((key) => getDomainPack(key)).slice(0, 3);
  const domains = requested.length > 0 ? requested : ["general"];
  const agents: PlannedAgent[] = [];
  const tasks: PlannedTask[] = [];
  const agentKeys = new Set<string>();
  const reserveSynthesis = limits.maxTasks > 2;
  const taskBudget = Math.max(1, limits.maxTasks - (reserveSynthesis ? 1 : 0));
  const selectedPacks: string[] = [];

  for (const domain of domains) {
    if (tasks.length >= taskBudget) break;
    const pack = getDomainPack(domain);
    if (!pack) continue;
    const remaining = taskBudget - tasks.length;
    const remainingAgents = limits.maxAgents - agents.length;
    if (remaining <= 0 || remainingAgents <= 0) break;
    const workflows = [...pack.workflows].sort((a, b) => b.taskKeys.length - a.taskKeys.length);
    let templateKeys: string[] | null = null;
    for (const workflow of workflows) {
      const templates = workflow.taskKeys
        .map((key) => pack.taskTemplates.find((task) => task.key === key))
        .filter((task): task is NonNullable<typeof task> => Boolean(task));
      const uniqueAgents = new Set(templates.map((task) => task.agentKey)).size;
      if (
        templates.length === workflow.taskKeys.length &&
        templates.length <= remaining &&
        uniqueAgents <= remainingAgents
      ) {
        templateKeys = workflow.taskKeys;
        break;
      }
    }
    if (!templateKeys) {
      templateKeys = [];
      const selectedAgents = new Set<string>();
      for (const template of pack.taskTemplates) {
        if (templateKeys.length >= remaining) break;
        const isNewAgent = !selectedAgents.has(template.agentKey);
        if (isNewAgent && selectedAgents.size >= remainingAgents) continue;
        selectedAgents.add(template.agentKey);
        templateKeys.push(template.key);
      }
    }
    if (templateKeys.length === 0) continue;
    selectedPacks.push(pack.key);

    for (const templateKey of templateKeys) {
      const template = pack.taskTemplates.find((candidate) => candidate.key === templateKey);
      if (!template) continue;
      const agentDefinition = pack.agents.find((agent) => agent.key === template.agentKey);
      if (!agentDefinition) continue;
      const compositeKey = `${pack.key}_${agentDefinition.key}`;
      if (!agentKeys.has(compositeKey)) {
        agentKeys.add(compositeKey);
        agents.push({
          key: compositeKey,
          definitionKey: agentDefinition.key,
          domainPack: pack.key,
          name: agentDefinition.name,
          role: agentDefinition.role,
          rationale: `Selected from the ${pack.name} pack for ${template.title.toLowerCase()}.`,
        });
      }
      tasks.push({
        key: `${pack.key}_${template.key}`,
        title: template.title,
        description: `${template.description}\n\nGoal context: ${interpretation.objective}`,
        agentKey: compositeKey,
        dependsOn: template.dependsOn
          .filter((dependency) => templateKeys?.includes(dependency))
          .map((dependency) => `${pack.key}_${dependency}`),
        deliverable: template.deliverable,
        evaluationCriteria: template.evaluationCriteria,
        priority: template.priority,
      });
    }
  }

  if (tasks.length === 0) {
    const pack = getDomainPack("general")!;
    const writer = pack.agents.find((agent) => agent.key === "writer")!;
    agents.push({
      key: "general_writer",
      definitionKey: writer.key,
      domainPack: "general",
      name: writer.name,
      role: writer.role,
      rationale: "Generalist writer for a goal that did not match a specialist pack.",
    });
    tasks.push({
      key: "general_execution",
      title: "Produce the requested deliverable",
      description: `Complete the user's goal directly and rigorously.\n\nGoal: ${interpretation.objective}`,
      agentKey: "general_writer",
      dependsOn: [],
      deliverable: "A complete, well-structured deliverable that answers the goal.",
      evaluationCriteria: ["Directly answers the goal", "States assumptions", "Surfaces open questions"],
      priority: 50,
    });
  }

  if (reserveSynthesis && selectedPacks.length > 0 && agents.length < limits.maxAgents) {
    const generalPack = getDomainPack("general")!;
    const writer = generalPack.agents.find((agent) => agent.key === "writer")!;
    const writerKey = "general_writer";
    if (!agentKeys.has(writerKey)) {
      agentKeys.add(writerKey);
      agents.push({
        key: writerKey,
        definitionKey: writer.key,
        domainPack: "general",
        name: writer.name,
        role: writer.role,
        rationale: "Synthesises specialist outputs into one coherent final deliverable.",
      });
    }
    const dependencyKeys = new Set(tasks.flatMap((task) => task.dependsOn));
    const leaves = tasks.filter((task) => !dependencyKeys.has(task.key)).map((task) => task.key);
    tasks.push({
      key: "synthesis",
      title: "Synthesise the final integrated deliverable",
      description:
        "Integrate the specialist outputs into one coherent deliverable. Resolve conflicts, make trade-offs explicit, and do not simply concatenate the inputs.",
      agentKey: writerKey,
      dependsOn: leaves,
      deliverable: "A single integrated final deliverable with clear recommendations and next actions.",
      evaluationCriteria: [
        "Integrates every specialist output",
        "Resolves contradictions or explains them",
        "Recommendations follow from the evidence",
      ],
      priority: 35,
    });
  }

  const reviewer = getDomainPack("general")?.agents.find((agent) => agent.key === "reviewer");
  if (reviewer && agents.length < limits.maxAgents && !agentKeys.has("general_reviewer")) {
    agents.push({
      key: "general_reviewer",
      definitionKey: reviewer.key,
      domainPack: "general",
      name: reviewer.name,
      role: reviewer.role,
      rationale: "Independent quality gate for the final deliverable.",
    });
  }

  return {
    agents: agents.slice(0, limits.maxAgents),
    tasks: tasks.slice(0, limits.maxTasks),
    notes: [
      `Fallback plan generated from domain templates: ${reason}`,
      `Selected domains: ${selectedPacks.join(", ") || "general"}.`,
    ],
  };
}

export async function buildWorkforcePlan(
  provider: LlmProvider,
  interpretation: GoalInterpretation,
  goal: string,
  options: PlanningOptions,
): Promise<PlanResult> {
  const system = [
    "You are the workforce architect for SWARM, a universal autonomous AI workforce.",
    "Design the smallest specialist team that can complete the goal with high quality. Do not default to a coding team.",
    "Use the supplied domain packs as the source of specialist roles. You may combine at most four packs.",
    "Return only a JSON object:",
    JSON.stringify({
      agents: [
        {
          key: "unique lowercase key, prefix with pack key",
          definitionKey: "agent key from the pack",
          domainPack: "pack key",
          name: "display name",
          role: "one-line role",
          rationale: "why this specialist is needed",
        },
      ],
      tasks: [
        {
          key: "unique lowercase task key",
          title: "task title",
          description: "specific instructions and context",
          agentKey: "agent key from this plan",
          dependsOn: ["earlier task keys only"],
          deliverable: "concrete deliverable",
          evaluationCriteria: ["measurable criterion"],
          priority: 0,
        },
      ],
      notes: ["planning notes"],
    }),
    `Hard limits: at most ${options.limits.maxAgents} agents and ${options.limits.maxTasks} tasks.`,
    "Every task must reference an agent in the plan. Dependencies must reference earlier tasks only. No cycles.",
    "Every working agent should have at least one task. You may include one independent reviewer agent from the general pack (definitionKey reviewer) with no task.",
    "Tasks should be concrete, ordered, and produce artifacts the user can use. Include research or evidence steps when the goal needs them.",
    "Do not include tasks that require spending money or contacting third parties without making the need explicit in the task description.",
    options.workspacePolicyNote ?? "",
    "Pack catalog:",
    packCatalog(),
  ].join("\n");

  const basePrompt = [
    `Original goal:\n${goal}`,
    `Goal interpretation:\n${JSON.stringify(interpretation, null, 2)}`,
    "Produce the workforce plan JSON now.",
  ].join("\n\n");

  let lastErrors: string[] = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const raw = await generateJson({
        provider,
        system,
        prompt:
          attempt === 0
            ? basePrompt
            : `${basePrompt}\n\nYour previous plan was rejected for these reasons:\n- ${lastErrors.join("\n- ")}\nReturn a corrected plan.`,
        model: options.model,
        signal: options.signal,
        timeoutMs: options.timeoutMs,
        maxTokens: 5000,
        attempts: 2,
      });
      const plan = WorkforcePlanSchema.parse(raw);
      lastErrors = validateWorkforcePlan(plan, options.limits);
      if (lastErrors.length === 0) {
        return { plan, fallback: false, warnings: [] };
      }
    } catch (error) {
      lastErrors = [errorMessage(error)];
    }
  }

  const plan = fallbackPlan(interpretation, options.limits, lastErrors.slice(0, 3).join("; ") || "invalid model plan");
  const validation = validateWorkforcePlan(plan, options.limits);
  return {
    plan,
    fallback: true,
    warnings: [
      "The model plan was rejected; a deterministic plan built from domain packs was used.",
      ...lastErrors.slice(0, 5),
      ...validation,
    ],
  };
}
