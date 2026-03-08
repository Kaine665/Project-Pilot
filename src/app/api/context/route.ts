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
import type { ContextEntry, ContextIndexData } from '@/types';

const DEFAULT_INDEX: ContextIndexData = { entries: [] };

async function readIndex(): Promise<ContextIndexData> {
  return readJsonFile<ContextIndexData>(getContextIndexPath(), DEFAULT_INDEX);
}

async function writeIndex(data: ContextIndexData): Promise<void> {
  await writeJsonFile(getContextIndexPath(), data);
}

/** GET /api/context — list all context entries (optionally filtered by project) */
export async function GET(request: NextRequest) {
  const data = await readIndex();
  const projectFilter = request.nextUrl.searchParams.get('project');
  let filtered = data.entries;
  if (projectFilter) {
    filtered = filtered.filter(e => !e.projectKey || e.projectKey === projectFilter);
  }
  return NextResponse.json({ entries: filtered });
}

/** POST /api/context — create a new context entry + content file */
export async function POST(request: NextRequest) {
  const { label, description, fileName, format, content, group, sourcePath, status, sourceAgentSessionId, producedAt, projectKey } = await request.json();

  if (!label?.trim()) {
    return NextResponse.json({ error: 'label is required' }, { status: 400 });
  }
  if (!fileName?.trim()) {
    return NextResponse.json({ error: 'fileName is required' }, { status: 400 });
  }
  if (!['json', 'markdown', 'text'].includes(format)) {
    return NextResponse.json({ error: 'format must be json, markdown, or text' }, { status: 400 });
  }

  const trimmedFileName = fileName.trim();

  // Check fileName uniqueness
  const data = await readIndex();
  if (data.entries.some(e => e.fileName === trimmedFileName)) {
    return NextResponse.json({ error: 'fileName already exists' }, { status: 409 });
  }

  const now = new Date().toISOString();
  const trimmedGroup = group?.trim() || undefined;
  const trimmedProjectKey = projectKey?.trim() || undefined;
  const trimmedSourcePath = sourcePath?.trim() || undefined;
  const trimmedStatus = status === 'draft' ? 'draft' : undefined; // only 'draft' is stored; 'active' is default
  const trimmedSourceAgentSessionId = sourceAgentSessionId?.trim() || undefined;
  const trimmedProducedAt = producedAt?.trim() || undefined;

  const entry: ContextEntry = {
    id: `ctx-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    label: label.trim(),
    description: (description ?? '').trim(),
    fileName: trimmedFileName,
    format,
    ...(trimmedGroup ? { group: trimmedGroup } : {}),
    ...(trimmedProjectKey ? { projectKey: trimmedProjectKey } : {}),
    ...(trimmedSourcePath ? { sourcePath: trimmedSourcePath } : {}),
    ...(trimmedStatus ? { status: trimmedStatus } : {}),
    ...(trimmedSourceAgentSessionId ? { sourceAgentSessionId: trimmedSourceAgentSessionId } : {}),
    ...(trimmedProducedAt ? { producedAt: trimmedProducedAt } : {}),
    createdAt: now,
    updatedAt: now,
  };

  // Ensure context dir exists, write content file
  const contextDir = getContextDir();
  await fs.mkdir(contextDir, { recursive: true });
  const filePath = getContextFilePath(entry.fileName);
  await fs.writeFile(filePath, content ?? '', 'utf-8');

  // Update index
  data.entries.push(entry);
  await writeIndex(data);

  return NextResponse.json({ ok: true, entry });
}
