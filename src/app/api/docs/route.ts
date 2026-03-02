import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import {
  getDesignDocsDir,
  getDesignDocsIndexPath,
  getDesignDocFilePath,
  readJsonFile,
  writeJsonFile,
} from '@/lib/file-store';
import type { DocEntry, DocsIndexData } from '@/types';

const DEFAULT_INDEX: DocsIndexData = { projects: {} };

async function readIndex(): Promise<DocsIndexData> {
  return readJsonFile<DocsIndexData>(getDesignDocsIndexPath(), DEFAULT_INDEX);
}

async function writeIndex(data: DocsIndexData): Promise<void> {
  await writeJsonFile(getDesignDocsIndexPath(), data);
}

/** GET /api/docs?project=xxx — 返回该项目文档列表；不传 project 返回全量索引 */
export async function GET(request: NextRequest) {
  const projectKey = request.nextUrl.searchParams.get('project');
  const data = await readIndex();

  if (projectKey) {
    return NextResponse.json({ docs: data.projects[projectKey] ?? [] });
  }
  return NextResponse.json({ projects: data.projects });
}

/** POST /api/docs — { projectKey, title, description?, content } */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { projectKey, title, description, content } = body;

    if (!projectKey?.trim()) {
      return NextResponse.json({ error: 'projectKey is required' }, { status: 400 });
    }
    if (!title?.trim()) {
      return NextResponse.json({ error: 'title is required' }, { status: 400 });
    }

    const now = new Date().toISOString();
    const docId = `doc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const fileName = `${docId}.md`;

    const entry: DocEntry = {
      id: docId,
      title: title.trim(),
      description: description?.trim() || undefined,
      fileName,
      projectKey: projectKey.trim(),
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
    await writeIndex(data);

    return NextResponse.json({ ok: true, entry });
  } catch (error) {
    console.error('Create doc failed:', error);
    return NextResponse.json({ error: 'Create failed' }, { status: 500 });
  }
}
