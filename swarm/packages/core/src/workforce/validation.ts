import { getAgentDefinition, getDomainPack } from "../domain/index.js";
import type { WorkforcePlan } from "../domain/types.js";

export interface PlanLimits {
  maxAgents: number;
  maxTasks: number;
}

export function validateWorkforcePlan(plan: WorkforcePlan, limits: PlanLimits): string[] {
  const errors: string[] = [];
  if (plan.agents.length === 0) errors.push("Plan has no agents.");
  if (plan.tasks.length === 0) errors.push("Plan has no tasks.");
  if (plan.agents.length > limits.maxAgents) {
    errors.push(`Plan has ${plan.agents.length} agents; the limit is ${limits.maxAgents}.`);
  }
  if (plan.tasks.length > limits.maxTasks) {
    errors.push(`Plan has ${plan.tasks.length} tasks; the limit is ${limits.maxTasks}.`);
  }

  const agentKeys = new Set<string>();
  for (const agent of plan.agents) {
    if (agentKeys.has(agent.key)) errors.push(`Duplicate agent key: ${agent.key}`);
    agentKeys.add(agent.key);
    if (!getDomainPack(agent.domainPack)) {
      errors.push(`Agent ${agent.key} uses unknown domain pack '${agent.domainPack}'.`);
      continue;
    }
    if (!getAgentDefinition(agent.domainPack, agent.definitionKey)) {
      errors.push(
        `Agent ${agent.key} uses unknown definition '${agent.definitionKey}' in pack '${agent.domainPack}'.`,
      );
    }
  }

  const taskKeys = new Set<string>();
  for (const task of plan.tasks) {
    if (taskKeys.has(task.key)) errors.push(`Duplicate task key: ${task.key}`);
    if (!agentKeys.has(task.agentKey)) {
      errors.push(`Task ${task.key} references unknown agent '${task.agentKey}'.`);
    }
    for (const dependency of task.dependsOn) {
      if (!taskKeys.has(dependency)) {
        errors.push(`Task ${task.key} depends on '${dependency}', which is not an earlier task in the plan.`);
      }
    }
    taskKeys.add(task.key);
  }

  const usedAgents = new Set(plan.tasks.map((task) => task.agentKey));
  for (const agent of plan.agents) {
    if (!usedAgents.has(agent.key) && agent.definitionKey !== "reviewer") {
      errors.push(`Agent ${agent.key} has no assigned task.`);
    }
  }

  return errors;
}

export function planSummary(plan: WorkforcePlan): string {
  return `${plan.agents.length} specialists, ${plan.tasks.length} coordinated tasks`;
}
