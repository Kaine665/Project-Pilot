import { Hono } from 'hono';
import {
  readDocsIndex,
  writeDocsIndex,
  listDocEntries,
  createDocumentEntry,
  getDocumentWithContent,
  patchDocumentEntry,
  deleteDocumentEntry,
} from '@/lib/documents-crud';
import { HttpError } from '@/lib/http-error';
import type { DocStatus, CategoryDef } from '@/types';

const app = new Hono();

app.onError((err, c) => {
  if (err instanceof HttpError) {
    return c.json(
      { error: err.message, ...(err.code ? { code: err.code } : {}) },
      err.statusCode as 400,
    );
  }
  throw err;
});

// ---------------------------------------------------------------------------
// /api/docs
// ---------------------------------------------------------------------------

app.get('/', async (c) => {
  const projectKey = c.req.query('project');
  const category = c.req.query('category');
  const tags = c.req.queries('tag') ?? [];
  const status = c.req.query('status') as DocStatus | null;
  const documentKind = c.req.query('documentKind') as import('@/types').DocumentKind | null;

  const result = await listDocEntries({
    projectKey: projectKey ?? undefined,
    category: category ?? undefined,
    tags: tags.length ? tags : undefined,
    status: status || undefined,
    documentKind,
  });

  if (result.mode === 'by_project') {
    return c.json({ docs: result.docs ?? [] });
  }
  if (result.mode === 'all_projects') {
    return c.json({ projects: result.projects ?? {} });
  }
  return c.json({ docs: result.docs ?? [] });
});

app.post('/', async (c) => {
  const body = await c.req.json();
  const entry = await createDocumentEntry(body);
  return c.json({ ok: true, entry });
});

// ---------------------------------------------------------------------------
// /api/docs/tags
// ---------------------------------------------------------------------------

app.get('/tags', async (c) => {
  const projectKey = c.req.query('project');
  const data = await readDocsIndex();

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

    const data = await readDocsIndex();
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

    await writeDocsIndex(data);
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
  const data = await readDocsIndex();
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

    const data = await readDocsIndex();
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
    await writeDocsIndex(data);

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
  const data = await readDocsIndex();
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

  await writeDocsIndex(data);
  return c.json({ ok: true, category });
});

app.delete('/categories/:id', async (c) => {
  const id = c.req.param('id');
  const data = await readDocsIndex();
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

  await writeDocsIndex(data);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// /api/docs/:id  — single doc CRUD (must be last)
// ---------------------------------------------------------------------------

app.get('/:id', async (c) => {
  const id = c.req.param('id');
  const { entry, content } = await getDocumentWithContent(id);
  return c.json({ entry, content });
});

app.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const entry = await patchDocumentEntry(id, body);
  return c.json({ ok: true, entry });
});

app.delete('/:id', async (c) => {
  const id = c.req.param('id');
  await deleteDocumentEntry(id);
  return c.json({ ok: true });
});

export default app;
