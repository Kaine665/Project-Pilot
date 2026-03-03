/**
 * DesignDocsIndexLoader — renders the design-docs index table.
 *
 * Lists all DocEntries as a markdown table, grouped by projectKey.
 * AI can `cat` any file path to read the full document content.
 *
 * ref.id is always '_all'.
 */

import type { ResourceLoader, LoaderContext } from '../resource-loader';
import type { ResourceRef, ResolvedResource } from '@/types/resource';
import { getDesignDocsIndexPath, getDesignDocFilePath, readJsonFile } from '@/lib/file-store';
import type { DocsIndexData, DocEntry } from '@/types';

export class DesignDocsIndexLoader implements ResourceLoader {
  readonly type = 'design-docs-index' as const;

  async resolve(ref: ResourceRef, _ctx: LoaderContext): Promise<ResolvedResource> {
    const data = await readJsonFile<DocsIndexData>(getDesignDocsIndexPath(), { projects: {} });

    const allEntries = Object.values(data.projects).flat();
    if (allEntries.length === 0) {
      return { ref, content: '', ok: true };
    }

    const tableHeader = '| 标题 | 描述 | 文件路径 |\n|------|------|---------|';
    const toRow = (e: DocEntry) => {
      const filePath = getDesignDocFilePath(e.fileName);
      const desc = e.description || '-';
      return `| ${e.title} | ${desc} | \`${filePath}\` |`;
    };

    const projectKeys = Object.keys(data.projects).sort();

    let md = '以下是项目设计文档索引。需要时可通过 bash 的 cat 命令读取具体文件内容。\n';

    for (const key of projectKeys) {
      const entries = data.projects[key];
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
