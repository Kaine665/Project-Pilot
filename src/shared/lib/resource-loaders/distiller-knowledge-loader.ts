/**
 * DistillerKnowledgeLoader — injects Distiller-extracted knowledge into the prompt.
 *
 * Lists DocEntry with documentKind === 'knowledge', tags includes 'distiller',
 * scoped to ctx.projectKey (or _global when no project).
 */

import type { ResourceLoader, LoaderContext } from '../resource-loader';
import type { ResourceRef, ResolvedResource } from '@/types/resource';
import { getDocumentContentPath } from '@/lib/file-store';
import { readDocsIndexFromDocuments } from '@/lib/documents-store';
import type { DocEntry } from '@/types';
import { promises as fs } from 'fs';

const MAX_ENTRIES = 24;
const SUMMARY_CHARS = 200;

function stripDistillerComment(raw: string): string {
  return raw.replace(/^<!--\s*distiller:[^>]+-->\s*/i, '').trim();
}

async function readSummary(entry: DocEntry): Promise<string> {
  const p = entry.sourcePath ?? getDocumentContentPath(entry.fileName);
  try {
    const full = await fs.readFile(p, 'utf-8');
    const body = stripDistillerComment(full);
    if (body.length <= SUMMARY_CHARS) return body;
    return `${body.slice(0, SUMMARY_CHARS)}…`;
  } catch {
    return entry.description?.trim() || '（无法读取正文）';
  }
}

export class DistillerKnowledgeLoader implements ResourceLoader {
  readonly type = 'distiller-knowledge' as const;

  async resolve(ref: ResourceRef, ctx: LoaderContext): Promise<ResolvedResource> {
    const projectKey = ctx.projectKey?.trim();
    if (!projectKey) {
      return { ref, content: '', ok: true };
    }

    const data = await readDocsIndexFromDocuments();
    const flat = Object.values(data.projects).flat();

    const candidates = flat.filter(
      (e: DocEntry) =>
        (e.documentKind ?? 'design_doc') === 'knowledge' &&
        (e.tags ?? []).includes('distiller') &&
        (e.status ?? 'draft') !== 'deprecated' &&
        (e.projectKey === projectKey || e.projectKey === '_global'),
    );

    const sorted = [...candidates].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
    const entries = sorted.slice(0, MAX_ENTRIES);

    if (entries.length === 0) {
      return { ref, content: '', ok: true };
    }

    const lines: string[] = [
      '以下为会话产物（提炼）写入的知识条目（按更新时间倒序）。需要完整内容可用 cat 读取文件路径。',
      '',
    ];

    for (const e of entries) {
      const path = e.sourcePath || getDocumentContentPath(e.fileName);
      const typeTag = (e.tags ?? []).find((t) => t !== 'distiller') ?? '';
      const summary = await readSummary(e);
      lines.push(`- **${e.title}**${typeTag ? ` [\`${typeTag}\`]` : ''}`);
      lines.push(`  - 摘要: ${summary.replace(/\n/g, ' ')}`);
      lines.push(`  - 路径: \`${path}\``);
      lines.push('');
    }

    return {
      ref,
      content: lines.join('\n'),
      sectionTitle: '产物 · 提炼知识摘要',
      ok: true,
    };
  }
}
