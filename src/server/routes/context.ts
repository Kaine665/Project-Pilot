import { Hono } from 'hono';
import { promises as fs } from 'fs';
import {
  getContextDir,
  getContextFilePath,
} from '@/lib/file-store';
import {
  readContextIndexFromDocuments,
  saveContextIndexToDocuments,
} from '@/lib/documents-store';
import { badRequest, notFound, conflict } from '@/lib/http-error';
import type { ContextEntry, ContextIndexData } from '@/types';

const app = new Hono();

async function readIndex(): Promise<ContextIndexData> {
  return readContextIndexFromDocuments();
}

async function writeIndex(data: ContextIndexData): Promise<void> {
  await saveContextIndexToDocuments(data);
}

export function generateContextSummary(content: string, format: 'json' | 'markdown' | 'text'): string {
  const MAX = 800;
  if (format === 'json') {
    try {
      const obj = JSON.parse(content);
      if (Array.isArray(obj)) {
        const firstItem = obj[0];
        const firstStr = firstItem ? JSON.stringify(firstItem, null, 2).slice(0, 300) : '';
        return `JSON 数组，${obj.length} 项。首项结构：\n${firstStr}`.slice(0, MAX);
      }
      const keys = Object.keys(obj);
      return `JSON 对象，字段: ${keys.join(', ')}`.slice(0, MAX);
    } catch {
      return content.slice(0, MAX);
    }
  }
  if (format === 'markdown') {
    const lines = content.split('\n');
    const headings = lines.filter((l) => /^#{1,3}\s/.test(l));
    if (headings.length > 0) {
      return headings.slice(0, 15).join('\n').slice(0, MAX);
    }
  }
  return content.slice(0, MAX);
}

// ---------------------------------------------------------------------------
// /api/context
// ---------------------------------------------------------------------------

app.get('/', async (c) => {
  const data = await readIndex();
  const projectKey = c.req.query('projectKey');
  let entries = data.entries;
  if (projectKey) {
    entries = entries.filter((e) => !e.projectKey || e.projectKey === projectKey);
  }
  return c.json({ entries });
});

app.post('/', async (c) => {
  const {
    label, description, fileName, format, content, group,
    sourcePath, tags, coveredPaths, status, sourceAgentSessionId,
    producedAt, projectKey, summary: manualSummary,
  } = await c.req.json();

  if (!label?.trim()) throw badRequest('label is required');
  if (!fileName?.trim()) throw badRequest('fileName is required');
  if (!['json', 'markdown', 'text'].includes(format)) throw badRequest('format must be json, markdown, or text');

  const trimmedFileName = fileName.trim();

  const data = await readIndex();
  if (data.entries.some((e) => e.fileName === trimmedFileName)) {
    throw conflict('fileName already exists');
  }

  const now = new Date().toISOString();
  const trimmedGroup = group?.trim() || undefined;
  const trimmedProjectKey = projectKey?.trim() || undefined;
  const trimmedSourcePath = sourcePath?.trim() || undefined;
  const trimmedStatus = status === 'draft' ? 'draft' : undefined;
  const trimmedSourceAgentSessionId = sourceAgentSessionId?.trim() || undefined;
  const trimmedProducedAt = producedAt?.trim() || undefined;

  const trimmedManualSummary = typeof manualSummary === 'string' ? manualSummary.trim() : undefined;
  const autoSummary = (!trimmedManualSummary && content && !trimmedSourcePath)
    ? generateContextSummary(content, format)
    : undefined;
  const finalSummary = trimmedManualSummary || autoSummary;

  const entry: ContextEntry = {
    id: `ctx-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    label: label.trim(),
    description: (description ?? '').trim(),
    fileName: trimmedFileName,
    format,
    ...(trimmedGroup ? { group: trimmedGroup } : {}),
    ...(trimmedProjectKey ? { projectKey: trimmedProjectKey } : {}),
    ...(trimmedSourcePath ? { sourcePath: trimmedSourcePath } : {}),
    ...(Array.isArray(tags) && tags.length ? { tags: tags.filter((t: unknown) => typeof t === 'string' && (t as string).trim()).map((t: string) => t.trim()) } : {}),
    ...(Array.isArray(coveredPaths) && coveredPaths.length ? { coveredPaths: coveredPaths.filter((p: unknown) => typeof p === 'string' && (p as string).trim()).map((p: string) => p.trim()) } : {}),
    ...(trimmedStatus ? { status: trimmedStatus } : {}),
    ...(trimmedSourceAgentSessionId ? { sourceAgentSessionId: trimmedSourceAgentSessionId } : {}),
    ...(trimmedProducedAt ? { producedAt: trimmedProducedAt } : {}),
    ...(finalSummary ? { summary: finalSummary } : {}),
    createdAt: now,
    updatedAt: now,
  };

  if (!trimmedSourcePath) {
    const contextDir = getContextDir();
    await fs.mkdir(contextDir, { recursive: true });
    const filePath = getContextFilePath(entry.fileName);
    await fs.writeFile(filePath, content ?? '', 'utf-8');
  }

  data.entries.push(entry);
  await writeIndex(data);

  return c.json({ ok: true, entry });
});

// ---------------------------------------------------------------------------
// /api/context/:id
// ---------------------------------------------------------------------------

app.get('/:id', async (c) => {
  const id = c.req.param('id');
  const data = await readIndex();
  const entry = data.entries.find((e) => e.id === id);
  if (!entry) throw notFound('Entry not found');

  let content = '';
  try {
    const readPath = entry.sourcePath || getContextFilePath(entry.fileName);
    content = await fs.readFile(readPath, 'utf-8');
  } catch { /* file may not exist yet */ }

  return c.json({ entry, content });
});

app.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const data = await readIndex();
  const entry = data.entries.find((e) => e.id === id);
  if (!entry) throw notFound('Entry not found');

  if (body.label !== undefined) entry.label = body.label.trim();
  if (body.description !== undefined) entry.description = body.description.trim();
  if (body.format !== undefined && ['json', 'markdown', 'text'].includes(body.format)) {
    entry.format = body.format;
  }
  if (body.status !== undefined) {
    if (body.status === 'active') {
      delete entry.status;
    } else if (body.status === 'draft') {
      entry.status = 'draft';
    }
  }
  if (body.group !== undefined) {
    const g = typeof body.group === 'string' ? body.group.trim() : '';
    if (g) {
      entry.group = g;
    } else {
      delete entry.group;
    }
  }
  if (body.projectKey !== undefined) {
    const pk = typeof body.projectKey === 'string' ? body.projectKey.trim() : '';
    if (pk) {
      entry.projectKey = pk;
    } else {
      delete entry.projectKey;
    }
  }
  if (body.sourcePath !== undefined) {
    const sp = typeof body.sourcePath === 'string' ? body.sourcePath.trim() : '';
    if (sp) {
      entry.sourcePath = sp;
    } else {
      delete entry.sourcePath;
    }
  }
  if (body.tags !== undefined) {
    if (Array.isArray(body.tags) && body.tags.length) {
      entry.tags = body.tags.filter((t: unknown) => typeof t === 'string' && (t as string).trim()).map((t: string) => t.trim());
    } else {
      delete entry.tags;
    }
  }
  if (body.coveredPaths !== undefined) {
    if (Array.isArray(body.coveredPaths) && body.coveredPaths.length) {
      entry.coveredPaths = body.coveredPaths.filter((p: unknown) => typeof p === 'string' && (p as string).trim()).map((p: string) => p.trim());
    } else {
      delete entry.coveredPaths;
    }
  }
  entry.updatedAt = new Date().toISOString();

  if (body.fileName !== undefined && body.fileName.trim() !== entry.fileName) {
    const oldPath = getContextFilePath(entry.fileName);
    const newFileName = body.fileName.trim();
    const newPath = getContextFilePath(newFileName);

    if (data.entries.some((e) => e.id !== id && e.fileName === newFileName)) {
      throw conflict('fileName already exists');
    }

    try {
      await fs.rename(oldPath, newPath);
    } catch { /* old file may not exist */ }
    entry.fileName = newFileName;
  }

  if (body.summary !== undefined) {
    const s = typeof body.summary === 'string' ? body.summary.trim() : '';
    if (s) {
      entry.summary = s;
    } else {
      delete entry.summary;
    }
  }

  if (body.content !== undefined) {
    await fs.writeFile(getContextFilePath(entry.fileName), body.content, 'utf-8');
    if (!entry.summary) {
      entry.summary = generateContextSummary(body.content, entry.format);
    }
  }

  await writeIndex(data);
  return c.json({ ok: true, entry });
});

app.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const data = await readIndex();
  const idx = data.entries.findIndex((e) => e.id === id);
  if (idx === -1) throw notFound('Entry not found');

  const entry = data.entries[idx];

  try {
    await fs.unlink(getContextFilePath(entry.fileName));
  } catch { /* ignore */ }

  data.entries.splice(idx, 1);
  await writeIndex(data);

  return c.json({ ok: true });
});

export default app;
