import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import {
  getAgentsPath,
  getDimensionsPath,
  getFlowIndexPath,
  getFlowsDir,
  readJsonFile,
  ensureFlowsMigrated,
} from '@/lib/file-store';
import type { AgentsData, DimensionsData, ProjectIndex } from '@/types';

type RecycleBinCategory = 'project' | 'agent' | 'dimension';

/**
 * POST /api/recycle-bin/restore
 * Restore an archived item. Body: { category, id }
 */
export async function POST(request: NextRequest) {
  const { category, id } = await request.json();
  if (!category || !id) {
    return NextResponse.json({ error: 'category and id are required' }, { status: 400 });
  }

  switch (category as RecycleBinCategory) {
    case 'project': {
      await ensureFlowsMigrated();
      const raw = await fs.readFile(getFlowIndexPath(), 'utf-8').catch(() => '{"projects":[]}');
      const index: ProjectIndex = JSON.parse(raw);
      const project = index.projects.find(p => p.key === id);
      if (!project) return NextResponse.json({ error: 'not found' }, { status: 404 });

      project.archived = undefined;
      project.archivedAt = undefined;
      await fs.mkdir(getFlowsDir(), { recursive: true });
      await fs.writeFile(getFlowIndexPath(), JSON.stringify(index, null, 2), 'utf-8');
      break;
    }

    case 'agent': {
      const agentsData = await readJsonFile<AgentsData>(getAgentsPath(), { agents: [] });
      const agent = agentsData.agents.find(a => a.id === id);
      if (!agent) return NextResponse.json({ error: 'not found' }, { status: 404 });

      agent.archived = undefined;
      agent.archivedAt = undefined;
      agent.updatedAt = new Date().toISOString();
      await fs.writeFile(getAgentsPath(), JSON.stringify(agentsData, null, 2), 'utf-8');
      break;
    }

    case 'dimension': {
      const dimData = await readJsonFile<DimensionsData>(getDimensionsPath(), { dimensions: [] });
      const dimension = dimData.dimensions.find(d => d.id === id);
      if (!dimension) return NextResponse.json({ error: 'not found' }, { status: 404 });

      dimension.archived = undefined;
      dimension.archivedAt = undefined;
      dimension.updatedAt = new Date().toISOString();
      await fs.writeFile(getDimensionsPath(), JSON.stringify(dimData, null, 2), 'utf-8');
      break;
    }

    default:
      return NextResponse.json({ error: 'invalid category' }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
