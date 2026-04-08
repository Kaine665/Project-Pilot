/**
 * DesignDocsIndexLoader — renders the design-docs index table.
 *
 * Lists all DocEntries as a markdown table, grouped by projectKey.
 * 正文请用 **projectpilot-documents** MCP（\`doc_get\`）或 Read 工具读路径；勿依赖过时的说明。
 *
 * ref.id is always '_all'.
 */

import type { ResourceLoader, LoaderContext } from '../resource-loader';
import type { ResourceRef, ResolvedResource } from '@/types/resource';
import { getDocumentContentPath } from '@/lib/file-store';
import { readDocsIndexFromDocuments } from '@/lib/documents-store';
import type { DocsIndexData, DocEntry } from '@/types';

export class DesignDocsIndexLoader implements ResourceLoader {
  readonly type = 'design-docs-index' as const;

  async resolve(ref: ResourceRef, _ctx: LoaderContext): Promise<ResolvedResource> {
    const data: DocsIndexData = await readDocsIndexFromDocuments();

    // 过滤掉 deprecated 状态的文档——已废弃文档不注入 AI prompt
    const activeProjects: Record<string, DocEntry[]> = {};
    for (const [key, entries] of Object.entries(data.projects)) {
      const active = entries.filter(
        e =>
          (e.documentKind ?? 'design_doc') === 'design_doc' &&
          (e.status ?? 'active') !== 'deprecated',
      );
      if (active.length > 0) activeProjects[key] = active;
    }

    const allEntries = Object.values(activeProjects).flat();
    if (allEntries.length === 0) {
      return { ref, content: '', ok: true };
    }

    const tableHeader = '| 标题 | 描述 | 状态 | 文件路径 |\n|------|------|------|---------|';
    const toRow = (e: DocEntry) => {
      const filePath = e.sourcePath || getDocumentContentPath(e.fileName);
      const desc = e.description || '-';
      const status = e.status === 'draft' ? '📝 draft' : '';
      return `| ${e.title} | ${desc} | ${status} | \`${filePath}\` |`;
    };

    const projectKeys = Object.keys(activeProjects).sort();

    let md = '以下是项目设计文档索引。需要正文时请用 MCP **projectpilot-documents** 的 \`doc_get\`（若已启用 documentsMcp），或使用 Read 工具读取表中的文件路径。\n';

    for (const key of projectKeys) {
      const entries = activeProjects[key];
      if (entries.length === 0) continue;
      md += `\n### ${key}\n${tableHeader}\n${entries.map(toRow).join('\n')}\n`;
    }

    return {
      ref,
      content: md,
      sectionTitle: '设计文档库',
      ok: true,
    };
  }
}
