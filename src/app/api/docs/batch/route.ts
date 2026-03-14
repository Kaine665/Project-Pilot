import { NextRequest, NextResponse } from 'next/server';
import {
  getDesignDocsIndexPath,
  readJsonFile,
  writeJsonFile,
} from '@/lib/file-store';
import type { DocsIndexData, DocStatus } from '@/types';

const DEFAULT_INDEX: DocsIndexData = { projects: {} };

/**
 * POST /api/docs/batch — 批量操作
 *
 * Body:
 * {
 *   action: 'set-category' | 'add-tags' | 'remove-tags' | 'set-status',
 *   ids: string[],          // 目标文档 ID 列表
 *   category?: string,      // action=set-category 时使用（空字符串表示清除）
 *   tags?: string[],        // action=add-tags/remove-tags 时使用
 *   status?: DocStatus,     // action=set-status 时使用
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, ids } = body;

    if (!action || !Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json(
        { error: 'action and non-empty ids[] are required' },
        { status: 400 },
      );
    }

    const data = await readJsonFile<DocsIndexData>(getDesignDocsIndexPath(), DEFAULT_INDEX);
    const now = new Date().toISOString();
    const idSet = new Set(ids as string[]);
    let updated = 0;

    // 收集所有匹配的文档
    const matchedEntries = [];
    for (const entries of Object.values(data.projects)) {
      for (const entry of entries) {
        if (idSet.has(entry.id)) {
          matchedEntries.push(entry);
        }
      }
    }

    switch (action) {
      case 'set-category': {
        const category = body.category?.trim() || undefined;
        for (const entry of matchedEntries) {
          entry.category = category;
          entry.updatedAt = now;
          updated++;
        }
        break;
      }

      case 'add-tags': {
        const tagsToAdd: string[] = body.tags;
        if (!Array.isArray(tagsToAdd) || tagsToAdd.length === 0) {
          return NextResponse.json({ error: 'tags[] is required for add-tags' }, { status: 400 });
        }
        const cleanTags = tagsToAdd.map(t => t.trim()).filter(Boolean);
        for (const entry of matchedEntries) {
          const existing = new Set(entry.tags ?? []);
          for (const tag of cleanTags) existing.add(tag);
          entry.tags = Array.from(existing);
          entry.updatedAt = now;
          updated++;
        }
        break;
      }

      case 'remove-tags': {
        const tagsToRemove: string[] = body.tags;
        if (!Array.isArray(tagsToRemove) || tagsToRemove.length === 0) {
          return NextResponse.json({ error: 'tags[] is required for remove-tags' }, { status: 400 });
        }
        const removeSet = new Set(tagsToRemove.map(t => t.trim()));
        for (const entry of matchedEntries) {
          if (entry.tags) {
            entry.tags = entry.tags.filter(t => !removeSet.has(t));
            if (entry.tags.length === 0) entry.tags = undefined;
            entry.updatedAt = now;
            updated++;
          }
        }
        break;
      }

      case 'set-status': {
        const status = body.status as DocStatus;
        if (!status || !['active', 'draft', 'deprecated'].includes(status)) {
          return NextResponse.json(
            { error: 'Valid status (active/draft/deprecated) is required' },
            { status: 400 },
          );
        }
        for (const entry of matchedEntries) {
          entry.status = status;
          entry.updatedAt = now;
          updated++;
        }
        break;
      }

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}. Supported: set-category, add-tags, remove-tags, set-status` },
          { status: 400 },
        );
    }

    await writeJsonFile(getDesignDocsIndexPath(), data);
    return NextResponse.json({ ok: true, updated });
  } catch (error) {
    console.error('Batch operation failed:', error);
    return NextResponse.json({ error: 'Batch operation failed' }, { status: 500 });
  }
}
