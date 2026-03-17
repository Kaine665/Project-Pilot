// Context 单项 API（详见 docs/context-system.md）
// GET 返回 entry 元数据 + 文件内容（供前端编辑器显示）
// PATCH 支持元数据更新 + 内容更新 + fileName 改名（后端支持但前端不暴露）
// DELETE 硬删除：从 index 移除 + 删除内容文件

import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import {
  getContextIndexPath,
  getContextFilePath,
  readJsonFile,
  writeJsonFile,
} from '@/lib/file-store';
import { apiHandler } from '@/lib/api-handler';
import { notFound, conflict } from '@/lib/http-error';
import type { ContextIndexData } from '@/types';
import { generateContextSummary } from '../route';

const DEFAULT_INDEX: ContextIndexData = { entries: [] };

/** GET /api/context/[id] — return entry metadata + file content */
export const GET = apiHandler(async (
  _request: NextRequest,
  { params },
) => {
  const { id } = await params;
  const data = await readJsonFile<ContextIndexData>(getContextIndexPath(), DEFAULT_INDEX);
  const entry = data.entries.find(e => e.id === id);
  if (!entry) throw notFound('Entry not found');

  let content = '';
  try {
    const readPath = entry.sourcePath || getContextFilePath(entry.fileName);
    content = await fs.readFile(readPath, 'utf-8');
  } catch { /* file may not exist yet */ }

  return NextResponse.json({ entry, content });
});

/** PATCH /api/context/[id] — update metadata and/or content */
export const PATCH = apiHandler(async (
  request: NextRequest,
  { params },
) => {
  const { id } = await params;
  const body = await request.json();
  const data = await readJsonFile<ContextIndexData>(getContextIndexPath(), DEFAULT_INDEX);
  const entry = data.entries.find(e => e.id === id);
  if (!entry) throw notFound('Entry not found');

  // Update metadata fields
  if (body.label !== undefined) entry.label = body.label.trim();
  if (body.description !== undefined) entry.description = body.description.trim();
  if (body.format !== undefined && ['json', 'markdown', 'text'].includes(body.format)) {
    entry.format = body.format;
  }
  // Confirm draft → active (or explicit status update)
  if (body.status !== undefined) {
    if (body.status === 'active') {
      delete entry.status; // active is the default, no need to store
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
  entry.updatedAt = new Date().toISOString();

  // Handle fileName rename
  if (body.fileName !== undefined && body.fileName.trim() !== entry.fileName) {
    const oldPath = getContextFilePath(entry.fileName);
    const newFileName = body.fileName.trim();
    const newPath = getContextFilePath(newFileName);

    // Check uniqueness of new fileName
    if (data.entries.some(e => e.id !== id && e.fileName === newFileName)) {
      throw conflict('fileName already exists');
    }

    try {
      await fs.rename(oldPath, newPath);
    } catch { /* old file may not exist */ }
    entry.fileName = newFileName;
  }

  // 手动 summary 更新
  if (body.summary !== undefined) {
    const s = typeof body.summary === 'string' ? body.summary.trim() : '';
    if (s) {
      entry.summary = s;
    } else {
      delete entry.summary;
    }
  }

  // Update content file if provided
  if (body.content !== undefined) {
    await fs.writeFile(getContextFilePath(entry.fileName), body.content, 'utf-8');
    // 内容更新时自动回填 summary（仅当没有手动 summary 时）
    if (!entry.summary) {
      entry.summary = generateContextSummary(body.content, entry.format);
    }
  }

  await writeJsonFile(getContextIndexPath(), data);
  return NextResponse.json({ ok: true, entry });
});

/** DELETE /api/context/[id] — remove from index + delete file (hard delete) */
export const DELETE = apiHandler(async (
  _request: NextRequest,
  { params },
) => {
  const { id } = await params;
  const data = await readJsonFile<ContextIndexData>(getContextIndexPath(), DEFAULT_INDEX);
  const idx = data.entries.findIndex(e => e.id === id);
  if (idx === -1) throw notFound('Entry not found');

  const entry = data.entries[idx];

  // Delete content file (best-effort)
  try {
    await fs.unlink(getContextFilePath(entry.fileName));
  } catch { /* ignore */ }

  // Remove from index
  data.entries.splice(idx, 1);
  await writeJsonFile(getContextIndexPath(), data);

  return NextResponse.json({ ok: true });
});
