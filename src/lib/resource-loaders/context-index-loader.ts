/**
 * ContextIndexLoader — renders the global context index table.
 *
 * Mirrors the original buildContextSection() logic:
 *   - Lists all active ContextEntries as a markdown table
 *   - Grouped by entry.group (ungrouped first)
 *   - AI can `cat` any file path to read its content
 *
 * ref.id is always '_all'.
 */

import type { ResourceLoader, LoaderContext } from '../resource-loader';
import type { ResourceRef, ResolvedResource } from '@/types/resource';
import { getContextIndexPath, getContextFilePath, readJsonFile } from '@/lib/file-store';
import type { ContextIndexData, ContextEntry } from '@/types';

export class ContextIndexLoader implements ResourceLoader {
  readonly type = 'context-index' as const;

  async resolve(ref: ResourceRef, ctx: LoaderContext): Promise<ResolvedResource> {
    const data = await readJsonFile<ContextIndexData>(getContextIndexPath(), { entries: [] });
    let activeEntries = data.entries.filter(e => !e.status || e.status === 'active');
    // 按项目过滤：包含全局条目 + 当前项目条目
    if (ctx.projectKey) {
      activeEntries = activeEntries.filter(e => !e.projectKey || e.projectKey === ctx.projectKey);
    }
    if (activeEntries.length === 0) {
      return { ref, content: '', ok: true };
    }

    const tableHeader = '| 标签 | 描述 | 文件路径 | 原始文件路径 |\n|------|------|---------|------------|';
    const toRow = (e: ContextEntry) => {
      const filePath = getContextFilePath(e.fileName);
      const sourceCol = e.sourcePath ? `\`${e.sourcePath}\`` : '-';
      return `| ${e.label} | ${e.description} | \`${filePath}\` | ${sourceCol} |`;
    };

    const groups = [...new Set(activeEntries.map(e => e.group).filter((g): g is string => !!g))].sort();
    const ungrouped = activeEntries.filter(e => !e.group);

    let md = '以下是用户配置的上下文信息索引。需要时可通过 bash 的 cat 命令读取具体文件内容。\n';

    if (ungrouped.length > 0) {
      md += `\n${tableHeader}\n${ungrouped.map(toRow).join('\n')}\n`;
    }

    for (const group of groups) {
      const groupEntries = data.entries.filter(e => e.group === group && (!e.status || e.status === 'active'));
      md += `\n### ${group}\n${tableHeader}\n${groupEntries.map(toRow).join('\n')}\n`;
    }

    return {
      ref,
      content: md,
      sectionTitle: '可用上下文信息',
      ok: true,
    };
  }
}
