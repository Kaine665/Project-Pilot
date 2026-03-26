import { Hono } from 'hono';
import { promises as fs } from 'fs';
import {
  getDesignDocsDir,
  getDesignDocFilePath,
} from '@/lib/file-store';
import { readDocsIndexFromDocuments, saveDocsIndexToDocuments } from '@/lib/documents-store';
import { badRequest, notFound } from '@/lib/http-error';
import type { DocEntry, DocsIndexData, DocStatus, CategoryDef } from '@/types';

const app = new Hono();

const DEFAULT_INDEX: DocsIndexData = { projects: {} };

async function readIndex(): Promise<DocsIndexData> {
  const data = await readDocsIndexFromDocuments();
  if (data.projects && Object.keys(data.projects).length > 0) {
    return data;
  }
  return DEFAULT_INDEX;
}

async function writeIndex(data: DocsIndexData): Promise<void> {
  await saveDocsIndexToDocuments(data);
}

function findEntry(data: DocsIndexData, id: string) {
  for (const [projectKey, entries] of Object.entries(data.projects)) {
    const entry = entries.find((e) => e.id === id);
    if (entry) return { entry, projectKey, entries };
  }
  return null;
}

// ---------------------------------------------------------------------------
// /api/docs
// ---------------------------------------------------------------------------

app.get('/', async (c) => {
  const projectKey = c.req.query('project');
  const category = c.req.query('category');
  const tags = c.req.queries('tag') ?? [];
  const status = c.req.query('status') as DocStatus | null;

  const data = await readIndex();
  const hasFilters = category || tags.length > 0 || status;

  if (!hasFilters) {
    if (projectKey) {
      return c.json({ docs: data.projects[projectKey] ?? [] });
    }
    return c.json({ projects: data.projects });
  }

  const projectKeys = projectKey ? [projectKey] : Object.keys(data.projects);
  const filtered: DocEntry[] = [];
  for (const pk of projectKeys) {
    const entries = data.projects[pk] ?? [];
    for (const entry of entries) {
      if (status) {
        const docStatus = entry.status ?? 'active';
        if (docStatus !== status) continue;
      }
      if (category && entry.category !== category) continue;
      if (tags.length > 0) {
        const docTags = entry.tags ?? [];
        if (!tags.some((t) => docTags.includes(t))) continue;
      }
      filtered.push(entry);
    }
  }

  return c.json({ docs: filtered });
});

