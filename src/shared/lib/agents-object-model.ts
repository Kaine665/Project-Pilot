/**
 * agents/definitions + bindings + statuses → 运行时 Agent 列表（与旧 registry.json 等价）
 */

import { promises as fs } from 'fs';
import path from 'path';
import type { Agent, AgentStatus, AgentsData } from '@/types';
import {
  getAgentsBindingsDir,
  getAgentsDefinitionsDir,
  getAgentsPath,
  getAgentsStatusesDir,
  readJsonFile,
  writeJsonFile,
} from './file-store';

interface BindingDisk {
  id: string;
  agentId: string;
  targetType: string;
  projectKey?: string;
}

interface StatusDisk {
  agentId: string;
  state: AgentStatus['state'];
  lastActiveAt?: string;
  lastSessionId?: string;
  lastError?: string;
  updatedAt?: string;
}

export async function definitionsDirHasAgents(): Promise<boolean> {
  const dir = getAgentsDefinitionsDir();
  try {
    const names = await fs.readdir(dir);
    return names.some((n) => n.endsWith('.json'));
  } catch {
    return false;
  }
}

async function loadBindingsByAgent(): Promise<Map<string, BindingDisk[]>> {
  const dir = getAgentsBindingsDir();
  const map = new Map<string, BindingDisk[]>();
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return map;
  }
  for (const name of names) {
    if (!name.endsWith('.json') || !name.startsWith('binding-')) continue;
    const b = await readJsonFile<BindingDisk | null>(path.join(dir, name), null);
    if (b?.agentId) {
      const list = map.get(b.agentId) ?? [];
      list.push(b);
      map.set(b.agentId, list);
    }
  }
  return map;
}

function pickProjectKey(bindings: BindingDisk[] | undefined): string | undefined {
  if (!bindings?.length) return undefined;
  const projectOnes = bindings.filter((b) => b.targetType === 'project' && b.projectKey?.trim());
  if (projectOnes.length) {
    projectOnes.sort((a, b) => a.id.localeCompare(b.id));
    return projectOnes[0].projectKey!.trim();
  }
  return undefined;
}

async function loadStatus(agentId: string): Promise<AgentStatus | undefined> {
  const p = path.join(getAgentsStatusesDir(), `${agentId.replace(/[^a-zA-Z0-9_-]/g, '')}.json`);
  const s = await readJsonFile<StatusDisk | null>(p, null);
  if (!s?.state) return undefined;
  return {
    state: s.state,
    lastActiveAt: s.lastActiveAt,
    lastSessionId: s.lastSessionId,
    lastError: s.lastError,
  };
}

export async function loadAgentsFromObjectModel(): Promise<AgentsData> {
  const defDir = getAgentsDefinitionsDir();
  let names: string[];
  try {
    names = await fs.readdir(defDir);
  } catch {
    return { agents: [] };
  }
  const bindings = await loadBindingsByAgent();
  const agents: Agent[] = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const raw = await readJsonFile<Agent | null>(path.join(defDir, name), null);
    if (!raw?.id) continue;
    const projectKey = pickProjectKey(bindings.get(raw.id));
    const agentStatus = await loadStatus(raw.id);
    agents.push({
      ...raw,
      projectKey: projectKey ?? raw.projectKey,
      agentStatus: agentStatus ?? raw.agentStatus,
    });
  }
  agents.sort((a, b) => a.id.localeCompare(b.id));
  return { agents };
}

function stripForDefinition(agent: Agent): Record<string, unknown> {
  const {
    agentStatus: _s,
    systemPrompt: _p,
    ...rest
  } = agent;
  const out = { ...rest } as Record<string, unknown>;
  delete out.projectKey;
  return out;
}

async function writeBindingForAgent(agent: Agent, now: string): Promise<void> {
  const dir = getAgentsBindingsDir();
  await fs.mkdir(dir, { recursive: true });
  const safeId = agent.id.replace(/[^a-zA-Z0-9_-]/g, '');
  if (agent.projectKey?.trim()) {
    const pk = agent.projectKey.replace(/[^a-zA-Z0-9_-]/g, '');
    const bid = `binding-${safeId}--project-${pk}`;
    const pathFile = path.join(dir, `${bid}.json`);
    await writeJsonFile(pathFile, {
      id: bid,
      agentId: agent.id,
      targetType: 'project',
      projectKey: agent.projectKey.trim(),
      createdAt: now,
      updatedAt: now,
    });
  } else {
    const bid = `binding-${safeId}--global`;
    const pathFile = path.join(dir, `${bid}.json`);
    await writeJsonFile(pathFile, {
      id: bid,
      agentId: agent.id,
      targetType: 'global',
      createdAt: now,
      updatedAt: now,
    });
  }
}

async function writeStatusForAgent(agent: Agent, now: string): Promise<void> {
  if (!agent.agentStatus) return;
  const dir = getAgentsStatusesDir();
  await fs.mkdir(dir, { recursive: true });
  const safeId = agent.id.replace(/[^a-zA-Z0-9_-]/g, '');
  await writeJsonFile(path.join(dir, `${safeId}.json`), {
    agentId: agent.id,
    state: agent.agentStatus.state,
    lastActiveAt: agent.agentStatus.lastActiveAt,
    lastSessionId: agent.agentStatus.lastSessionId,
    lastError: agent.agentStatus.lastError,
    updatedAt: now,
  });
}

export async function saveAgentsToObjectModel(data: AgentsData): Promise<void> {
  const defDir = getAgentsDefinitionsDir();
  await fs.mkdir(defDir, { recursive: true });
  const keep = new Set(data.agents.map((a) => a.id.replace(/[^a-zA-Z0-9_-]/g, '')));
  try {
    const existing = await fs.readdir(defDir);
    for (const f of existing) {
      if (!f.endsWith('.json')) continue;
      const id = f.replace(/\.json$/, '');
      if (!keep.has(id)) {
        await fs.unlink(path.join(defDir, f)).catch(() => {});
      }
    }
  } catch {
    /* ok */
  }

  const bindDir = getAgentsBindingsDir();
  try {
    const bFiles = await fs.readdir(bindDir);
    for (const f of bFiles) {
      if (!f.startsWith('binding-') || !f.endsWith('.json')) continue;
      const m = f.match(/^binding-(.+)--(?:global|project-.+)\.json$/);
      if (!m) continue;
      const sid = m[1]!.replace(/[^a-zA-Z0-9_-]/g, '');
      if (!keep.has(sid)) {
        await fs.unlink(path.join(bindDir, f)).catch(() => {});
      }
    }
  } catch {
    /* ok */
  }

  const stDir = getAgentsStatusesDir();
  try {
    const stFiles = await fs.readdir(stDir);
    for (const f of stFiles) {
      if (!f.endsWith('.json')) continue;
      const id = f.replace(/\.json$/, '');
      if (!keep.has(id)) {
        await fs.unlink(path.join(stDir, f)).catch(() => {});
      }
    }
  } catch {
    /* ok */
  }
  const now = new Date().toISOString();
  for (const agent of data.agents) {
    const body = stripForDefinition(agent);
    await writeJsonFile(path.join(defDir, `${agent.id.replace(/[^a-zA-Z0-9_-]/g, '')}.json`), body);
    await writeBindingForAgent(agent, now);
    await writeStatusForAgent(agent, now);
  }
}

export async function shouldUseAgentsObjectModel(): Promise<boolean> {
  if (await definitionsDirHasAgents()) return true;
  try {
    await fs.stat(getAgentsPath());
    return false;
  } catch {
    return true;
  }
}
