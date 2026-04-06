/**
 * 一次性迁移：将「全局」自定义 Agent（无 projectKey、非内置、未归档）转为运行预设并归档原 Agent。
 * 内置 Agent 不动。历史会话仍通过 agentId 引用已归档记录；新对话需选用仍活跃的 Agent。
 *
 * 标记文件：config/.migration-global-agents-to-presets-v1.json
 */

import { promises as fs } from 'fs';
import path from 'path';
import {
  ensureDataDirV2Migrated,
  getDataDir,
  readJsonFile,
  writeJsonFile,
  getSchedulesPath,
  getEventTriggersPath,
  readProjectIndex,
  writeProjectIndex,
} from '@/lib/file-store';
import { readAgentsData, archiveAgent, invalidateAgentsCache } from '@/lib/agents-store';
import { readPromptFile } from '@/lib/agent-prompt-store';
import { readAgentPresets, writeAgentPresets } from '@/lib/agent-presets-store';
import type { Agent, AgentPreset, AgentSchedulesData } from '@/types';
import type { EventTriggersData } from '@/types/event-trigger';
import { DEFAULT_AGENT_CAPABILITIES } from '@/types';

const MARKER = '.migration-global-agents-to-presets-v1.json';

function markerPath(): string {
  return path.join(getDataDir(), 'config', MARKER);
}

function newPresetId(): string {
  return `preset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function isGlobalCustomAgent(a: Agent): boolean {
  if (a.builtIn) return false;
  if (a.archived) return false;
  const pk = a.projectKey?.trim();
  return !pk;
}

function uniquePresetName(base: string, used: Set<string>): string {
  let n = base.trim() || 'preset';
  if (!used.has(n)) {
    used.add(n);
    return n;
  }
  let i = 2;
  while (used.has(`${n} (${i})`)) i += 1;
  const out = `${n} (${i})`;
  used.add(out);
  return out;
}

export async function ensureGlobalAgentsMigratedToPresets(): Promise<void> {
  await ensureDataDirV2Migrated();
  const mp = markerPath();
  try {
    await fs.access(mp);
    return;
  } catch {
    /* first run */
  }

  const data = await readAgentsData();
  const targets = data.agents.filter(isGlobalCustomAgent);
  const migratedIds: string[] = targets.map((t) => t.id);

  if (targets.length === 0) {
    await writeJsonFile(mp, { version: 1, migratedAt: new Date().toISOString(), agentIds: [], presetsCreated: 0 });
    return;
  }

  const presetsData = await readAgentPresets();
  const usedNames = new Set(presetsData.presets.map((p) => p.name));
  const now = new Date().toISOString();

  for (let i = 0; i < targets.length; i++) {
    const agent = targets[i]!;
    const prompt = await readPromptFile(agent.id);
    const skillIds = (agent.defaultResources ?? [])
      .filter((r) => r.type === 'skill')
      .map((r) => r.id);
    const capabilities: Agent['capabilities'] = {
      ...DEFAULT_AGENT_CAPABILITIES,
      ...(agent.capabilities ?? {}),
    };
    const preset: AgentPreset = {
      id: `preset-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 9)}`,
      name: uniquePresetName(agent.name, usedNames),
      description: agent.description,
      projectKey: undefined,
      icon: agent.icon,
      capabilities,
      defaultProvider: agent.defaultProvider,
      defaultModel: agent.defaultModel,
      defaultOpenAIReasoningEffort: agent.defaultOpenAIReasoningEffort,
      skillIds,
      contextStrategy: agent.contextStrategy,
      systemPrompt: prompt?.trim() ? prompt.trim() : undefined,
      createdAt: now,
      updatedAt: now,
    };
    presetsData.presets.push(preset);
  }

  await writeAgentPresets(presetsData);

  for (const agent of targets) {
    await archiveAgent(agent.id);
  }
  invalidateAgentsCache();

  const idx = await readProjectIndex();
  let projectsTouched = false;
  const idSet = new Set(migratedIds);
  for (const p of idx.projects) {
    if (p.defaultAgentId && idSet.has(p.defaultAgentId)) {
      delete p.defaultAgentId;
      p.updatedAt = new Date().toISOString();
      projectsTouched = true;
    }
  }
  if (projectsTouched) {
    await writeProjectIndex(idx);
  }

  try {
    const sched = await readJsonFile<AgentSchedulesData>(getSchedulesPath(), { schedules: [] });
    let sTouched = false;
    for (const s of sched.schedules) {
      if (s.targetType === 'agent_message' && s.agentId && idSet.has(s.agentId)) {
        s.enabled = false;
        s.updatedAt = new Date().toISOString();
        sTouched = true;
      }
    }
    if (sTouched) {
      await writeJsonFile(getSchedulesPath(), sched);
    }
  } catch {
    /* 无 schedules 文件 */
  }

  try {
    const trig = await readJsonFile<EventTriggersData>(getEventTriggersPath(), { triggers: [] });
    let tTouched = false;
    for (const tr of trig.triggers) {
      if (tr.action?.type === 'start_agent' && tr.action.agentId && idSet.has(tr.action.agentId)) {
        tr.enabled = false;
        tr.updatedAt = new Date().toISOString();
        tTouched = true;
      }
    }
    if (tTouched) {
      await writeJsonFile(getEventTriggersPath(), trig);
    }
  } catch {
    /* 无 triggers 文件 */
  }

  await writeJsonFile(mp, {
    version: 1,
    migratedAt: new Date().toISOString(),
    agentIds: migratedIds,
    presetsCreated: targets.length,
  });

  console.log(
    `[migration] global agents → presets: archived ${targets.length} agent(s), created ${targets.length} preset(s). Marker: ${MARKER}`,
  );
}
