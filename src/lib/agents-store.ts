import { getAgentsPath, readJsonFile, writeJsonFile, ensureDataDirV2Migrated } from '@/lib/file-store';
import { DEFAULT_AGENTS, getDefaultAgents } from '@/lib/default-agents';
import { mergeAndRepairAgentsData } from '@/lib/agent-metadata-repair';
import {
  deletePromptFile,
  readPromptFile,
  resolveSystemPrompt,
  writePromptFile,
} from '@/lib/agent-prompt-store';
import { getSettings } from '@/lib/settings-manager';
import type { Agent, AgentCapabilities, AgentsData } from '@/types';
import { DEFAULT_AGENT_CAPABILITIES } from '@/types';
import type { ResourceRef } from '@/types/resource';

const AGENTS_CACHE_TTL_MS = 30_000;

let cachedData: AgentsData | null = null;
let cachedWithPrompts: Agent[] | null = null;
let cacheTimestamp = 0;
let lastKnownAgentCount = 0;

export interface AgentMutationInput {
  name?: string;
  description?: string;
  systemPrompt?: string;
  icon?: string;
  capabilities?: AgentCapabilities;
  requiredParams?: string[];
  contextIds?: string[];
  defaultResources?: ResourceRef[];
  projectKey?: string;
  triggerHints?: string[];
  defaultProvider?: Agent['defaultProvider'];
  defaultModel?: string;
  contextStrategy?: 'additive' | 'exclusive';
}

export interface CreateAgentInput extends Required<Pick<AgentMutationInput, 'name'>> {
  description?: string;
  systemPrompt?: string;
  icon?: string;
  capabilities?: AgentCapabilities;
  requiredParams?: string[];
  contextIds?: string[];
  defaultResources?: ResourceRef[];
  projectKey?: string;
  triggerHints?: string[];
  defaultProvider?: Agent['defaultProvider'];
  defaultModel?: string;
  contextStrategy?: 'additive' | 'exclusive';
}

function normalizeOptionalString(value?: string): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizeOptionalList<T>(value?: T[]): T[] | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) && value.length > 0 ? value : undefined;
}

async function resolveDefaultCapabilities(): Promise<AgentCapabilities> {
  const settings = await getSettings();
  const exposeByDefault = settings.claude.defaultExposePromptPath !== false;
  return { ...DEFAULT_AGENT_CAPABILITIES, exposePromptPath: exposeByDefault };
}

export function invalidateAgentsCache(): void {
  cachedData = null;
  cachedWithPrompts = null;
  cacheTimestamp = 0;
}

export async function readAgentsData(): Promise<AgentsData> {
  const now = Date.now();
  if (cachedData && now - cacheTimestamp < AGENTS_CACHE_TTL_MS) {
    return cachedData;
  }

  // 必须在读取 registry.json 之前完成 V2 迁移，
  // 否则可能读到空文件 → 写入默认值 → 迁移跳过 → 旧数据丢失
  await ensureDataDirV2Migrated();

  // Ensure builtin defaults are loaded before merge
  await getDefaultAgents();

  const { data, changed: mergedChanged } = await mergeAndRepairAgentsData(
    await readJsonFile<AgentsData>(getAgentsPath(), { agents: [] }),
  );
  let changed = mergedChanged;

  for (const agent of data.agents) {
    if (agent.systemPrompt) {
      const existingFile = await readPromptFile(agent.id);
      if (!existingFile) {
        await writePromptFile(agent.id, agent.systemPrompt);
      }
      delete agent.systemPrompt;
      changed = true;
    }
  }

  if (changed) {
    await writeAgentsData(data);
  }

  lastKnownAgentCount = data.agents.length;
  cachedData = data;
  cacheTimestamp = Date.now();
  cachedWithPrompts = null;

  return data;
}

export async function writeAgentsData(data: AgentsData): Promise<void> {
  const newCount = data.agents.length;
  if (lastKnownAgentCount > DEFAULT_AGENTS.length && newCount <= DEFAULT_AGENTS.length) {
    console.error(
      `[agents] WRITE BLOCKED: agent count dropped from ${lastKnownAgentCount} to ${newCount}. ` +
      'This looks like data corruption. Refusing to overwrite agents.json.',
    );
    return;
  }

  await writeJsonFile(getAgentsPath(), data);
  invalidateAgentsCache();
}

export async function listAgents(options?: {
  includeArchived?: boolean;
  includePrompts?: boolean;
  projectKey?: string;
}): Promise<Agent[]> {
  const includeArchived = options?.includeArchived === true;
  const includePrompts = options?.includePrompts === true;
  const projectKey = options?.projectKey;
  const now = Date.now();

  if (includePrompts && cachedWithPrompts && now - cacheTimestamp < AGENTS_CACHE_TTL_MS) {
    return filterAgents(cachedWithPrompts, { includeArchived, projectKey });
  }

  const data = await readAgentsData();
  if (!includePrompts) {
    return filterAgents(data.agents, { includeArchived, projectKey });
  }

  const agentsWithPrompts = await Promise.all(
    data.agents.map(async (agent) => ({
      ...agent,
      systemPrompt: await resolveSystemPrompt(agent.id, agent.systemPrompt),
    })),
  );

  cachedWithPrompts = agentsWithPrompts;
  return filterAgents(agentsWithPrompts, { includeArchived, projectKey });
}

