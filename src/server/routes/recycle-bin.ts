import { Hono } from 'hono';
import fsPromises from 'fs/promises';
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

const app = new Hono();

type RecycleBinCategory = 'project' | 'agent' | 'dimension';

interface RecycleBinItem {
  category: RecycleBinCategory;
  id: string;
  name: string;
  archivedAt: string;
}

// ---------------------------------------------------------------------------
// GET / — List all archived items
// ---------------------------------------------------------------------------

app.get('/', async (c) => {
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

  items.sort((a, b) => (b.archivedAt || '').localeCompare(a.archivedAt || ''));

  return c.json({ items });
});

// ---------------------------------------------------------------------------
// DELETE / — Permanently delete an item
// ---------------------------------------------------------------------------

app.delete('/', async (c) => {
  const { category, id } = await c.req.json();
  if (!category || !id) {
    return c.json({ error: 'category and id are required' }, 400);
  }

  switch (category as RecycleBinCategory) {
    case 'project': {
      await ensureDataDirV2Migrated();
      const raw = await fsPromises.readFile(getFlowIndexPath(), 'utf-8').catch(() => '{"projects":[]}');
      const index: ProjectIndex = JSON.parse(raw);
      const idx = index.projects.findIndex(p => p.key === id);
      if (idx === -1) return c.json({ error: 'not found' }, 404);

      index.projects.splice(idx, 1);
      await writeJsonFile(getFlowIndexPath(), index);

      const safe = (id as string).replace(/[^a-zA-Z0-9_-]/g, '');
      if (safe) {
        await fsPromises.unlink(getFlowDataPath(safe)).catch(() => {});
      }
      break;
    }

    case 'agent': {
      const agentsData = await readJsonFile<AgentsData>(getAgentsPath(), { agents: [] });
      const idx = agentsData.agents.findIndex(a => a.id === id);
      if (idx === -1) return c.json({ error: 'not found' }, 404);
      if (agentsData.agents[idx].builtIn) {
        return c.json({ error: 'Cannot permanently delete a built-in agent' }, 403);
      }
      agentsData.agents.splice(idx, 1);
      await writeJsonFile(getAgentsPath(), agentsData);
      invalidateAgentsCache();
      await deletePromptFile(id);
      break;
    }

    case 'dimension': {
      const dimData = await readJsonFile<DimensionsData>(getDimensionsPath(), { dimensions: [] });
      const idx = dimData.dimensions.findIndex(d => d.id === id);
      if (idx === -1) return c.json({ error: 'not found' }, 404);
      dimData.dimensions.splice(idx, 1);
      await writeJsonFile(getDimensionsPath(), dimData);
      break;
    }

    default:
      return c.json({ error: 'invalid category' }, 400);
  }

  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// POST /restore — Restore an archived item
// ---------------------------------------------------------------------------

app.post('/restore', async (c) => {
  const { category, id } = await c.req.json();
  if (!category || !id) {
    return c.json({ error: 'category and id are required' }, 400);
  }

  switch (category as RecycleBinCategory) {
    case 'project': {
      await ensureDataDirV2Migrated();
      const index = await readJsonFile<ProjectIndex>(getFlowIndexPath(), { projects: [] });
      const project = index.projects.find(p => p.key === id);
      if (!project) return c.json({ error: 'not found' }, 404);

      project.archived = undefined;
      project.archivedAt = undefined;
      await writeJsonFile(getFlowIndexPath(), index);
      break;
    }

    case 'agent': {
      const agentsData = await readJsonFile<AgentsData>(getAgentsPath(), { agents: [] });
      const agent = agentsData.agents.find(a => a.id === id);
      if (!agent) return c.json({ error: 'not found' }, 404);

      agent.archived = undefined;
      agent.archivedAt = undefined;
      agent.updatedAt = new Date().toISOString();
      await writeJsonFile(getAgentsPath(), agentsData);
      invalidateAgentsCache();
      break;
    }

    case 'dimension': {
      const dimData = await readJsonFile<DimensionsData>(getDimensionsPath(), { dimensions: [] });
      const dimension = dimData.dimensions.find(d => d.id === id);
      if (!dimension) return c.json({ error: 'not found' }, 404);

      dimension.archived = undefined;
      dimension.archivedAt = undefined;
      dimension.updatedAt = new Date().toISOString();
      await writeJsonFile(getDimensionsPath(), dimData);
      break;
    }

    default:
      return c.json({ error: 'invalid category' }, 400);
  }

  return c.json({ ok: true });
});

export default app;
