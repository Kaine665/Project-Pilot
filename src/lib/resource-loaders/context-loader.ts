/**
 * ContextResourceLoader — resolves a single ContextEntry by expanding its file content.
 *
 * ref.id = ContextEntry.id (e.g. "ctx-1740464738582-a3f")
 *
 * Multiple context refs with sectionTitle "Agent 预加载上下文" are grouped by
 * ResourceRegistry.formatAsPrompt() under one ## heading, separated by `---`.
 * This matches the original buildPreloadedContextSection() output exactly.
 */

import { readFile } from 'fs/promises';
import type { ResourceLoader, LoaderContext } from '../resource-loader';
import type { ResourceRef, ResolvedResource } from '@/types/resource';
import { getContextIndexPath, getContextFilePath, readJsonFile } from '@/lib/file-store';
import type { ContextIndexData } from '@/types';

export class ContextResourceLoader implements ResourceLoader {
  readonly type = 'context' as const;

  async resolve(ref: ResourceRef, _ctx: LoaderContext): Promise<ResolvedResource> {
    const data = await readJsonFile<ContextIndexData>(getContextIndexPath(), { entries: [] });
    const entry = data.entries.find(e => e.id === ref.id && (!e.status || e.status === 'active'));
    if (!entry) {
      return { ref, content: '', ok: false };
    }

    try {
      const filePath = getContextFilePath(entry.fileName);
      const content = await readFile(filePath, 'utf-8');
      return {
        ref,
        content: `### ${entry.label}\n\n${content.trim()}`,
        sectionTitle: 'Agent 预加载上下文',
        sectionPreamble: '以下上下文已由配置自动加载，无需手动读取：',
        ok: true,
      };
    } catch {
      return { ref, content: '', ok: false };
    }
  }
}
