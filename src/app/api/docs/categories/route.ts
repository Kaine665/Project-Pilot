import { NextRequest, NextResponse } from 'next/server';
import {
  getDesignDocsIndexPath,
  readJsonFile,
  writeJsonFile,
} from '@/lib/file-store';
import type { CategoryDef, DocsIndexData } from '@/types';

const DEFAULT_INDEX: DocsIndexData = { projects: {} };

/**
 * GET /api/docs/categories?project=xxx
 *
 * 返回分类列表。可选按 projectKey 过滤（包括全局分类）。
 */
export async function GET(request: NextRequest) {
  const projectKey = request.nextUrl.searchParams.get('project');
  const data = await readJsonFile<DocsIndexData>(getDesignDocsIndexPath(), DEFAULT_INDEX);
  const categories = data.categories ?? [];

  if (projectKey) {
    // 返回该项目的分类 + 全局分类
    const filtered = categories.filter(
      c => !c.projectKey || c.projectKey === projectKey,
    );
    return NextResponse.json({ categories: filtered });
  }

  return NextResponse.json({ categories });
}

/**
 * POST /api/docs/categories — 创建分类
 *
 * Body: { name, description?, sortOrder?, projectKey? }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, description, sortOrder, projectKey } = body;

    if (!name?.trim()) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }

    const data = await readJsonFile<DocsIndexData>(getDesignDocsIndexPath(), DEFAULT_INDEX);
    if (!data.categories) data.categories = [];

    // 检查同名分类是否已存在（同 projectKey 范围内）
    const duplicate = data.categories.find(
      c => c.name === name.trim() && (c.projectKey ?? '') === (projectKey?.trim() ?? ''),
    );
    if (duplicate) {
      return NextResponse.json({ error: 'Category with this name already exists' }, { status: 409 });
    }

    const now = new Date().toISOString();
    const category: CategoryDef = {
      id: `cat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: name.trim(),
      description: description?.trim() || undefined,
      sortOrder: typeof sortOrder === 'number' ? sortOrder : undefined,
      projectKey: projectKey?.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    };

    data.categories.push(category);
    await writeJsonFile(getDesignDocsIndexPath(), data);

    return NextResponse.json({ ok: true, category });
  } catch (error) {
    console.error('Create category failed:', error);
    return NextResponse.json({ error: 'Create failed' }, { status: 500 });
  }
}
