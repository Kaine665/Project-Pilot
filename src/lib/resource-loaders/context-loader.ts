/**
 * ContextResourceLoader — resolves a single ContextEntry by expanding its content.
 *
 * ref.id = ContextEntry.id (e.g. "ctx-1740464738582-a3f")
 *
 * 注入模式（ref.injectMode）：
 * - 'summary'（默认）：注入摘要文本，大幅减少 token 消耗
 *   摘要 fallback 链：entry.summary → description（>20字符）→ 文件前 N 字符
 * - 'full'：注入完整文件内容（向后兼容 Agent defaultResources 中明确配置的 context）
 *
 * Multiple context refs with sectionTitle "Agent 预加载上下文" are grouped by
 * ResourceRegistry.formatAsPrompt() under one ## heading, separated by `---`.
 */

import { readFile } from 'fs/promises';
import type { ResourceLoader, LoaderContext } from '../resource-loader';
import type { ResourceRef, ResolvedResource } from '@/types/resource';
import { getContextIndexPath, getContextFilePath, readJsonFile } from '@/lib/file-store';
import type { ContextIndexData, ContextEntry } from '@/types';

const SUMMARY_MAX_CHARS = 800;

/** 纯规则摘要生成：JSON 提取 key 结构，Markdown 提取标题，text 取前 N 字符 */
async function buildSummary(entry: ContextEntry, filePath: string): Promise<string> {
  // 1. 优先使用显式 summary
  if (entry.summary) return entry.summary;

  // 2. description 足够长时用作摘要
  if (entry.description && entry.description.length > 20) return entry.description;

  // 3. 读取文件内容提取摘要
  let content: string;
  try {
    content = await readFile(filePath, 'utf-8');
  } catch {
    return entry.description || '';
  }

  if (entry.format === 'json') {
    try {
      const obj = JSON.parse(content);
      if (Array.isArray(obj)) {
        const firstItem = obj[0];
        const firstStr = firstItem ? JSON.stringify(firstItem, null, 2).slice(0, 300) : '';
        return `JSON 数组，${obj.length} 项。首项结构：\n${firstStr}`.slice(0, SUMMARY_MAX_CHARS);
      }
      const keys = Object.keys(obj);
      return `JSON 对象，字段: ${keys.join(', ')}`.slice(0, SUMMARY_MAX_CHARS);
    } catch {
      return content.slice(0, SUMMARY_MAX_CHARS);
    }
  }

  if (entry.format === 'markdown') {
    const lines = content.split('\n');
    const headings = lines.filter(l => /^#{1,3}\s/.test(l));
    if (headings.length > 0) {
      return headings.slice(0, 15).join('\n').slice(0, SUMMARY_MAX_CHARS);
    }
  }

  return content.slice(0, SUMMARY_MAX_CHARS);
}

export class ContextResourceLoader implements ResourceLoader {
  readonly type = 'context' as const;

  async resolve(ref: ResourceRef, _ctx: LoaderContext): Promise<ResolvedResource> {
    const data = await readJsonFile<ContextIndexData>(getContextIndexPath(), { entries: [] });
    const entry = data.entries.find(e => e.id === ref.id && (!e.status || e.status === 'active'));
    if (!entry) {
      return { ref, content: '', ok: false };
    }

    try {
      // sourcePath 优先：从外部文件读取；否则从 context/ 目录读取
      const filePath = entry.sourcePath || getContextFilePath(entry.fileName);
      const injectMode = ref.injectMode ?? 'summary';

      if (injectMode === 'full') {
        // 向后兼容：注入完整文件内容（Agent defaultResources 中明确配置的 context）
        const content = await readFile(filePath, 'utf-8');
        return {
          ref,
          content: `### ${entry.label}\n\n${content.trim()}`,
          sectionTitle: 'Agent 预加载上下文',
          sectionPreamble: '以下上下文已由配置自动加载，无需手动读取：',
          ok: true,
        };
      }

      // 默认摘要模式：注入摘要 + 文件路径提示
      const summaryText = await buildSummary(entry, filePath);
      return {
        ref,
        content: `### ${entry.label}\n\n${summaryText.trim()}\n\n*完整内容: \`${filePath}\`（可通过 cat 命令读取）*`,
        sectionTitle: 'Agent 预加载上下文',
        sectionPreamble: '以下是上下文摘要。需要完整内容时，使用 cat 命令读取文件路径。',
        ok: true,
      };
    } catch {
      return { ref, content: '', ok: false };
    }
  }
}
