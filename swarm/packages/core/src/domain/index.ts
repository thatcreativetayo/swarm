import { businessPack, careerPack, educationPack, generalPack, healthPack, softwarePack } from "./packs.js";
import type { AgentDefinition, DomainPack, TaskTemplate } from "./types.js";

export const DOMAIN_PACKS: readonly DomainPack[] = [
  businessPack,
  educationPack,
  softwarePack,
  careerPack,
  healthPack,
  generalPack,
];

const packByKey = new Map(DOMAIN_PACKS.map((pack) => [pack.key, pack]));

export function getDomainPack(key: string): DomainPack | undefined {
  return packByKey.get(key);
}

export function getAgentDefinition(
  packKey: string,
  definitionKey: string,
): AgentDefinition | undefined {
  return packByKey.get(packKey)?.agents.find((agent) => agent.key === definitionKey);
}

export function findAgentDefinition(definitionKey: string): {
  pack: DomainPack;
  agent: AgentDefinition;
} | undefined {
  for (const pack of DOMAIN_PACKS) {
    const agent = pack.agents.find((candidate) => candidate.key === definitionKey);
    if (agent) return { pack, agent };
  }
  return undefined;
}

export function findTaskTemplate(packKey: string, taskKey: string): TaskTemplate | undefined {
  return packByKey.get(packKey)?.taskTemplates.find((task) => task.key === taskKey);
}

export function listAgentDefinitions(): Array<{ pack: DomainPack; agent: AgentDefinition }> {
  return DOMAIN_PACKS.flatMap((pack) => pack.agents.map((agent) => ({ pack, agent })));
}

export function resolveDomainKeys(goal: string, suggested: string[] = []): string[] {
  const normalized = goal.toLowerCase();
  const scores = new Map<string, number>();

  for (const pack of DOMAIN_PACKS) {
    if (pack.key === "general") continue;
    let score = 0;
    for (const keyword of pack.keywords) {
      if (normalized.includes(keyword.toLowerCase())) {
        score += keyword.includes(" ") ? 3 : 2;
      }
    }
    if (suggested.includes(pack.key)) score += 10;
    if (score > 0) scores.set(pack.key, score);
  }

  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([key]) => key);
  const selected = ranked.slice(0, 3);
  return selected.length > 0 ? selected : ["general"];
}

export function validateDomainPacks(packs: readonly DomainPack[] = DOMAIN_PACKS): string[] {
  const errors: string[] = [];
  const packKeys = new Set<string>();
  const agentKeys = new Set<string>();

  for (const pack of packs) {
    if (packKeys.has(pack.key)) errors.push(`duplicate domain pack key: ${pack.key}`);
    packKeys.add(pack.key);

    const localAgentKeys = new Set<string>();
    for (const agent of pack.agents) {
      const composite = `${pack.key}:${agent.key}`;
      if (localAgentKeys.has(agent.key)) errors.push(`duplicate agent key in ${pack.key}: ${agent.key}`);
      localAgentKeys.add(agent.key);
      if (agentKeys.has(composite)) errors.push(`duplicate composite agent key: ${composite}`);
      agentKeys.add(composite);
      if (agent.allowedTools.length === 0) {
        errors.push(`agent ${composite} has no allowed tools`);
      }
    }

    const templateKeys = new Set<string>();
    for (const template of pack.taskTemplates) {
      if (templateKeys.has(template.key)) {
        errors.push(`duplicate task template key in ${pack.key}: ${template.key}`);
      }
      templateKeys.add(template.key);
      if (!localAgentKeys.has(template.agentKey)) {
        errors.push(`task ${pack.key}:${template.key} references unknown agent ${template.agentKey}`);
      }
      for (const dependency of template.dependsOn) {
        if (!templateKeys.has(dependency)) {
          errors.push(
            `task ${pack.key}:${template.key} depends on ${dependency}, which is not defined earlier in the pack`,
          );
        }
      }
    }

    for (const workflow of pack.workflows) {
      for (const taskKey of workflow.taskKeys) {
        if (!templateKeys.has(taskKey)) {
          errors.push(`workflow ${pack.key}:${workflow.key} references unknown task ${taskKey}`);
        }
      }
    }
  }

  return errors;
}

export * from "./types.js";