app.post('/', async (c) => {
  const body = await c.req.json();
  const { projectKey, title, description, content, category, tags, status, supersedes } = body;

  if (!projectKey?.trim()) throw badRequest('projectKey is required');
  if (!title?.trim()) throw badRequest('title is required');
  if (status && !['active', 'draft', 'deprecated'].includes(status)) {
    throw badRequest('Invalid status. Must be active, draft, or deprecated');
  }
  if (tags && !Array.isArray(tags)) throw badRequest('tags must be an array of strings');

  const now = new Date().toISOString();
  const docId = `doc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const fileName = `${docId}.md`;

  const entry: DocEntry = {
    id: docId,
    title: title.trim(),
    description: description?.trim() || undefined,
    fileName,
    projectKey: projectKey.trim(),
    category: category?.trim() || undefined,
    tags: tags?.length ? tags.map((t: string) => t.trim()).filter(Boolean) : undefined,
    status: status || undefined,
    supersedes: supersedes?.trim() || undefined,
    createdAt: now,
    updatedAt: now,
  };

  await fs.mkdir(getDesignDocsDir(), { recursive: true });
  await fs.writeFile(getDesignDocFilePath(fileName), content ?? '', 'utf-8');

  const data = await readIndex();
  if (!data.projects[entry.projectKey]) {
    data.projects[entry.projectKey] = [];
  }
  data.projects[entry.projectKey].push(entry);

  if (entry.supersedes) {
    for (const entries of Object.values(data.projects)) {
      const oldDoc = entries.find((e) => e.id === entry.supersedes);
      if (oldDoc) {
        oldDoc.supersededBy = docId;
        oldDoc.updatedAt = now;
        break;
      }
    }
  }

  await writeIndex(data);
  return c.json({ ok: true, entry });
});

// ---------------------------------------------------------------------------
// /api/docs/tags
// ---------------------------------------------------------------------------

app.get('/tags', async (c) => {
  const projectKey = c.req.query('project');
  const data = await readIndex();

  const tagCounts = new Map<string, number>();
  const projectKeys = projectKey ? [projectKey] : Object.keys(data.projects);

  for (const pk of projectKeys) {
    const entries = data.projects[pk] ?? [];
    for (const entry of entries) {
      if (entry.tags) {
        for (const tag of entry.tags) {
          tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
        }
      }
    }
  }

  const tags = Array.from(tagCounts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  return c.json({ tags });
});

// ---------------------------------------------------------------------------
// /api/docs/batch
// ---------------------------------------------------------------------------

app.post('/batch', async (c) => {
  try {
    const body = await c.req.json();
    const { action, ids } = body;

    if (!action || !Array.isArray(ids) || ids.length === 0) {
      return c.json({ error: 'action and non-empty ids[] are required' }, 400);
    }

    const data = await readIndex();
    const now = new Date().toISOString();
    const idSet = new Set(ids as string[]);
    let updated = 0;

    const matchedEntries = [];
    for (const entries of Object.values(data.projects)) {
      for (const entry of entries) {
        if (idSet.has(entry.id)) {
          matchedEntries.push(entry);
        }
      }
    }

    switch (action) {
      case 'set-category': {
        const category = body.category?.trim() || undefined;
        for (const entry of matchedEntries) {
          entry.category = category;
          entry.updatedAt = now;
          updated++;
        }
        break;
      }

      case 'add-tags': {
        const tagsToAdd: string[] = body.tags;
        if (!Array.isArray(tagsToAdd) || tagsToAdd.length === 0) {
          return c.json({ error: 'tags[] is required for add-tags' }, 400);
        }
        const cleanTags = tagsToAdd.map((t) => t.trim()).filter(Boolean);
        for (const entry of matchedEntries) {
          const existing = new Set(entry.tags ?? []);
          for (const tag of cleanTags) existing.add(tag);
          entry.tags = Array.from(existing);
          entry.updatedAt = now;
          updated++;
        }
        break;
      }

      case 'remove-tags': {
        const tagsToRemove: string[] = body.tags;
        if (!Array.isArray(tagsToRemove) || tagsToRemove.length === 0) {
          return c.json({ error: 'tags[] is required for remove-tags' }, 400);
        }
        const removeSet = new Set(tagsToRemove.map((t) => t.trim()));
        for (const entry of matchedEntries) {
          if (entry.tags) {
            entry.tags = entry.tags.filter((t) => !removeSet.has(t));
            if (entry.tags.length === 0) entry.tags = undefined;
            entry.updatedAt = now;
            updated++;
          }
        }
        break;
      }

      case 'set-status': {
        const status = body.status as DocStatus;
        if (!status || !['active', 'draft', 'deprecated'].includes(status)) {
          return c.json(
            { error: 'Valid status (active/draft/deprecated) is required' },
            400,
          );
        }
        for (const entry of matchedEntries) {
          entry.status = status;
          entry.updatedAt = now;
          updated++;
        }
        break;
      }

      default:
        return c.json(
          { error: `Unknown action: ${action}. Supported: set-category, add-tags, remove-tags, set-status` },
          400,
        );
    }

    await writeIndex(data);
    return c.json({ ok: true, updated });
  } catch (error) {
    console.error('Batch operation failed:', error);
    return c.json({ error: 'Batch operation failed' }, 500);
  }
});

// ---------------------------------------------------------------------------
// /api/docs/categories
// ---------------------------------------------------------------------------

app.get('/categories', async (c) => {
  const projectKey = c.req.query('project');
  const data = await readIndex();
  const categories = data.categories ?? [];

  if (projectKey) {
    const filtered = categories.filter(
      (cat) => !cat.projectKey || cat.projectKey === projectKey,
    );
    return c.json({ categories: filtered });
  }

  return c.json({ categories });
});

app.post('/categories', async (c) => {
  try {
    const body = await c.req.json();
    const { name, description, sortOrder, projectKey } = body;

    if (!name?.trim()) {
      return c.json({ error: 'name is required' }, 400);
    }

    const data = await readIndex();
    if (!data.categories) data.categories = [];

    const duplicate = data.categories.find(
      (cat) => cat.name === name.trim() && (cat.projectKey ?? '') === (projectKey?.trim() ?? ''),
    );
    if (duplicate) {
      return c.json({ error: 'Category with this name already exists' }, 409);
    }

    const now = new Date().toISOString();
    const category: CategoryDef = {
      id: `cat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: name.trim(),
      description: description?.trim() || undefined,
      sortOrder: typeof sortOrder === 'number' ? sortOrder : undefined,
      projectKey: projectKey?.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    };

    data.categories.push(category);
    await writeIndex(data);

    return c.json({ ok: true, category });
  } catch (error) {
    console.error('Create category failed:', error);
    return c.json({ error: 'Create failed' }, 500);
  }
});

// ---------------------------------------------------------------------------
// /api/docs/categories/:id
// ---------------------------------------------------------------------------

app.patch('/categories/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const data = await readIndex();
  const categories = data.categories ?? [];
  const category = categories.find((cat) => cat.id === id);

  if (!category) {
    return c.json({ error: 'Category not found' }, 404);
  }

  if (body.name !== undefined) {
    const newName = body.name?.trim();
    if (!newName) {
      return c.json({ error: 'name cannot be empty' }, 400);
    }
    const duplicate = categories.find(
      (cat) => cat.id !== id && cat.name === newName && (cat.projectKey ?? '') === (category.projectKey ?? ''),
    );
    if (duplicate) {
      return c.json({ error: 'Category with this name already exists' }, 409);
    }
    category.name = newName;
  }

  if (body.description !== undefined) {
    category.description = body.description?.trim() || undefined;
  }
  if (body.sortOrder !== undefined) {
    category.sortOrder = typeof body.sortOrder === 'number' ? body.sortOrder : undefined;
  }
  if (body.projectKey !== undefined) {
    category.projectKey = body.projectKey?.trim() || undefined;
  }

  category.updatedAt = new Date().toISOString();

  await writeIndex(data);
  return c.json({ ok: true, category });
});

