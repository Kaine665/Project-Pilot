import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import {
  getAgentsPath,
  getDimensionsPath,
  getFlowIndexPath,
  getFlowDataPath,
  getFlowsDir,
  readJsonFile,
  writeJsonFile,
  ensureDataDirV2Migrated,
} from '@/lib/file-store';
import { deletePromptFile } from '@/lib/agent-prompt-store';
import { invalidateAgentsCache } from '@/lib/agents-store';
import type { AgentsData, DimensionsData, ProjectIndex } from '@/types';

type RecycleBinCategory = 'project' | 'agent' | 'dimension';

interface RecycleBinItem {
  category: RecycleBinCategory;
  id: string;
  name: string;
  archivedAt: string;
}

/**
 * GET /api/recycle-bin
 * List all archived items across project / agent / dimension.
 */
export async function GET() {
  await ensureDataDirV2Migrated();

  const [agentsData, dimensionsData, projectIndex] = await Promise.all([
    readJsonFile<AgentsData>(getAgentsPath(), { agents: [] }),
    readJsonFile<DimensionsData>(getDimensionsPath(), { dimensions: [] }),
    readJsonFile<ProjectIndex>(getFlowIndexPath(), { projects: [] }),
  ]);

  const items: RecycleBinItem[] = [];

  for (const p of projectIndex.projects) {
    if (p.archived) {
      items.push({ category: 'project', id: p.key, name: p.name, archivedAt: p.archivedAt ?? '' });
    }
  }

  for (const a of agentsData.agents) {
    if (a.archived) {
      items.push({ category: 'agent', id: a.id, name: a.name, archivedAt: a.archivedAt ?? '' });
    }
  }

  for (const d of dimensionsData.dimensions) {
    if (d.archived) {
      items.push({ category: 'dimension', id: d.id, name: d.name, archivedAt: d.archivedAt ?? '' });
    }
  }

  // Sort by archivedAt descending (most recent first)
  items.sort((a, b) => (b.archivedAt || '').localeCompare(a.archivedAt || ''));

  return NextResponse.json({ items });
}

/**
 * DELETE /api/recycle-bin
 * Permanently delete an item. Body: { category, id }
 */
export async function DELETE(request: NextRequest) {
  const { category, id } = await request.json();
  if (!category || !id) {
    return NextResponse.json({ error: 'category and id are required' }, { status: 400 });
  }

  switch (category as RecycleBinCategory) {
    case 'project': {
      await ensureDataDirV2Migrated();
      const raw = await fs.readFile(getFlowIndexPath(), 'utf-8').catch(() => '{"projects":[]}');
      const index: ProjectIndex = JSON.parse(raw);
      const idx = index.projects.findIndex(p => p.key === id);
      if (idx === -1) return NextResponse.json({ error: 'not found' }, { status: 404 });

      index.projects.splice(idx, 1);
      await writeJsonFile(getFlowIndexPath(), index);

      // Delete flow data file
      const safe = (id as string).replace(/[^a-zA-Z0-9_-]/g, '');
      if (safe) {
        await fs.unlink(getFlowDataPath(safe)).catch(() => {});
      }
      break;
    }

    case 'agent': {
      const agentsData = await readJsonFile<AgentsData>(getAgentsPath(), { agents: [] });
      const idx = agentsData.agents.findIndex(a => a.id === id);
      if (idx === -1) return NextResponse.json({ error: 'not found' }, { status: 404 });
      if (agentsData.agents[idx].builtIn) {
        return NextResponse.json({ error: 'Cannot permanently delete a built-in agent' }, { status: 403 });
      }
      agentsData.agents.splice(idx, 1);
      await writeJsonFile(getAgentsPath(), agentsData);
      invalidateAgentsCache();
      // 清理外置的 prompt 文件
      await deletePromptFile(id);
      break;
    }

    case 'dimension': {
      const dimData = await readJsonFile<DimensionsData>(getDimensionsPath(), { dimensions: [] });
      const idx = dimData.dimensions.findIndex(d => d.id === id);
      if (idx === -1) return NextResponse.json({ error: 'not found' }, { status: 404 });
      dimData.dimensions.splice(idx, 1);
      await writeJsonFile(getDimensionsPath(), dimData);
      break;
    }

    default:
      return NextResponse.json({ error: 'invalid category' }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
