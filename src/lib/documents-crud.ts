/**
 * 统一文档域 CRUD — 供 HTTP /api/docs 与进程内 documents MCP 共用。
 */

import { promises as fs } from 'fs';
import { getDocumentContentPath, getDocumentsContentDir } from '@/lib/file-store';
import { readDocsIndexFromDocuments, saveDocsIndexToDocuments } from '@/lib/documents-store';
import { badRequest, notFound, HttpError } from '@/lib/http-error';
import { assertDocumentTextWritable, documentTextWriteErrorResponse } from '@/lib/document-text-write-guard';
import type { DocEntry, DocsIndexData, DocStatus, DocumentKind } from '@/types';

const DEFAULT_INDEX: DocsIndexData = { projects: {} };

export async function readDocsIndex(): Promise<DocsIndexData> {
  const data = await readDocsIndexFromDocuments();
  if (data.projects && Object.keys(data.projects).length > 0) {
    return data;
  }
  return DEFAULT_INDEX;
}

export async function writeDocsIndex(data: DocsIndexData): Promise<void> {
  await saveDocsIndexToDocuments(data);
}

export function findDocInIndex(
  data: DocsIndexData,
  id: string,
): { entry: DocEntry; projectKey: string; entries: DocEntry[] } | null {
  for (const [projectKey, entries] of Object.entries(data.projects)) {
    const entry = entries.find((e) => e.id === id);
    if (entry) return { entry, projectKey, entries };
  }
  return null;
}

function filterByDocumentKind(entries: DocEntry[], dk: DocumentKind | null): DocEntry[] {
  if (!dk) return entries;
  return entries.filter((e) => (e.documentKind ?? 'design_doc') === dk);
}

export async function listDocEntries(options: {
  projectKey?: string;
  category?: string;
  tags?: string[];
  status?: DocStatus | null;
  documentKind?: DocumentKind | null;
}): Promise<{ mode: 'by_project' | 'filtered' | 'all_projects'; docs?: DocEntry[]; projects?: Record<string, DocEntry[]> }> {
  const data = await readDocsIndex();
  const hasFilters = !!(options.category || (options.tags && options.tags.length > 0) || options.status || options.documentKind);

  if (!hasFilters) {
    if (options.projectKey) {
      return { mode: 'by_project', docs: data.projects[options.projectKey] ?? [] };
    }
    return { mode: 'all_projects', projects: data.projects };
  }

  const projectKeys = options.projectKey ? [options.projectKey] : Object.keys(data.projects);
  const filtered: DocEntry[] = [];
  for (const pk of projectKeys) {
    let entries = data.projects[pk] ?? [];
    entries = filterByDocumentKind(entries, options.documentKind ?? null);
    for (const entry of entries) {
      if (options.status) {
        const docStatus = entry.status ?? 'active';
        if (docStatus !== options.status) continue;
      }
      if (options.category && entry.category !== options.category) continue;
      if (options.tags && options.tags.length > 0) {
        const docTags = entry.tags ?? [];
        if (!options.tags.some((t) => docTags.includes(t))) continue;
      }
      filtered.push(entry);
    }
  }
  return { mode: 'filtered', docs: filtered };
}

export interface CreateDocBody {
  projectKey: string;
  title: string;
  description?: string;
  content?: string;
  category?: string;
  tags?: string[];
  status?: DocStatus;
  supersedes?: string;
  documentKind?: DocumentKind;
}

export async function createDocumentEntry(body: CreateDocBody): Promise<DocEntry> {
  const {
    projectKey,
    title,
    description,
    content,
    category,
    tags,
    status,
    supersedes,
    documentKind: bodyDocKind,
  } = body;

  if (!projectKey?.trim()) throw badRequest('projectKey is required');
  if (!title?.trim()) throw badRequest('title is required');
  if (status && !['active', 'draft', 'deprecated'].includes(status)) {
    throw badRequest('Invalid status. Must be active, draft, or deprecated');
  }
  if (tags && !Array.isArray(tags)) throw badRequest('tags must be an array of strings');

  const now = new Date().toISOString();
  const docId = `doc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const fileName = `${docId}.md`;

  const documentKind: DocumentKind =
    bodyDocKind === 'knowledge' ? 'knowledge' : 'design_doc';

  const entry: DocEntry = {
    id: docId,
    title: title.trim(),
    description: description?.trim() || undefined,
    fileName,
    projectKey: projectKey.trim(),
    documentKind,
    category: category?.trim() || undefined,
    tags: tags?.length ? tags.map((t: string) => t.trim()).filter(Boolean) : undefined,
    status: status || undefined,
    supersedes: supersedes?.trim() || undefined,
    createdAt: now,
    updatedAt: now,
  };

  await fs.mkdir(getDocumentsContentDir(), { recursive: true });
  try {
    assertDocumentTextWritable(title.trim());
    if (description?.trim()) assertDocumentTextWritable(description);
    assertDocumentTextWritable(content ?? '');
    await fs.writeFile(getDocumentContentPath(fileName), content ?? '', 'utf-8');
  } catch (e) {
    const enc = documentTextWriteErrorResponse(e);
    if (enc) throw new HttpError(enc.body.error as string, enc.status);
    throw e;
  }

  const data = await readDocsIndex();
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

  await writeDocsIndex(data);
  return entry;
}

export async function getDocumentWithContent(id: string): Promise<{ entry: DocEntry; content: string }> {
  const data = await readDocsIndex();
  const found = findDocInIndex(data, id);
  if (!found) throw notFound('Doc not found');

  let content = '';
  try {
    const readPath = found.entry.sourcePath || getDocumentContentPath(found.entry.fileName);
    content = await fs.readFile(readPath, 'utf-8');
  } catch { /* file may not exist */ }

  return { entry: found.entry, content };
}

export interface PatchDocBody {
  title?: string;
  description?: string;
  category?: string;
  tags?: string[] | null;
  status?: DocStatus;
  content?: string;
  supersedes?: string;
  supersededBy?: string;
}

export async function patchDocumentEntry(id: string, body: PatchDocBody): Promise<DocEntry> {
  const data = await readDocsIndex();
  const found = findDocInIndex(data, id);
  if (!found) throw notFound('Doc not found');

  const { entry } = found;
  const now = new Date().toISOString();

  try {
    if (body.title !== undefined && body.title.trim()) assertDocumentTextWritable(body.title.trim());
    if (body.description !== undefined && body.description?.trim()) {
      assertDocumentTextWritable(body.description);
    }
    if (body.content !== undefined) assertDocumentTextWritable(body.content);
  } catch (e) {
    const enc = documentTextWriteErrorResponse(e);
    if (enc) throw new HttpError(enc.body.error as string, enc.status);
    throw e;
  }

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
    const writePath = entry.sourcePath || getDocumentContentPath(entry.fileName);
    await fs.writeFile(writePath, body.content, 'utf-8');
  }

  await writeDocsIndex(data);
  return entry;
}

export async function deleteDocumentEntry(id: string): Promise<void> {
  const data = await readDocsIndex();
  const found = findDocInIndex(data, id);
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
    const delPath = found.entry.sourcePath || getDocumentContentPath(found.entry.fileName);
    await fs.unlink(delPath);
  } catch { /* ignore */ }

  const idx = found.entries.findIndex((e) => e.id === id);
  found.entries.splice(idx, 1);
  if (found.entries.length === 0) {
    delete data.projects[found.projectKey];
  }
  await writeDocsIndex(data);
}
