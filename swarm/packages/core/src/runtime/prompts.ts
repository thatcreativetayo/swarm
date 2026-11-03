import type { Agent, Memory, Run, Task } from "../contracts/common.js";
import type { AgentDefinition, GoalInterpretation } from "../domain/types.js";
import type { SwarmTool } from "../tools/types.js";
import { truncate } from "../utils/json.js";

export interface PromptContext {
  run: Run;
  task: Task;
  agent: Agent;
  definition: AgentDefinition;
  interpretation: GoalInterpretation | null;
  memories: Memory[];
  dependencies: Array<{ task: Task; agentName: string }>;
  tools: SwarmTool[];
  maxTurns: number;
}

const OUTPUT_SCHEMA = {
  summary: "string: concise summary of what you did and found",
  findings: ["string: specific, evidence-backed findings"],
  deliverable: {
    title: "string",
    format: "markdown | text | json | csv | html",
    content: "string: the complete deliverable",
  },
  citations: [{ title: "string", url: "string (optional)" }],
  confidence: "number between 0 and 1",
  openQuestions: ["string"],
  needsHumanReview: "boolean",
};

function dependencyBlock(dependencies: PromptContext["dependencies"]): string {
  if (dependencies.length === 0) return "No prior task outputs. This is an upstream task.";
  const blocks: string[] = [];
  let remaining = 30_000;
  for (const dependency of dependencies) {
    if (remaining <= 0) break;
    const output = dependency.task.output as Record<string, unknown> | null;
    const summary = typeof output?.summary === "string" ? output.summary : "No summary recorded.";
    const deliverable = output?.deliverable as Record<string, unknown> | undefined;
    const title = typeof deliverable?.title === "string" ? deliverable.title : dependency.task.deliverable;
    const content = typeof deliverable?.content === "string" ? deliverable.content : "";
    const block = [
      `### ${dependency.task.title} — ${dependency.agentName}`,
      `Task key: ${dependency.task.key}`,
      `Summary: ${summary}`,
      `Deliverable: ${title}`,
      content ? `Content:\n${truncate(content, Math.min(6000, remaining))}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    blocks.push(block);
    remaining -= block.length;
  }
  return blocks.join("\n\n");
}

function memoryBlock(memories: Memory[]): string {
  if (memories.length === 0) return "No relevant workspace memory.";
  return memories
    .map((memory) => `- [${memory.key}] ${truncate(memory.content, 800)}`)
    .join("\n");
}

function toolBlock(tools: SwarmTool[]): string {
  if (tools.length === 0) return "No tools are available for this task. Work from the supplied context.";
  return tools
    .map(
      (tool) =>
        `- ${tool.name} (risk: ${tool.risk}${tool.requiresApproval ? ", requires approval" : ""}): ${truncate(tool.description, 350)}`,
    )
    .join("\n");
}

export function buildAgentSystemPrompt(context: PromptContext): string {
  const { run, task, agent, definition, interpretation, memories, dependencies, tools, maxTurns } = context;
  const today = new Date().toISOString().slice(0, 10);
  const deliverableSummary = interpretation
    ? `Overall run deliverables:\n${interpretation.deliverables.map((item) => `- ${item}`).join("\n")}`
    : "";

  return [
    `You are ${agent.name}, a specialist agent in SWARM's autonomous workforce.`,
    `Role: ${agent.role}. Domain: ${agent.domainPack}. Today: ${today}.`,
    "",
    "## Run",
    `Goal: ${run.goal}`,
    interpretation ? `Objective: ${interpretation.objective}` : "",
    deliverableSummary,
    "",
    "## Your assigned task",
    `Title: ${task.title}`,
    `Task key: ${task.key}`,
    `Description: ${task.description}`,
    `Required deliverable: ${task.deliverable}`,
    task.evaluationCriteria.length > 0
      ? `Evaluation criteria:\n${task.evaluationCriteria.map((criterion) => `- ${criterion}`).join("\n")}`
      : "",
    "",
    "## Role contract",
    `Responsibilities:\n${definition.responsibilities.map((item) => `- ${item}`).join("\n")}`,
    `Capabilities: ${definition.capabilities.join(", ")}`,
    definition.permissionBoundaries.length > 0
      ? `Permission boundaries:\n${definition.permissionBoundaries.map((item) => `- ${item}`).join("\n")}`
      : "",
    "",
    "## Prior work",
    dependencyBlock(dependencies),
    "",
    "## Workspace memory",
    memoryBlock(memories),
    "",
    "## Tools",
    toolBlock(tools),
    "",
    "## Operating rules",
    "- Be rigorous and specific. Separate verified evidence from assumptions. Never invent sources, numbers, or actions.",
    "- Use tools when they materially improve the deliverable. Do not call a tool just to appear busy.",
    "- External writes, purchases, and destructive actions pause the run for explicit human approval. If a tool is denied, adapt rather than repeating the same call.",
    "- Do not expose secrets. Do not ask for credentials in your deliverable.",
    "- Health work is information and preparation only: no diagnosis, prescribing, or emergency care.",
    "- When you are done, return ONLY one JSON object (no markdown fences, no prose) with this shape:",
    JSON.stringify(OUTPUT_SCHEMA, null, 2),
    "",
    `You have at most ${maxTurns} model turns for this task. Prefer a decisive, well-supported deliverable over endless tool use.`,
  ]
    .filter((line) => line !== "")
    .join("\n");
}

export function buildAgentUserPrompt(context: PromptContext): string {
  return [
    `Complete the task "${context.task.title}" and produce the deliverable.`,
    "Use the prior work and memory above. If the task is upstream research, produce evidence and citations. If it is a synthesis, integrate rather than concatenate.",
    "Return only the final JSON object when finished.",
  ].join("\n");
}

export interface ReviewPromptContext {
  run: Run;
  interpretation: GoalInterpretation | null;
  outputs: Array<{ task: Task; agentName: string }>;
  toolExecutions: Array<{ toolName: string; status: string; error: string | null }>;
  approvals: Array<{ title: string; status: string }>;
}

export function buildReviewSystemPrompt(context: ReviewPromptContext): string {
  const outputs = context.outputs
    .map((entry) => {
      const output = entry.task.output as Record<string, unknown> | null;
      const summary = typeof output?.summary === "string" ? output.summary : "No summary.";
      const deliverable = output?.deliverable as Record<string, unknown> | undefined;
      const content = typeof deliverable?.content === "string" ? truncate(deliverable.content, 5000) : "";
      return `### ${entry.task.title} (${entry.agentName})\nSummary: ${summary}\n${content ? `Deliverable excerpt:\n${content}` : ""}`;
    })
    .join("\n\n");

  return [
    "You are the independent reviewer for a SWARM workforce run.",
    "Assess the combined work against the original goal. Be skeptical, specific, and constructive.",
    "Check completeness, internal consistency, evidence quality, unresolved risks, and whether the deliverable is actually usable.",
    "Return ONLY a JSON object with this shape:",
    JSON.stringify(
      {
        verdict: "pass | revise | fail",
        summary: "string",
        criteria: [{ criterion: "string", result: "pass | partial | fail", note: "string" }],
        issues: ["string"],
        recommendedActions: ["string"],
      },
      null,
      2,
    ),
    "",
    `Original goal:\n${context.run.goal}`,
    context.interpretation ? `Interpretation:\n${JSON.stringify(context.interpretation, null, 2)}` : "",
    `Task outputs:\n${outputs}`,
    `Tool activity: ${context.toolExecutions.map((execution) => `${execution.toolName}:${execution.status}${execution.error ? ` (${execution.error})` : ""}`).join("; ") || "none"}`,
    `Approvals: ${context.approvals.map((approval) => `${approval.title}:${approval.status}`).join("; ") || "none"}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildFinalSystemPrompt(context: ReviewPromptContext): string {
  const outputs = context.outputs
    .map((entry) => {
      const output = entry.task.output as Record<string, unknown> | null;
      const deliverable = output?.deliverable as Record<string, unknown> | undefined;
      const title = typeof deliverable?.title === "string" ? deliverable.title : entry.task.deliverable;
      const content = typeof deliverable?.content === "string" ? truncate(deliverable.content, 9000) : "";
      const findings = Array.isArray(output?.findings)
        ? (output.findings as unknown[]).filter((item): item is string => typeof item === "string").slice(0, 10)
        : [];
      const citations = Array.isArray(output?.citations) ? output.citations : [];
      return [
        `### ${entry.task.title} — ${entry.agentName}`,
        `Deliverable: ${title}`,
        findings.length ? `Findings:\n${findings.map((finding) => `- ${finding}`).join("\n")}` : "",
        content,
        citations.length ? `Citations: ${JSON.stringify(citations)}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");

  return [
    "You are the lead synthesizer for a SWARM workforce run.",
    "Produce one polished, self-contained final deliverable that the user can act on immediately.",
    "Integrate the specialist work. Resolve contradictions, state assumptions, and make recommendations explicit.",
    "Do not mention internal orchestration, model names, or hidden reasoning. Do not invent facts that are not in the specialist outputs.",
    "Use markdown unless the goal clearly calls for another format. Include a short executive summary, the substantive deliverable, risks/limitations, and next actions.",
    "Return only the final document content. No JSON wrapper, no preamble about being an AI.",
    "",
    `Original goal:\n${context.run.goal}`,
    context.interpretation ? `Interpretation:\n${JSON.stringify(context.interpretation, null, 2)}` : "",
    `Specialist outputs:\n${outputs}`,
  ]
    .filter(Boolean)
    .join("\n");
}
