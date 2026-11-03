import { z } from "zod";
import { ArtifactFormatSchema, JsonValueSchema } from "../contracts/common.js";

export const AgentDefinitionSchema = z.object({
  key: z.string().regex(/^[a-z0-9_]+$/, "agent keys use lowercase letters, numbers, underscores"),
  name: z.string().min(1),
  role: z.string().min(1),
  responsibilities: z.array(z.string().min(1)).min(1),
  capabilities: z.array(z.string().min(1)).min(1),
  skills: z.array(z.string().min(1)).default([]),
  allowedTools: z.array(z.string().min(1)).default([]),
  requiredContext: z.array(z.string().min(1)).default([]),
  inputSchema: z.record(z.string(), JsonValueSchema).default({ type: "object" }),
  outputSchema: z.record(z.string(), JsonValueSchema).default({ type: "object" }),
  evaluationCriteria: z.array(z.string().min(1)).min(1),
  permissionBoundaries: z.array(z.string().min(1)).default([]),
  defaultModel: z.string().min(1).optional(),
  maxSteps: z.number().int().min(1).max(12).default(6),
});
export type AgentDefinition = z.infer<typeof AgentDefinitionSchema>;

export const TaskTemplateSchema = z.object({
  key: z.string().regex(/^[a-z0-9_]+$/),
  title: z.string().min(1),
  description: z.string().min(1),
  agentKey: z.string().min(1),
  dependsOn: z.array(z.string()).default([]),
  deliverable: z.string().min(1),
  evaluationCriteria: z.array(z.string()).default([]),
  priority: z.number().int().min(0).max(100).default(50),
});
export type TaskTemplate = z.infer<typeof TaskTemplateSchema>;

export const WorkflowSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  taskKeys: z.array(z.string()).min(1),
});
export type Workflow = z.infer<typeof WorkflowSchema>;

export const ToolRequirementSchema = z.object({
  tool: z.string().min(1),
  reason: z.string().min(1),
  required: z.boolean().default(false),
});
export type ToolRequirement = z.infer<typeof ToolRequirementSchema>;

export const DomainPackSchema = z.object({
  key: z.string().regex(/^[a-z0-9_]+$/),
  name: z.string().min(1),
  description: z.string().min(1),
  keywords: z.array(z.string().min(1)).min(1),
  agents: z.array(AgentDefinitionSchema).min(1),
  taskTemplates: z.array(TaskTemplateSchema).min(1),
  workflows: z.array(WorkflowSchema).default([]),
  toolRequirements: z.array(ToolRequirementSchema).default([]),
  evaluationRules: z.array(z.string().min(1)).min(1),
});
export type DomainPack = z.infer<typeof DomainPackSchema>;

export const GoalInterpretationSchema = z.object({
  title: z.string().min(1).max(160),
  objective: z.string().min(1).max(4000),
  domains: z.array(z.string().min(1)).min(1).max(4),
  deliverables: z.array(z.string().min(1)).min(1).max(8),
  constraints: z.array(z.string()).max(10).default([]),
  risks: z.array(z.string()).max(10).default([]),
  complexity: z.enum(["low", "medium", "high"]),
  requiresResearch: z.boolean().default(false),
  requiresExternalActions: z.boolean().default(false),
});
export type GoalInterpretation = z.infer<typeof GoalInterpretationSchema>;

export const PlannedAgentSchema = z.object({
  key: z.string().min(1),
  definitionKey: z.string().min(1),
  domainPack: z.string().min(1),
  name: z.string().min(1),
  role: z.string().min(1),
  rationale: z.string().min(1),
});
export type PlannedAgent = z.infer<typeof PlannedAgentSchema>;

export const PlannedTaskSchema = z.object({
  key: z.string().regex(/^[a-z0-9_]+$/),
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(8000),
  agentKey: z.string().min(1),
  dependsOn: z.array(z.string()).default([]),
  deliverable: z.string().min(1).max(500),
  evaluationCriteria: z.array(z.string()).default([]),
  priority: z.number().int().min(0).max(100).default(50),
});
export type PlannedTask = z.infer<typeof PlannedTaskSchema>;

export const WorkforcePlanSchema = z.object({
  agents: z.array(PlannedAgentSchema).min(1),
  tasks: z.array(PlannedTaskSchema).min(1),
  notes: z.array(z.string()).default([]),
});
export type WorkforcePlan = z.infer<typeof WorkforcePlanSchema>;

export const AgentDeliverableSchema = z.object({
  title: z.string().min(1).max(200),
  format: ArtifactFormatSchema,
  content: z.string().min(1),
});
export type AgentDeliverable = z.infer<typeof AgentDeliverableSchema>;

export const AgentOutputSchema = z.object({
  summary: z.string().min(1),
  findings: z.array(z.string()).default([]),
  deliverable: AgentDeliverableSchema,
  citations: z
    .array(z.object({ title: z.string(), url: z.string().optional() }))
    .default([]),
  confidence: z.number().min(0).max(1).default(0.5),
  openQuestions: z.array(z.string()).default([]),
  needsHumanReview: z.boolean().default(false),
});
export type AgentOutput = z.infer<typeof AgentOutputSchema>;

export const ReviewOutputSchema = z.object({
  verdict: z.enum(["pass", "revise", "fail"]),
  summary: z.string().min(1),
  criteria: z
    .array(
      z.object({
        criterion: z.string(),
        result: z.enum(["pass", "partial", "fail"]),
        note: z.string(),
      }),
    )
    .default([]),
  issues: z.array(z.string()).default([]),
  recommendedActions: z.array(z.string()).default([]),
});
export type ReviewOutput = z.infer<typeof ReviewOutputSchema>;
