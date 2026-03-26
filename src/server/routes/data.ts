import { Hono } from 'hono';
import {
  readProjectIndex,
  writeProjectIndex,
  readInbox,
  writeInbox,
  ensureDataDirV2Migrated,
} from '@/lib/file-store';
import type { ProjectEntry, ProjectIndex, InboxItem } from '@/types';

const app = new Hono();

// ---------------------------------------------------------------------------
// /api/data/projects
// ---------------------------------------------------------------------------

async function readIndex(): Promise<ProjectIndex> {
  await ensureDataDirV2Migrated();
  return readProjectIndex();
}

async function writeIndex(index: ProjectIndex): Promise<void> {
  await writeProjectIndex(index);
}

app.get('/projects', async (c) => {
  const index = await readIndex();
  const includeArchived = c.req.query('includeArchived') === 'true';
  const projects = includeArchived
    ? index.projects
    : index.projects.filter((p) => !p.archived);
  return c.json({ projects });
});

app.post('/projects', async (c) => {
  const body = await c.req.json();
  const { key, name, path: projectPath, ...rest } = body;
  if (!key || !name) {
    return c.json({ error: 'key and name are required' }, 400);
  }

  const safe = (key as string).replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safe) {
    return c.json({ error: 'invalid key' }, 400);
  }

  const index = await readIndex();
  if (index.projects.some((p) => p.key === safe)) {
    return c.json({ error: 'project already exists' }, 409);
  }

  const now = new Date().toISOString();
  const entry: ProjectEntry = {
    key: safe,
    name,
    createdAt: now,
    updatedAt: now,
  };

  if (projectPath) entry.path = projectPath;
  if (rest.description) entry.description = rest.description;
  if (rest.location) entry.location = rest.location;
  if (rest.techStack) entry.techStack = rest.techStack;
  if (rest.icon) entry.icon = rest.icon;
  if (rest.color) entry.color = rest.color;
  if (rest.tags && Array.isArray(rest.tags)) entry.tags = rest.tags;
  if (rest.repository) entry.repository = rest.repository;
  if (rest.devServer) entry.devServer = rest.devServer;
  if (rest.access) entry.access = rest.access;

  index.projects.push(entry);
  await writeIndex(index);

  return c.json({ ok: true, key: safe });
});

app.patch('/projects', async (c) => {
  const body = await c.req.json();

  // Mode 2: Reorder
  if (Array.isArray(body.order)) {
    const order: string[] = body.order;
    const index = await readIndex();
    const byKey = new Map(index.projects.map((p) => [p.key, p]));
    const reordered: ProjectEntry[] = [];
    for (const k of order) {
      const p = byKey.get(k);
      if (p) {
        reordered.push(p);
        byKey.delete(k);
      }
    }
    for (const p of byKey.values()) {
      reordered.push(p);
    }
    index.projects = reordered;
    await writeIndex(index);
    return c.json({ ok: true });
  }

  // Mode 1: Update metadata
  const { key, ...updates } = body;
  if (!key) {
    return c.json({ error: 'key is required' }, 400);
  }

  const index = await readIndex();
  const project = index.projects.find((p) => p.key === key);
  if (!project) {
    return c.json({ error: 'project not found' }, 404);
  }

  const simpleFields = [
    'name', 'description', 'location', 'path', 'techStack', 'icon', 'color', 'defaultAgentId',
  ] as const;
  for (const field of simpleFields) {
    if (updates[field] !== undefined) {
      if (updates[field] === '' || updates[field] === null) {
        delete (project as unknown as Record<string, unknown>)[field];
      } else {
        (project as unknown as Record<string, unknown>)[field] = updates[field];
      }
    }
  }

  if (updates.tags !== undefined) {
    if (Array.isArray(updates.tags) && updates.tags.length > 0) {
      project.tags = updates.tags;
    } else {
      delete project.tags;
    }
  }

  if (updates.repository !== undefined) {
    if (updates.repository === null) {
      delete project.repository;
    } else {
      project.repository = { ...project.repository, ...updates.repository };
      for (const [k, v] of Object.entries(project.repository!)) {
        if (v === '' || v === null) delete (project.repository as Record<string, unknown>)[k];
      }
      if (Object.keys(project.repository!).length === 0) delete project.repository;
    }
  }

  if (updates.devServer !== undefined) {
    if (updates.devServer === null) {
      delete project.devServer;
    } else {
      project.devServer = { ...project.devServer, ...updates.devServer };
      for (const [k, v] of Object.entries(project.devServer!)) {
        if (v === '' || v === null) delete (project.devServer as Record<string, unknown>)[k];
      }
      if (Object.keys(project.devServer!).length === 0) delete project.devServer;
    }
  }

  if (updates.access !== undefined) {
    if (updates.access === null) {
      delete project.access;
    } else {
      project.access = { ...project.access, ...updates.access };
      for (const [k, v] of Object.entries(project.access!)) {
        if (v === '' || v === null) delete (project.access as Record<string, unknown>)[k];
      }
      if (Object.keys(project.access!).length === 0) delete project.access;
    }
  }

  project.updatedAt = new Date().toISOString();
  await writeIndex(index);

  return c.json({ ok: true });
});

