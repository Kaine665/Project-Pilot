import { NextRequest, NextResponse } from 'next/server';
import {
  getDesignDocsIndexPath,
  readJsonFile,
} from '@/lib/file-store';
import type { DocsIndexData } from '@/types';

const DEFAULT_INDEX: DocsIndexData = { projects: {} };

/**
 * GET /api/docs/tags?project=xxx
 *
 * 返回所有已使用的标签及其使用次数。
 * 可选按 projectKey 过滤。
 */
export async function GET(request: NextRequest) {
  const projectKey = request.nextUrl.searchParams.get('project');
  const data = await readJsonFile<DocsIndexData>(getDesignDocsIndexPath(), DEFAULT_INDEX);

  const tagCounts = new Map<string, number>();

  const projectKeys = projectKey
    ? [projectKey]
    : Object.keys(data.projects);

  for (const pk of projectKeys) {
    const entries = data.projects[pk] ?? [];
    for (const entry of entries) {
      if (entry.tags) {
        for (const tag of entry.tags) {
          tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
        }
      }
    }
  }

  // 按使用次数降序排列
  const tags = Array.from(tagCounts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  return NextResponse.json({ tags });
}
