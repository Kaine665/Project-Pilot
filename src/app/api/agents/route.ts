import { NextRequest, NextResponse } from 'next/server';
import {
  archiveAgent,
  createAgent,
  listAgents,
  updateAgent,
} from '@/lib/agents-store';

/** GET /api/agents - list agents. Excludes archived by default. */
export async function GET(request: NextRequest) {
  const includeArchived = request.nextUrl.searchParams.get('includeArchived') === 'true';
  const projectKey = request.nextUrl.searchParams.get('projectKey');

  const agents = await listAgents({
    includeArchived,
    includePrompts: true,
    projectKey: projectKey || undefined,
  });

  return NextResponse.json({ agents });
}

/** POST /api/agents - create a new agent. */
export async function POST(request: NextRequest) {
  const body = await request.json();
  if (!body.name?.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }

  const agent = await createAgent(body);
  return NextResponse.json({ ok: true, agent });
}

/** PATCH /api/agents - update an existing agent. Body: { id, ...fields } */
export async function PATCH(request: NextRequest) {
  const body = await request.json();
  const { id } = body;
  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }

  if (body.slug !== undefined || body.builtIn !== undefined) {
    return NextResponse.json({ error: 'Cannot modify slug or builtIn fields' }, { status: 403 });
  }

  const agent = await updateAgent(id, body);
  if (!agent) {
    return NextResponse.json({ error: 'agent not found' }, { status: 404 });
  }

  return NextResponse.json({ ok: true, agent });
}

/** DELETE /api/agents - soft-delete an agent (move to recycle bin). */
export async function DELETE(request: NextRequest) {
  const { id } = await request.json();
  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }

  const existing = await listAgents({ includeArchived: true, includePrompts: false });
  const agent = existing.find((item) => item.id === id);
  if (!agent) {
    return NextResponse.json({ error: 'agent not found' }, { status: 404 });
  }
  if (agent.builtIn) {
    return NextResponse.json({ error: 'Cannot delete a built-in agent' }, { status: 403 });
  }

  await archiveAgent(id);
  return NextResponse.json({ ok: true });
}
