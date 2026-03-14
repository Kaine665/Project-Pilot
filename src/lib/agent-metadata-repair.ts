import { readPromptFile } from '@/lib/agent-prompt-store';
import { DEFAULT_AGENTS } from '@/lib/default-agents';
import type { Agent, AgentsData } from '@/types';

const MOJIBAKE_PATTERNS = [
  /�/,
  /鈥/,
  /€/,
  /闇€/,
  /閫/,
  /鐗/,
  /鍙/,
  /鍒/,
  /浣/,
  /鐨/,
  /绠/,
  /鎬ц兘/,
  /璇/,
  /鏁/,
  /鍔/,
  /鎴/,
  /涓嶇煡/,
  /閬囧埌/,
  /娑夊強/,
  /銆/,
  /锛/,
];

function looksCorrupted(value?: string): boolean {
  if (!value) return false;
  return MOJIBAKE_PATTERNS.some((pattern) => pattern.test(value));
}

function extractPromptMetadata(prompt?: string): { title?: string; description?: string } {
  if (!prompt) return {};

  const lines = prompt.replace(/\r\n?/g, '\n').split('\n');
  const title = lines.find((line) => /^#\s+/.test(line))?.replace(/^#\s+/, '').trim();

  const paragraph: string[] = [];
  let seenContent = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || /^#\s+/.test(line)) {
      if (seenContent) break;
      continue;
    }
    if (/^```/.test(line) || /^[-*|>]/.test(line)) {
      if (seenContent) break;
      continue;
    }

    paragraph.push(line);
    seenContent = true;
  }

  return {
    title,
    description: paragraph.length > 0 ? paragraph.join(' ') : undefined,
  };
}

function cloneDefaultAgent(defaultAgent: Agent): Agent {
  return {
    ...defaultAgent,
    capabilities: defaultAgent.capabilities ? { ...defaultAgent.capabilities } : undefined,
    contextIds: defaultAgent.contextIds ? [...defaultAgent.contextIds] : undefined,
    defaultResources: defaultAgent.defaultResources ? [...defaultAgent.defaultResources] : undefined,
    requiredParams: defaultAgent.requiredParams ? [...defaultAgent.requiredParams] : undefined,
    triggerHints: defaultAgent.triggerHints ? [...defaultAgent.triggerHints] : undefined,
  };
}

function mergeMissingFields(agent: Agent, defaultAgent: Agent): boolean {
  let changed = false;

  for (const key of Object.keys(defaultAgent) as Array<keyof Agent>) {
    if (agent[key] === undefined && defaultAgent[key] !== undefined) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (agent as any)[key] = defaultAgent[key];
      changed = true;
    }
  }

  return changed;
}

async function repairAgent(agent: Agent): Promise<boolean> {
  const defaultAgent = DEFAULT_AGENTS.find((candidate) => candidate.id === agent.id);
  const promptMeta = extractPromptMetadata(await readPromptFile(agent.id));
  let changed = false;

  const shouldRepairName =
    !agent.name ||
    agent.name === agent.id ||
    looksCorrupted(agent.name);
  if (shouldRepairName) {
    const repairedName = defaultAgent?.name ?? promptMeta.title;
    if (repairedName && repairedName !== agent.name) {
      agent.name = repairedName;
      changed = true;
    }
  }

  const shouldRepairDescription =
    !agent.description ||
    agent.description.startsWith('Recovered entry for ') ||
    looksCorrupted(agent.description);
  if (shouldRepairDescription) {
    const repairedDescription = defaultAgent?.description ?? promptMeta.description;
    if (repairedDescription && repairedDescription !== agent.description) {
      agent.description = repairedDescription;
      changed = true;
    }
  }

  if (agent.triggerHints?.length) {
    const filteredHints = agent.triggerHints.filter((hint) => !looksCorrupted(hint));
    if (filteredHints.length !== agent.triggerHints.length) {
      if (filteredHints.length > 0) {
        agent.triggerHints = filteredHints;
      } else if (defaultAgent?.triggerHints?.length) {
        agent.triggerHints = [...defaultAgent.triggerHints];
      } else {
        delete agent.triggerHints;
      }
      changed = true;
    }
  }

  return changed;
}

export async function mergeAndRepairAgentsData(data: AgentsData): Promise<{ data: AgentsData; changed: boolean }> {
  let changed = false;

  for (const defaultAgent of DEFAULT_AGENTS) {
    const existing = data.agents.find((agent) => agent.id === defaultAgent.id);
    if (!existing) {
      data.agents.unshift(cloneDefaultAgent(defaultAgent));
      changed = true;
      continue;
    }

    changed = mergeMissingFields(existing, defaultAgent) || changed;
  }

  for (const agent of data.agents) {
    changed = (await repairAgent(agent)) || changed;
  }

  return { data, changed };
}