function filterAgents(
  agents: Agent[],
  options: { includeArchived: boolean; projectKey?: string },
): Agent[] {
  let filtered = options.includeArchived ? agents : agents.filter((agent) => !agent.archived);
  if (options.projectKey) {
    filtered = filtered.filter((agent) => !agent.projectKey || agent.projectKey === options.projectKey);
  }
  return filtered;
}

export async function getAgentById(
  id: string,
  options?: { includeArchived?: boolean; includePrompt?: boolean },
): Promise<Agent | undefined> {
  const agents = await listAgents({
    includeArchived: options?.includeArchived,
    includePrompts: options?.includePrompt,
  });
  return agents.find((agent) => agent.id === id);
}

export async function getAgentBySlug(
  slug: string,
  options?: { includeArchived?: boolean; includePrompt?: boolean },
): Promise<Agent | undefined> {
  const agents = await listAgents({
    includeArchived: options?.includeArchived,
    includePrompts: options?.includePrompt,
  });
  return agents.find((agent) => agent.slug === slug);
}

export async function createAgent(input: CreateAgentInput): Promise<Agent> {
  const promptText = normalizeOptionalString(input.systemPrompt);
  const now = new Date().toISOString();

  const agent: Agent = {
    id: `agent-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: input.name.trim(),
    description: normalizeOptionalString(input.description),
    icon: normalizeOptionalString(input.icon),
    capabilities: input.capabilities ?? await resolveDefaultCapabilities(),
    requiredParams: normalizeOptionalList(input.requiredParams),
    contextIds: normalizeOptionalList(input.contextIds),
    defaultResources: normalizeOptionalList(input.defaultResources),
    triggerHints: normalizeOptionalList(input.triggerHints),
    projectKey: normalizeOptionalString(input.projectKey),
    defaultProvider: input.defaultProvider || undefined,
    defaultModel: normalizeOptionalString(input.defaultModel),
    contextStrategy: input.contextStrategy || undefined,
    createdAt: now,
    updatedAt: now,
  };

  if (promptText) {
    await writePromptFile(agent.id, promptText);
  }

  const data = await readAgentsData();
  data.agents.push(agent);
  await writeAgentsData(data);

  return {
    ...agent,
    systemPrompt: promptText,
  };
}

export async function updateAgent(id: string, input: AgentMutationInput): Promise<Agent | undefined> {
  const data = await readAgentsData();
  const agent = data.agents.find((item) => item.id === id);
  if (!agent) {
    return undefined;
  }

  if (input.name !== undefined) agent.name = input.name.trim();
  if (input.description !== undefined) agent.description = normalizeOptionalString(input.description);
  if (input.icon !== undefined) agent.icon = normalizeOptionalString(input.icon);
  if (input.capabilities !== undefined) agent.capabilities = input.capabilities;
  if (input.requiredParams !== undefined) agent.requiredParams = normalizeOptionalList(input.requiredParams);
  if (input.contextIds !== undefined) agent.contextIds = normalizeOptionalList(input.contextIds);
  if (input.defaultResources !== undefined) agent.defaultResources = normalizeOptionalList(input.defaultResources);
  if (input.triggerHints !== undefined) agent.triggerHints = normalizeOptionalList(input.triggerHints);
  if (input.projectKey !== undefined) agent.projectKey = normalizeOptionalString(input.projectKey);
  if (input.defaultProvider !== undefined) agent.defaultProvider = input.defaultProvider || undefined;
  if (input.defaultModel !== undefined) agent.defaultModel = normalizeOptionalString(input.defaultModel);
  if (input.contextStrategy !== undefined) agent.contextStrategy = input.contextStrategy || undefined;

  if (input.systemPrompt !== undefined) {
    const promptText = input.systemPrompt.trim();
    if (promptText) {
      await writePromptFile(agent.id, promptText);
    } else {
      await deletePromptFile(agent.id);
    }
    delete agent.systemPrompt;
  }

  agent.updatedAt = new Date().toISOString();
  await writeAgentsData(data);

  return {
    ...agent,
    systemPrompt: await resolveSystemPrompt(agent.id, agent.systemPrompt),
  };
}

export async function archiveAgent(id: string): Promise<Agent | undefined> {
  const data = await readAgentsData();
  const agent = data.agents.find((item) => item.id === id);
  if (!agent) {
    return undefined;
  }

  agent.archived = true;
  agent.archivedAt = new Date().toISOString();
  agent.updatedAt = agent.archivedAt;
  await writeAgentsData(data);
  return agent;
}

export async function restoreAgent(id: string): Promise<Agent | undefined> {
  const data = await readAgentsData();
  const agent = data.agents.find((item) => item.id === id);
  if (!agent) {
    return undefined;
  }

  agent.archived = undefined;
  agent.archivedAt = undefined;
  agent.updatedAt = new Date().toISOString();
  await writeAgentsData(data);
  return agent;
}

export async function permanentlyDeleteAgent(id: string): Promise<Agent | undefined> {
  const data = await readAgentsData();
  const index = data.agents.findIndex((item) => item.id === id);
  if (index === -1) {
    return undefined;
  }

  const [agent] = data.agents.splice(index, 1);
  await writeAgentsData(data);
  await deletePromptFile(id);
  return agent;
}
