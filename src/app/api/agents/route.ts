import { NextRequest, NextResponse } from 'next/server';
import { getAgentsPath, readJsonFile, writeJsonFile } from '@/lib/file-store';
import { DEFAULT_AGENTS } from '@/lib/default-agents';
import type { Agent, AgentCapabilities, AgentsData } from '@/types';
import { DEFAULT_AGENT_CAPABILITIES } from '@/types';

async function readAgents(): Promise<AgentsData> {
  const data = await readJsonFile<AgentsData>(getAgentsPath(), { agents: [] });
  // Ensure built-in agents exist (idempotent)
  let changed = false;
  for (const defaultAgent of DEFAULT_AGENTS) {
    if (!data.agents.some(a => a.id === defaultAgent.id)) {
      data.agents.unshift(defaultAgent);
      changed = true;
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
  const { name, description, systemPrompt, icon, capabilities } = await request.json();
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
  const { id, name, description, systemPrompt, icon, capabilities } = body;
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
