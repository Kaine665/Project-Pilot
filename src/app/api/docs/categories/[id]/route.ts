import { NextRequest, NextResponse } from 'next/server';
import {
  getDesignDocsIndexPath,
  readJsonFile,
  writeJsonFile,
} from '@/lib/file-store';
import type { DocsIndexData } from '@/types';

const DEFAULT_INDEX: DocsIndexData = { projects: {} };

/**
 * PATCH /api/docs/categories/[id] — 更新分类
 *
 * Body: { name?, description?, sortOrder?, projectKey? }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json();
  const data = await readJsonFile<DocsIndexData>(getDesignDocsIndexPath(), DEFAULT_INDEX);
  const categories = data.categories ?? [];
  const category = categories.find(c => c.id === id);

  if (!category) {
    return NextResponse.json({ error: 'Category not found' }, { status: 404 });
  }

  if (body.name !== undefined) {
    const newName = body.name?.trim();
    if (!newName) {
      return NextResponse.json({ error: 'name cannot be empty' }, { status: 400 });
    }
    // 检查重名（排除自身）
    const duplicate = categories.find(
      c => c.id !== id && c.name === newName && (c.projectKey ?? '') === (category.projectKey ?? ''),
    );
    if (duplicate) {
      return NextResponse.json({ error: 'Category with this name already exists' }, { status: 409 });
    }
    category.name = newName;
  }

  if (body.description !== undefined) {
    category.description = body.description?.trim() || undefined;
  }

  if (body.sortOrder !== undefined) {
    category.sortOrder = typeof body.sortOrder === 'number' ? body.sortOrder : undefined;
  }

  if (body.projectKey !== undefined) {
    category.projectKey = body.projectKey?.trim() || undefined;
  }

  category.updatedAt = new Date().toISOString();

  await writeJsonFile(getDesignDocsIndexPath(), data);
  return NextResponse.json({ ok: true, category });
}

/**
 * DELETE /api/docs/categories/[id] — 删除分类
 *
 * 删除分类后，引用该分类的文档的 category 字段会被清空。
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const data = await readJsonFile<DocsIndexData>(getDesignDocsIndexPath(), DEFAULT_INDEX);
  const categories = data.categories ?? [];
  const idx = categories.findIndex(c => c.id === id);

  if (idx === -1) {
    return NextResponse.json({ error: 'Category not found' }, { status: 404 });
  }

  // 移除分类
  categories.splice(idx, 1);
  data.categories = categories;

  // 清空引用该分类的文档
  const now = new Date().toISOString();
  for (const entries of Object.values(data.projects)) {
    for (const entry of entries) {
      if (entry.category === id) {
        entry.category = undefined;
        entry.updatedAt = now;
      }
    }
  }

  await writeJsonFile(getDesignDocsIndexPath(), data);
  return NextResponse.json({ ok: true });
}