app.delete('/projects', async (c) => {
  const { key } = await c.req.json();
  if (!key) {
    return c.json({ error: 'key is required' }, 400);
  }

  const index = await readIndex();
  const project = index.projects.find((p) => p.key === key);
  if (!project) {
    return c.json({ error: 'project not found' }, 404);
  }

  project.archived = true;
  project.archivedAt = new Date().toISOString();
  await writeIndex(index);

  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// /api/data/inbox
// ---------------------------------------------------------------------------

function sanitizeKey(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, '');
}

function getProjectKey(c: { req: { query: (k: string) => string | undefined } }): string | null {
  const raw = c.req.query('project');
  if (!raw) return null;
  const safe = sanitizeKey(raw);
  return safe || null;
}

function generateInboxId(): string {
  return `inbox-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

app.get('/inbox', async (c) => {
  try {
    const projectKey = getProjectKey(c);
    if (!projectKey) {
      return c.json({ error: 'project query parameter is required' }, 400);
    }
    const inbox = await readInbox(projectKey);
    return c.json(inbox);
  } catch (error) {
    console.error('[inbox GET]', error);
    return c.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      500,
    );
  }
});

app.post('/inbox', async (c) => {
  try {
    const projectKey = getProjectKey(c);
    if (!projectKey) {
      return c.json({ error: 'project query parameter is required' }, 400);
    }

    const body = await c.req.json();
    const { content } = body;
    if (!content || typeof content !== 'string') {
      return c.json({ error: 'content is required and must be a string' }, 400);
    }

    const now = new Date().toISOString();
    const item: InboxItem = {
      id: generateInboxId(),
      content: content.trim(),
      createdAt: now,
      status: 'inbox',
    };

    const inbox = await readInbox(projectKey);
    inbox.items.push(item);
    await writeInbox(projectKey, inbox);

    return c.json(item, 201);
  } catch (error) {
    console.error('[inbox POST]', error);
    return c.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      500,
    );
  }
});

app.patch('/inbox', async (c) => {
  try {
    const projectKey = getProjectKey(c);
    if (!projectKey) {
      return c.json({ error: 'project query parameter is required' }, 400);
    }

    const body = await c.req.json();
    const { id, content, status, archivedTo } = body;
    if (!id || typeof id !== 'string') {
      return c.json({ error: 'id is required' }, 400);
    }

    const inbox = await readInbox(projectKey);
    const item = inbox.items.find((i) => i.id === id);
    if (!item) {
      return c.json({ error: 'item not found' }, 404);
    }

    if (content !== undefined) item.content = content;
    if (status !== undefined) item.status = status;
    if (archivedTo !== undefined) item.archivedTo = archivedTo;

    await writeInbox(projectKey, inbox);
    return c.json(item);
  } catch (error) {
    console.error('[inbox PATCH]', error);
    return c.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      500,
    );
  }
});

app.delete('/inbox', async (c) => {
  try {
    const projectKey = getProjectKey(c);
    if (!projectKey) {
      return c.json({ error: 'project query parameter is required' }, 400);
    }

    const itemId = c.req.query('id');
    if (!itemId) {
      return c.json({ error: 'id query parameter is required' }, 400);
    }

    const inbox = await readInbox(projectKey);
    const idx = inbox.items.findIndex((i) => i.id === itemId);
    if (idx === -1) {
      return c.json({ error: 'item not found' }, 404);
    }

    inbox.items.splice(idx, 1);
    await writeInbox(projectKey, inbox);

    return c.json({ ok: true });
  } catch (error) {
    console.error('[inbox DELETE]', error);
    return c.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      500,
    );
  }
});

export default app;