app.delete('/categories/:id', async (c) => {
  const id = c.req.param('id');
  const data = await readIndex();
  const categories = data.categories ?? [];
  const idx = categories.findIndex((cat) => cat.id === id);

  if (idx === -1) {
    return c.json({ error: 'Category not found' }, 404);
  }

  categories.splice(idx, 1);
  data.categories = categories;

  const now = new Date().toISOString();
  for (const entries of Object.values(data.projects)) {
    for (const entry of entries) {
      if (entry.category === id) {
        entry.category = undefined;
        entry.updatedAt = now;
      }
    }
  }

  await writeIndex(data);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// /api/docs/:id  — single doc CRUD (must be last to avoid catching sub-routes)
// ---------------------------------------------------------------------------

app.get('/:id', async (c) => {
  const id = c.req.param('id');
  const data = await readIndex();
  const found = findEntry(data, id);
  if (!found) throw notFound('Doc not found');

  let content = '';
  try {
    content = await fs.readFile(getDesignDocFilePath(found.entry.fileName), 'utf-8');
  } catch { /* file may not exist yet */ }

  return c.json({ entry: found.entry, content });
});

app.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const data = await readIndex();
  const found = findEntry(data, id);
  if (!found) throw notFound('Doc not found');

  const { entry } = found;
  const now = new Date().toISOString();

  if (body.title !== undefined) entry.title = body.title.trim();
  if (body.description !== undefined) {
    entry.description = body.description?.trim() || undefined;
  }
  if (body.category !== undefined) {
    entry.category = body.category?.trim() || undefined;
  }
  if (body.tags !== undefined) {
    if (body.tags === null || (Array.isArray(body.tags) && body.tags.length === 0)) {
      entry.tags = undefined;
    } else if (Array.isArray(body.tags)) {
      entry.tags = body.tags.map((t: string) => t.trim()).filter(Boolean);
    }
  }
  if (body.status !== undefined) {
    if (body.status && !['active', 'draft', 'deprecated'].includes(body.status)) {
      throw badRequest('Invalid status');
    }
    entry.status = body.status || undefined;
  }

  if (body.supersedes !== undefined) {
    const oldSupersedes = entry.supersedes;

    if (oldSupersedes && oldSupersedes !== body.supersedes) {
      for (const entries of Object.values(data.projects)) {
        const oldDoc = entries.find((e) => e.id === oldSupersedes);
        if (oldDoc && oldDoc.supersededBy === id) {
          oldDoc.supersededBy = undefined;
          oldDoc.updatedAt = now;
          break;
        }
      }
    }

    entry.supersedes = body.supersedes?.trim() || undefined;

    if (entry.supersedes) {
      for (const entries of Object.values(data.projects)) {
        const targetDoc = entries.find((e) => e.id === entry.supersedes);
        if (targetDoc) {
          targetDoc.supersededBy = id;
          targetDoc.updatedAt = now;
          break;
        }
      }
    }
  }

  if (body.supersededBy !== undefined) {
    entry.supersededBy = body.supersededBy?.trim() || undefined;
  }

  entry.updatedAt = now;

  if (body.content !== undefined) {
    await fs.writeFile(getDesignDocFilePath(entry.fileName), body.content, 'utf-8');
  }

  await writeIndex(data);
  return c.json({ ok: true, entry });
});

app.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const data = await readIndex();
  const found = findEntry(data, id);
  if (!found) throw notFound('Doc not found');

  if (found.entry.supersedes) {
    for (const entries of Object.values(data.projects)) {
      const oldDoc = entries.find((e) => e.id === found.entry.supersedes);
      if (oldDoc && oldDoc.supersededBy === id) {
        oldDoc.supersededBy = undefined;
        oldDoc.updatedAt = new Date().toISOString();
        break;
      }
    }
  }
  if (found.entry.supersededBy) {
    for (const entries of Object.values(data.projects)) {
      const newDoc = entries.find((e) => e.id === found.entry.supersededBy);
      if (newDoc && newDoc.supersedes === id) {
        newDoc.supersedes = undefined;
        newDoc.updatedAt = new Date().toISOString();
        break;
      }
    }
  }

  try {
    await fs.unlink(getDesignDocFilePath(found.entry.fileName));
  } catch { /* ignore */ }

  const idx = found.entries.findIndex((e) => e.id === id);
  found.entries.splice(idx, 1);
  if (found.entries.length === 0) {
    delete data.projects[found.projectKey];
  }
  await writeIndex(data);

  return c.json({ ok: true });
});

export default app;
