import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import {
  getDesignDocsIndexPath,
  getDesignDocFilePath,
  readJsonFile,
  writeJsonFile,
} from '@/lib/file-store';
import { apiHandler } from '@/lib/api-handler';
import { badRequest, notFound } from '@/lib/http-error';
import type { DocsIndexData } from '@/types';

const DEFAULT_INDEX: DocsIndexData = { projects: {} };

function findEntry(data: DocsIndexData, id: string) {
  for (const [projectKey, entries] of Object.entries(data.projects)) {
    const entry = entries.find(e => e.id === id);
    if (entry) return { entry, projectKey, entries };
  }
  return null;
}

/** GET /api/docs/[id] — 返回元数据 + Markdown 正文 */
export const GET = apiHandler(async (
  _request: NextRequest,
  { params },
) => {
  const { id } = await params;
  const data = await readJsonFile<DocsIndexData>(getDesignDocsIndexPath(), DEFAULT_INDEX);
  const found = findEntry(data, id);
  if (!found) throw notFound('Doc not found');

  let content = '';
  try {
    content = await fs.readFile(getDesignDocFilePath(found.entry.fileName), 'utf-8');
  } catch { /* file may not exist yet */ }

  return NextResponse.json({ entry: found.entry, content });
});

/**
 * PATCH /api/docs/[id] — 更新文档
 *
 * Body fields (all optional):
 *   title, description, content, category, tags, status, supersedes, supersededBy
 */
export const PATCH = apiHandler(async (
  request: NextRequest,
  { params },
) => {
  const { id } = await params;
  const body = await request.json();
  const data = await readJsonFile<DocsIndexData>(getDesignDocsIndexPath(), DEFAULT_INDEX);
  const found = findEntry(data, id);
  if (!found) throw notFound('Doc not found');

  const { entry } = found;
  const now = new Date().toISOString();

  // 基础字段
  if (body.title !== undefined) entry.title = body.title.trim();
  if (body.description !== undefined) {
    entry.description = body.description?.trim() || undefined;
  }

  // 分类
  if (body.category !== undefined) {
    entry.category = body.category?.trim() || undefined;
  }

  // 标签
  if (body.tags !== undefined) {
    if (body.tags === null || (Array.isArray(body.tags) && body.tags.length === 0)) {
      entry.tags = undefined;
    } else if (Array.isArray(body.tags)) {
      entry.tags = body.tags.map((t: string) => t.trim()).filter(Boolean);
    }
  }

  // 状态
  if (body.status !== undefined) {
    if (body.status && !['active', 'draft', 'deprecated'].includes(body.status)) {
      throw badRequest('Invalid status');
    }
    entry.status = body.status || undefined;
  }

  // 替代关系
  if (body.supersedes !== undefined) {
    const oldSupersedes = entry.supersedes;

    // 清除旧的双向关系
    if (oldSupersedes && oldSupersedes !== body.supersedes) {
      for (const entries of Object.values(data.projects)) {
        const oldDoc = entries.find(e => e.id === oldSupersedes);
        if (oldDoc && oldDoc.supersededBy === id) {
          oldDoc.supersededBy = undefined;
          oldDoc.updatedAt = now;
          break;
        }
      }
    }

    entry.supersedes = body.supersedes?.trim() || undefined;

    // 建立新的双向关系
    if (entry.supersedes) {
      for (const entries of Object.values(data.projects)) {
        const targetDoc = entries.find(e => e.id === entry.supersedes);
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

  // 更新 Markdown 正文
  if (body.content !== undefined) {
    await fs.writeFile(getDesignDocFilePath(entry.fileName), body.content, 'utf-8');
  }

  await writeJsonFile(getDesignDocsIndexPath(), data);
  return NextResponse.json({ ok: true, entry });
});

/** DELETE /api/docs/[id] — 硬删除 */
export const DELETE = apiHandler(async (
  _request: NextRequest,
  { params },
) => {
  const { id } = await params;
  const data = await readJsonFile<DocsIndexData>(getDesignDocsIndexPath(), DEFAULT_INDEX);
  const found = findEntry(data, id);
  if (!found) throw notFound('Doc not found');

  // 清除双向替代关系
  if (found.entry.supersedes) {
    for (const entries of Object.values(data.projects)) {
      const oldDoc = entries.find(e => e.id === found.entry.supersedes);
      if (oldDoc && oldDoc.supersededBy === id) {
        oldDoc.supersededBy = undefined;
        oldDoc.updatedAt = new Date().toISOString();
        break;
      }
    }
  }
  if (found.entry.supersededBy) {
    for (const entries of Object.values(data.projects)) {
      const newDoc = entries.find(e => e.id === found.entry.supersededBy);
      if (newDoc && newDoc.supersedes === id) {
        newDoc.supersedes = undefined;
        newDoc.updatedAt = new Date().toISOString();
        break;
      }
    }
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
});
