import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import {
  getDesignDocsIndexPath,
  getDesignDocFilePath,
  readJsonFile,
  writeJsonFile,
} from '@/lib/file-store';
import type { DocEntry, DocsIndexData } from '@/types';

const DEFAULT_INDEX: DocsIndexData = { projects: {} };

function findEntry(data: DocsIndexData, id: string) {
  for (const [projectKey, entries] of Object.entries(data.projects)) {
    const entry = entries.find(e => e.id === id);
    if (entry) return { entry, projectKey, entries };
  }
  return null;
}

/** GET /api/docs/[id] — 返回元数据 + Markdown 正文 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const data = await readJsonFile<DocsIndexData>(getDesignDocsIndexPath(), DEFAULT_INDEX);
  const found = findEntry(data, id);
  if (!found) {
    return NextResponse.json({ error: 'Doc not found' }, { status: 404 });
  }

  let content = '';
  try {
    content = await fs.readFile(getDesignDocFilePath(found.entry.fileName), 'utf-8');
  } catch { /* file may not exist yet */ }

  return NextResponse.json({ entry: found.entry, content });
}

/** PATCH /api/docs/[id] — { title?, description?, content? } */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json();
  const data = await readJsonFile<DocsIndexData>(getDesignDocsIndexPath(), DEFAULT_INDEX);
  const found = findEntry(data, id);
  if (!found) {
    return NextResponse.json({ error: 'Doc not found' }, { status: 404 });
  }

  const { entry } = found;

  if (body.title !== undefined) entry.title = body.title.trim();
  if (body.description !== undefined) {
    entry.description = body.description?.trim() || undefined;
  }
  entry.updatedAt = new Date().toISOString();

  if (body.content !== undefined) {
    await fs.writeFile(getDesignDocFilePath(entry.fileName), body.content, 'utf-8');
  }

  await writeJsonFile(getDesignDocsIndexPath(), data);
  return NextResponse.json({ ok: true, entry });
}

/** DELETE /api/docs/[id] — 硬删除 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const data = await readJsonFile<DocsIndexData>(getDesignDocsIndexPath(), DEFAULT_INDEX);
  const found = findEntry(data, id);
  if (!found) {
    return NextResponse.json({ error: 'Doc not found' }, { status: 404 });
  }

  // 删除 Markdown 文件
  try {
    await fs.unlink(getDesignDocFilePath(found.entry.fileName));
  } catch { /* ignore */ }

  // 从索引移除
  const idx = found.entries.findIndex(e => e.id === id);
  found.entries.splice(idx, 1);
  if (found.entries.length === 0) {
    delete data.projects[found.projectKey];
  }
  await writeJsonFile(getDesignDocsIndexPath(), data);

  return NextResponse.json({ ok: true });
}
