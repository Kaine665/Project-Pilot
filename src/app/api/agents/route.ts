import { NextRequest, NextResponse } from 'next/server';
import { getAgentsPath, readJsonFile, writeJsonFile } from '@/lib/file-store';
import { DEFAULT_AGENTS } from '@/lib/default-agents';
import type { Agent, AgentCapabilities, AgentsData } from '@/types';
import { DEFAULT_AGENT_CAPABILITIES } from '@/types';

async function readAgents(): Promise<AgentsData> {
  const data = await readJsonFile<AgentsData>(getAgentsPath(), { agents: [] });
  // ── 内置 Agent 字段迁移 ──
  // 磁盘上的 agents.json 可能是旧版本写入的，缺少后来新增的字段（如 capabilities）。
  // 必须在每次读取时将 DEFAULT_AGENTS 的新字段合并进来，否则下游（settings-manager
  // 的 buildAgentPermissionArgs 等）会回退到 DEFAULT_AGENT_CAPABILITIES，导致
  // skipReview=false → Claude 进程缺少 --dangerously-skip-permissions → 非交互模式卡死。
  // 同样的合并逻辑在 agent-chat-manager.ts 的 start() 中也有一份（运行时双保险）。
  let changed = false;
  for (const defaultAgent of DEFAULT_AGENTS) {
    const existing = data.agents.find(a => a.id === defaultAgent.id);
    if (!existing) {
      data.agents.unshift(defaultAgent);
      changed = true;
    } else {
      // Merge missing fields from default (e.g. capabilities added later)
      for (const key of Object.keys(defaultAgent) as Array<keyof Agent>) {
        if (existing[key] === undefined && defaultAgent[key] !== undefined) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (existing as any)[key] = defaultAgent[key];
          changed = true;
        }
      }
    }
  }
  if (changed) {
    await writeAgents(data);
  }
  return data;
}

async function writeAgents(data: AgentsData): Promise<void> {
  await writeJsonFile(getAgentsPath(), data);
}

/** GET /api/agents — list all agents (excludes archived by default) */
export async function GET(request: NextRequest) {
  const data = await readAgents();
  const includeArchived = request.nextUrl.searchParams.get('includeArchived') === 'true';
  const agents = includeArchived ? data.agents : data.agents.filter(a => !a.archived);
  return NextResponse.json({ agents });
}

/** POST /api/agents — create a new agent */
export async function POST(request: NextRequest) {
  const { name, description, systemPrompt, icon, capabilities, requiredParams } = await request.json();
  if (!name?.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }

  const now = new Date().toISOString();
  const agent: Agent = {
    id: `agent-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: name.trim(),
    description: description?.trim() || undefined,
    systemPrompt: systemPrompt?.trim() || undefined,
    icon: icon?.trim() || undefined,
    capabilities: capabilities ?? { ...DEFAULT_AGENT_CAPABILITIES },
    requiredParams: Array.isArray(requiredParams) && requiredParams.length > 0 ? requiredParams : undefined,
    createdAt: now,
    updatedAt: now,
  };

  const data = await readAgents();
  data.agents.push(agent);
  await writeAgents(data);

  return NextResponse.json({ ok: true, agent });
}

/** PATCH /api/agents — update an agent. Body: { id, ...fields } */
export async function PATCH(request: NextRequest) {
  const body = await request.json();
  const { id, name, description, systemPrompt, icon, capabilities, requiredParams } = body;
  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }

  // Reject attempts to modify immutable fields
  if (body.slug !== undefined || body.builtIn !== undefined) {
    return NextResponse.json({ error: 'Cannot modify slug or builtIn fields' }, { status: 403 });
  }

  const data = await readAgents();
  const agent = data.agents.find(a => a.id === id);
  if (!agent) {
    return NextResponse.json({ error: 'agent not found' }, { status: 404 });
  }

  if (name !== undefined) agent.name = name.trim();
  if (description !== undefined) agent.description = description.trim() || undefined;
  if (systemPrompt !== undefined) agent.systemPrompt = systemPrompt.trim() || undefined;
  if (icon !== undefined) agent.icon = icon.trim() || undefined;
  if (capabilities !== undefined) agent.capabilities = capabilities as AgentCapabilities;
  if (requiredParams !== undefined) agent.requiredParams = Array.isArray(requiredParams) && requiredParams.length > 0 ? requiredParams : undefined;
  agent.updatedAt = new Date().toISOString();

  await writeAgents(data);
  return NextResponse.json({ ok: true, agent });
}

/** DELETE /api/agents — soft-delete an agent (move to recycle bin). Body: { id } */
export async function DELETE(request: NextRequest) {
  const { id } = await request.json();
  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }

  const data = await readAgents();
  const agent = data.agents.find(a => a.id === id);
  if (!agent) {
    return NextResponse.json({ error: 'agent not found' }, { status: 404 });
  }

  if (agent.builtIn) {
    return NextResponse.json({ error: 'Cannot delete a built-in agent' }, { status: 403 });
  }

  agent.archived = true;
  agent.archivedAt = new Date().toISOString();
  agent.updatedAt = new Date().toISOString();
  await writeAgents(data);

  return NextResponse.json({ ok: true });
}
