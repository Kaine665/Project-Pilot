// Context 集合 API（详见 docs/context-system.md）
// 索引 + 内容文件分离：POST 同时写 index.json 和内容文件
// 硬删除策略：不走回收站（配置数据，不需要软删除）

import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import {
  getContextIndexPath,
  getContextDir,
  getContextFilePath,
  readJsonFile,
  writeJsonFile,
} from '@/lib/file-store';
import { apiHandler } from '@/lib/api-handler';
import { badRequest, conflict } from '@/lib/http-error';
import type { ContextEntry, ContextIndexData } from '@/types';

/** 纯规则摘要生成（不依赖 AI），用于创建/更新时自动回填 summary */
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
    const headings = lines.filter(l => /^#{1,3}\s/.test(l));
    if (headings.length > 0) {
      return headings.slice(0, 15).join('\n').slice(0, MAX);
    }
  }
  return content.slice(0, MAX);
}

const DEFAULT_INDEX: ContextIndexData = { entries: [] };

async function readIndex(): Promise<ContextIndexData> {
  return readJsonFile<ContextIndexData>(getContextIndexPath(), DEFAULT_INDEX);
}

async function writeIndex(data: ContextIndexData): Promise<void> {
  await writeJsonFile(getContextIndexPath(), data);
}

/** GET /api/context — list all context entries (optionally filtered by projectKey) */
export const GET = apiHandler(async (request: NextRequest) => {
  const data = await readIndex();
  const projectKey = request.nextUrl.searchParams.get('projectKey');
  let entries = data.entries;
  if (projectKey) {
    entries = entries.filter(e => !e.projectKey || e.projectKey === projectKey);
  }
  return NextResponse.json({ entries });
});

/** POST /api/context — create a new context entry + content file */
export const POST = apiHandler(async (request: NextRequest) => {
  const { label, description, fileName, format, content, group, sourcePath, tags, status, sourceAgentSessionId, producedAt, projectKey, summary: manualSummary } = await request.json();

  if (!label?.trim()) throw badRequest('label is required');
  if (!fileName?.trim()) throw badRequest('fileName is required');
  if (!['json', 'markdown', 'text'].includes(format)) throw badRequest('format must be json, markdown, or text');

  const trimmedFileName = fileName.trim();

  // Check fileName uniqueness
  const data = await readIndex();
  if (data.entries.some(e => e.fileName === trimmedFileName)) {
    throw conflict('fileName already exists');
  }

  const now = new Date().toISOString();
  const trimmedGroup = group?.trim() || undefined;
  const trimmedProjectKey = projectKey?.trim() || undefined;
  const trimmedSourcePath = sourcePath?.trim() || undefined;
  const trimmedStatus = status === 'draft' ? 'draft' : undefined; // only 'draft' is stored; 'active' is default
  const trimmedSourceAgentSessionId = sourceAgentSessionId?.trim() || undefined;
  const trimmedProducedAt = producedAt?.trim() || undefined;

  // 自动生成 summary（用户手动提供时优先使用，否则从内容提取）
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
    ...(Array.isArray(tags) && tags.length ? { tags: tags.filter((t: unknown) => typeof t === 'string' && t.trim()).map((t: string) => t.trim()) } : {}),
    ...(trimmedStatus ? { status: trimmedStatus } : {}),
    ...(trimmedSourceAgentSessionId ? { sourceAgentSessionId: trimmedSourceAgentSessionId } : {}),
    ...(trimmedProducedAt ? { producedAt: trimmedProducedAt } : {}),
    ...(finalSummary ? { summary: finalSummary } : {}),
    createdAt: now,
    updatedAt: now,
  };

  // 有 sourcePath 时内容在外部文件，不写本地副本；否则写入 context/ 目录
  if (!trimmedSourcePath) {
    const contextDir = getContextDir();
    await fs.mkdir(contextDir, { recursive: true });
    const filePath = getContextFilePath(entry.fileName);
    await fs.writeFile(filePath, content ?? '', 'utf-8');
  }

  // Update index
  data.entries.push(entry);
  await writeIndex(data);

  return NextResponse.json({ ok: true, entry });
});
