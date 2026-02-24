import { NextRequest, NextResponse } from 'next/server';
import { getAgentsPath, readJsonFile, writeJsonFile } from '@/lib/file-store';
import type { Agent, AgentsData } from '@/types';

async function readAgents(): Promise<AgentsData> {
  return readJsonFile<AgentsData>(getAgentsPath(), { agents: [] });
}

async function writeAgents(data: AgentsData): Promise<void> {
  await writeJsonFile(getAgentsPath(), data);
}

/** GET /api/agents — list all agents */
export async function GET() {
  const data = await readAgents();
  return NextResponse.json(data);
}

/** POST /api/agents — create a new agent */
export async function POST(request: NextRequest) {
  const { name, description, systemPrompt, icon } = await request.json();
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
  const { id, name, description, systemPrompt, icon } = await request.json();
  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
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
  agent.updatedAt = new Date().toISOString();

  await writeAgents(data);
  return NextResponse.json({ ok: true, agent });
}

/** DELETE /api/agents — delete an agent. Body: { id } */
export async function DELETE(request: NextRequest) {
  const { id } = await request.json();
  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }

  const data = await readAgents();
  const idx = data.agents.findIndex(a => a.id === id);
  if (idx === -1) {
    return NextResponse.json({ error: 'agent not found' }, { status: 404 });
  }

  data.agents.splice(idx, 1);
  await writeAgents(data);

  return NextResponse.json({ ok: true });
}
