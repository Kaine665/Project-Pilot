import { NextRequest, NextResponse } from 'next/server';
import { getAgentTeamsPath, readJsonFile, writeJsonFile } from '@/lib/file-store';
import type { AgentTeam, AgentTeamsData } from '@/types/agent-team';

const DEFAULT_DATA: AgentTeamsData = { teams: [] };

async function readTeams(): Promise<AgentTeamsData> {
  return readJsonFile<AgentTeamsData>(getAgentTeamsPath(), DEFAULT_DATA);
}

// ── GET: 列出所有 Team ──

export async function GET(request: NextRequest) {
  try {
    const includeArchived = request.nextUrl.searchParams.get('includeArchived') === 'true';
    const data = await readTeams();
    const teams = includeArchived ? data.teams : data.teams.filter(t => !t.archived);
    return NextResponse.json({ teams });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ── POST: 创建 Team ──

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, description, members, conflictPolicy } = body;

    if (!name?.trim()) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }
    if (!Array.isArray(members) || members.length === 0) {
      return NextResponse.json({ error: 'members must be a non-empty array' }, { status: 400 });
    }

    const now = new Date().toISOString();
    const team: AgentTeam = {
      id: `team-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: name.trim(),
      description: description?.trim() || undefined,
      members,
      conflictPolicy: conflictPolicy || undefined,
      createdAt: now,
      updatedAt: now,
    };

    const data = await readTeams();
    data.teams.push(team);
    await writeJsonFile(getAgentTeamsPath(), data);

    return NextResponse.json({ ok: true, team });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ── PATCH: 更新 Team ──

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, ...fields } = body;

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    const data = await readTeams();
    const team = data.teams.find(t => t.id === id);
    if (!team) {
      return NextResponse.json({ error: 'team not found' }, { status: 404 });
    }

    if (fields.name !== undefined) team.name = fields.name.trim();
    if (fields.description !== undefined) team.description = fields.description?.trim() || undefined;
    if (fields.members !== undefined) team.members = fields.members;
    if (fields.conflictPolicy !== undefined) team.conflictPolicy = fields.conflictPolicy;

    team.updatedAt = new Date().toISOString();
    await writeJsonFile(getAgentTeamsPath(), data);

    return NextResponse.json({ ok: true, team });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ── DELETE: 归档 Team（软删除） ──

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const { id } = body;

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    const data = await readTeams();
    const team = data.teams.find(t => t.id === id);
    if (!team) {
      return NextResponse.json({ error: 'team not found' }, { status: 404 });
    }

    team.archived = true;
    team.archivedAt = new Date().toISOString();
    team.updatedAt = new Date().toISOString();
    await writeJsonFile(getAgentTeamsPath(), data);

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
