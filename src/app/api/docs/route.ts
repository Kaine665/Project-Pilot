import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import {
  getDesignDocsDir,
  getDesignDocsIndexPath,
  getDesignDocFilePath,
  readJsonFile,
  writeJsonFile,
} from '@/lib/file-store';
import { apiHandler } from '@/lib/api-handler';
import { badRequest } from '@/lib/http-error';
import type { DocEntry, DocsIndexData, DocStatus } from '@/types';

const DEFAULT_INDEX: DocsIndexData = { projects: {} };

async function readIndex(): Promise<DocsIndexData> {
  return readJsonFile<DocsIndexData>(getDesignDocsIndexPath(), DEFAULT_INDEX);
}

async function writeIndex(data: DocsIndexData): Promise<void> {
  await writeJsonFile(getDesignDocsIndexPath(), data);
}

/**
 * GET /api/docs — 查询文档列表
 *
 * Query params:
 *   project    — 按项目过滤（不传返回全量索引）
 *   category   — 按分类 ID 过滤
 *   tag        — 按标签过滤（可多次出现，OR 关系）
 *   status     — 按状态过滤（active/draft/deprecated），默认不过滤
 */
export const GET = apiHandler(async (request: NextRequest) => {
  const sp = request.nextUrl.searchParams;
  const projectKey = sp.get('project');
  const category = sp.get('category');
  const tags = sp.getAll('tag');
  const status = sp.get('status') as DocStatus | null;

  const data = await readIndex();

  const hasFilters = category || tags.length > 0 || status;

  // 无过滤参数：原有行为
  if (!hasFilters) {
    if (projectKey) {
      return NextResponse.json({ docs: data.projects[projectKey] ?? [] });
    }
    return NextResponse.json({ projects: data.projects });
  }

  // 有过滤参数：遍历并过滤
  const projectKeys = projectKey
    ? [projectKey]
    : Object.keys(data.projects);

  const filtered: DocEntry[] = [];
  for (const pk of projectKeys) {
    const entries = data.projects[pk] ?? [];
    for (const entry of entries) {
      // 状态过滤
      if (status) {
        const docStatus = entry.status ?? 'active';
        if (docStatus !== status) continue;
      }
      // 分类过滤
      if (category && entry.category !== category) continue;
      // 标签过滤（OR：文档包含任一指定标签即匹配）
      if (tags.length > 0) {
        const docTags = entry.tags ?? [];
        if (!tags.some(t => docTags.includes(t))) continue;
      }
      filtered.push(entry);
    }
  }

  return NextResponse.json({ docs: filtered });
});

/** POST /api/docs — { projectKey, title, description?, content?, category?, tags?, status?, supersedes? } */
export const POST = apiHandler(async (request: NextRequest) => {
  const body = await request.json();
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

  // 确保目录存在，写入 Markdown 文件
  await fs.mkdir(getDesignDocsDir(), { recursive: true });
  await fs.writeFile(getDesignDocFilePath(fileName), content ?? '', 'utf-8');

  // 更新索引
  const data = await readIndex();
  if (!data.projects[entry.projectKey]) {
    data.projects[entry.projectKey] = [];
  }
  data.projects[entry.projectKey].push(entry);

  // 如果设置了 supersedes，更新被替代文档的 supersededBy
  if (entry.supersedes) {
    for (const entries of Object.values(data.projects)) {
      const oldDoc = entries.find(e => e.id === entry.supersedes);
      if (oldDoc) {
        oldDoc.supersededBy = docId;
        oldDoc.updatedAt = now;
        break;
      }
    }
  }

  await writeIndex(data);

  return NextResponse.json({ ok: true, entry });
});
