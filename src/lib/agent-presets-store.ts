import {
  getAgentPresetsPath,
  readJsonFile,
  writeJsonFile,
  ensureDataDirV2Migrated,
} from '@/lib/file-store';
import { isValidProjectKey } from '@/lib/security';
import type {
  AgentCapabilities,
  AgentPreset,
  AgentPresetsData,
  OpenAIReasoningEffort,
  ProviderId,
} from '@/types';
import { DEFAULT_AGENT_CAPABILITIES } from '@/types';

const EMPTY: AgentPresetsData = { presets: [] };

function newPresetId(): string {
  return `preset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeCapabilities(raw: unknown): AgentCapabilities {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_AGENT_CAPABILITIES };
  }
  const o = raw as Record<string, unknown>;
  const base = { ...DEFAULT_AGENT_CAPABILITIES };
  (Object.keys(base) as (keyof AgentCapabilities)[]).forEach((k) => {
    if (typeof o[k] === 'boolean') base[k] = o[k];
  });
  return base;
}

function normalizeSkillIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    .map((s) => s.trim());
}

function normalizePresetRow(row: unknown): AgentPreset | null {
  if (!row || typeof row !== 'object') return null;
  const o = row as Record<string, unknown>;
  const id = typeof o.id === 'string' ? o.id.trim() : '';
  const name = typeof o.name === 'string' ? o.name.trim() : '';
  if (!id || !name) return null;
  const pk =
    o.projectKey === undefined || o.projectKey === null || o.projectKey === ''
      ? undefined
      : typeof o.projectKey === 'string' && isValidProjectKey(o.projectKey)
        ? o.projectKey
        : undefined;
  let defaultOpenAIReasoningEffort: OpenAIReasoningEffort | undefined;
  if (
    o.defaultOpenAIReasoningEffort === 'minimal' ||
    o.defaultOpenAIReasoningEffort === 'low' ||
    o.defaultOpenAIReasoningEffort === 'medium' ||
    o.defaultOpenAIReasoningEffort === 'high' ||
    o.defaultOpenAIReasoningEffort === 'xhigh'
  ) {
    defaultOpenAIReasoningEffort = o.defaultOpenAIReasoningEffort;
  }
  const contextStrategy =
    o.contextStrategy === 'exclusive' ? 'exclusive' : o.contextStrategy === 'additive' ? 'additive' : undefined;
  return {
    id,
    name,
    description: typeof o.description === 'string' && o.description.trim() ? o.description.trim() : undefined,
    projectKey: pk,
    icon: typeof o.icon === 'string' && o.icon.trim() ? o.icon.trim() : undefined,
    capabilities: normalizeCapabilities(o.capabilities),
    defaultProvider:
      typeof o.defaultProvider === 'string' && o.defaultProvider.trim()
        ? (o.defaultProvider.trim() as ProviderId)
        : undefined,
    defaultModel: typeof o.defaultModel === 'string' && o.defaultModel.trim() ? o.defaultModel.trim() : undefined,
    defaultOpenAIReasoningEffort,
    skillIds: normalizeSkillIds(o.skillIds),
    contextStrategy,
    systemPrompt:
      typeof o.systemPrompt === 'string' && o.systemPrompt.trim() ? o.systemPrompt.trim() : undefined,
    createdAt: typeof o.createdAt === 'string' && o.createdAt ? o.createdAt : new Date().toISOString(),
    updatedAt: typeof o.updatedAt === 'string' && o.updatedAt ? o.updatedAt : new Date().toISOString(),
  };
}

export async function readAgentPresets(): Promise<AgentPresetsData> {
  await ensureDataDirV2Migrated();
  const raw = await readJsonFile<unknown>(getAgentPresetsPath(), EMPTY);
  if (!raw || typeof raw !== 'object') return { presets: [] };
  const list = (raw as { presets?: unknown }).presets;
  if (!Array.isArray(list)) return { presets: [] };
  const presets = list.map(normalizePresetRow).filter((p): p is AgentPreset => p !== null);
  return { presets };
}

export async function writeAgentPresets(data: AgentPresetsData): Promise<void> {
  await ensureDataDirV2Migrated();
  await writeJsonFile(getAgentPresetsPath(), { presets: data.presets });
}

export async function createAgentPreset(
  input: Omit<AgentPreset, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<AgentPreset> {
  const now = new Date().toISOString();
  const preset: AgentPreset = {
    ...input,
    id: newPresetId(),
    capabilities: normalizeCapabilities(input.capabilities),
    skillIds: normalizeSkillIds(input.skillIds),
    createdAt: now,
    updatedAt: now,
  };
  const data = await readAgentPresets();
  data.presets.push(preset);
  await writeAgentPresets(data);
  return preset;
}

export async function updateAgentPreset(
  id: string,
  patch: Partial<Omit<AgentPreset, 'id' | 'createdAt'>>,
): Promise<AgentPreset | null> {
  const data = await readAgentPresets();
  const idx = data.presets.findIndex((p) => p.id === id);
  if (idx < 0) return null;
  const cur = data.presets[idx];
  const next: AgentPreset = {
    ...cur,
    ...patch,
    id: cur.id,
    createdAt: cur.createdAt,
    capabilities: patch.capabilities !== undefined ? normalizeCapabilities(patch.capabilities) : cur.capabilities,
    skillIds: patch.skillIds !== undefined ? normalizeSkillIds(patch.skillIds) : cur.skillIds,
    updatedAt: new Date().toISOString(),
  };
  data.presets[idx] = next;
  await writeAgentPresets(data);
  return next;
}

export async function deleteAgentPreset(id: string): Promise<boolean> {
  const data = await readAgentPresets();
  const before = data.presets.length;
  data.presets = data.presets.filter((p) => p.id !== id);
  if (data.presets.length === before) return false;
  await writeAgentPresets(data);
  return true;
}
