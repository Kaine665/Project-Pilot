/**
 * documents/ 域 — 真相源：documents/entries/<docId>.json + documents/content/
 */

import { promises as fs } from 'fs';
import path from 'path';
import {
  getDocumentsEntriesDir,
  getDocumentsIndexPath,
  readJsonFile,
  writeJsonFile,
} from './file-store';
import type { DocsIndexData, DocumentKind, DocEntry, DocStatus } from '@/types';

/** 磁盘上的 document entry（与迁移脚本写入形状兼容） */
export interface DocumentDiskEntry {
  id: string;
  title: string;
  description?: string;
  scope: 'global' | 'project' | 'agent';
  projectKey?: string;
  agentId?: string | null;
  format: 'json' | 'markdown' | 'text';
  /** 正文文件名（documents/content/ 下）；缺省为 {id}.{ext} */
  contentFileName?: string;
  documentKind?: DocumentKind;
  category?: string | null;
  tags?: string[];
  status?: string;
  sourcePath?: string | null;
  supersededBy?: string | null;
  supersedes?: string | null;
  summary?: string | null;
  coveredPaths?: string[] | null;
  lastCheckedCommit?: string | null;
  createdAt: string;
  updatedAt: string;
}

function formatToExt(f: string): string {
  if (f === 'json') return 'json';
  if (f === 'text') return 'txt';
  return 'md';
}

export function documentToDocEntry(d: DocumentDiskEntry): DocEntry {
  const ext = formatToExt(d.format);
  const fileName = d.contentFileName ?? `${d.id}.${ext}`;
  const st = (d.status ?? 'active') as DocStatus;
  const pk = d.projectKey ?? (d.scope === 'global' ? '_global' : '_other');
  const kind: DocumentKind = d.documentKind ?? 'design_doc';
  return {
    id: d.id,
    title: d.title,
    description: d.description,
    fileName,
    projectKey: pk,
    documentKind: kind,
    ...(d.category ? { category: d.category } : {}),
    ...(d.tags?.length ? { tags: d.tags } : {}),
    status: st === 'deprecated' || st === 'draft' || st === 'active' ? st : 'active',
    ...(d.summary ? { summary: d.summary } : {}),
    ...(d.sourcePath ? { sourcePath: d.sourcePath } : {}),
    ...(d.coveredPaths?.length ? { coveredPaths: d.coveredPaths } : {}),
    ...(d.lastCheckedCommit ? { lastCheckedCommit: d.lastCheckedCommit } : {}),
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

export async function loadAllDocumentEntries(): Promise<DocumentDiskEntry[]> {
  const dir = getDocumentsEntriesDir();
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const out: DocumentDiskEntry[] = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const full = path.join(dir, name);
    const doc = await readJsonFile<DocumentDiskEntry | null>(full, null);
    if (doc && typeof doc === 'object' && doc.id) {
      out.push(doc);
    }
  }
  return out;
}

export async function readDocsIndexFromDocuments(): Promise<DocsIndexData> {
  const docs = await loadAllDocumentEntries();
  if (docs.length === 0) {
    const idx = await readJsonFile<DocsIndexData>(getDocumentsIndexPath(), { projects: {} });
    if (idx.projects && Object.keys(idx.projects).length > 0) {
      return idx;
    }
    return { projects: {} };
  }
  const projects: Record<string, DocEntry[]> = {};
  for (const d of docs) {
    const de = documentToDocEntry(d);
    const pk = de.projectKey;
    if (!projects[pk]) projects[pk] = [];
    projects[pk].push(de);
  }
  const idx = await readJsonFile<DocsIndexData>(getDocumentsIndexPath(), { projects: {} });
  return idx.categories?.length ? { projects, categories: idx.categories } : { projects };
}

export async function rebuildDocumentsIndexSummary(
  docs: DocumentDiskEntry[],
  categories?: import('@/types').CategoryDef[],
): Promise<void> {
  const summaries = docs.map((d) => ({
    id: d.id,
    title: d.title,
    scope: d.scope,
    projectKey: d.projectKey,
    agentId: d.agentId,
    format: d.format,
    documentKind: d.documentKind,
    tags: d.tags,
    status: d.status,
    category: d.category,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  }));
  await writeJsonFile(getDocumentsIndexPath(), {
    documents: summaries,
    ...(categories?.length ? { categories } : {}),
  });
}

export async function deleteDocumentEntryFile(docId: string): Promise<void> {
  try {
    await fs.unlink(path.join(getDocumentsEntriesDir(), `${docId}.json`));
  } catch {
    /* ok */
  }
}

function formatFromFileName(fileName: string): 'json' | 'markdown' | 'text' {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === '.json') return 'json';
  if (ext === '.txt') return 'text';
  return 'markdown';
}

export function docEntryToDocumentDisk(de: DocEntry): DocumentDiskEntry {
  const isGlobal = de.projectKey === '_global';
  const ext = formatToExt(formatFromFileName(de.fileName));
  const defaultName = `${de.id}.${ext}`;
  return {
    id: de.id,
    title: de.title,
    description: de.description,
    scope: isGlobal ? 'global' : 'project',
    projectKey: isGlobal ? undefined : de.projectKey,
    agentId: null,
    format: formatFromFileName(de.fileName),
    ...(de.fileName !== defaultName ? { contentFileName: de.fileName } : {}),
    documentKind: de.documentKind ?? 'design_doc',
    category: de.category ?? null,
    tags: de.tags,
    status: de.status ?? 'active',
    sourcePath: de.sourcePath ?? null,
    supersededBy: de.supersededBy ?? null,
    supersedes: de.supersedes ?? null,
    summary: de.summary ?? null,
    coveredPaths: de.coveredPaths ?? null,
    lastCheckedCommit: de.lastCheckedCommit ?? null,
    createdAt: de.createdAt,
    updatedAt: de.updatedAt,
  };
}

export async function saveDocsIndexToDocuments(data: DocsIndexData): Promise<void> {
  const fromApi: DocumentDiskEntry[] = [];
  for (const entries of Object.values(data.projects)) {
    for (const de of entries) {
      fromApi.push(docEntryToDocumentDisk(de));
    }
  }
  const touch = new Set(fromApi.map((d) => d.id));
  const prevAll = await loadAllDocumentEntries();
  const merged: DocumentDiskEntry[] = [
    ...prevAll.filter((d) => !touch.has(d.id)),
    ...fromApi,
  ];
  const entriesDir = getDocumentsEntriesDir();
  await fs.mkdir(entriesDir, { recursive: true });
  const keep = new Set(merged.map((d) => d.id));
  try {
    const existing = await fs.readdir(entriesDir);
    for (const f of existing) {
      if (!f.endsWith('.json')) continue;
      const id = f.replace(/\.json$/, '');
      if (!keep.has(id)) {
        await fs.unlink(path.join(entriesDir, f)).catch(() => {});
      }
    }
  } catch {
    /* ok */
  }
  for (const d of merged) {
    await writeJsonFile(path.join(entriesDir, `${d.id}.json`), d);
  }
  const summaries = merged.map((d) => ({
    id: d.id,
    title: d.title,
    scope: d.scope,
    projectKey: d.projectKey,
    agentId: d.agentId,
    format: d.format,
    documentKind: d.documentKind,
    tags: d.tags,
    status: d.status,
    category: d.category,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  }));
  await writeJsonFile(getDocumentsIndexPath(), {
    documents: summaries,
    ...(data.categories?.length ? { categories: data.categories } : {}),
  });
}
