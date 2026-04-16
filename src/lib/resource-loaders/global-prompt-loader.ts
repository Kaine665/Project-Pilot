/**
 * GlobalPromptLoader — resolves the global prompt injected into every agent.
 *
 * Resolution order:
 *   1. Segmented mode: {DATA_DIR}/prompts/global.d/ (if _index.json exists)
 *   2. Single file: {DATA_DIR}/prompts/global.md
 *   3. Builtin defaults: {DATA_DIR}/prompts/builtin/global.md（首次从安装种子复制，见 builtin-prompt-materialize）
 *   4. 条件规则: {DATA_DIR}/prompts/global/rules/*.md（frontmatter，见 prompt-rule-files.ts）
 *
 * All missing → ok: false (unless 仅 rules 命中)。
 */

import type { ResourceLoader, LoaderContext } from '../resource-loader';
import type { ResourceRef, ResolvedResource } from '@/types/resource';
import { readFile } from 'fs/promises';
import { getGlobalPromptPath } from '../file-store';
import { readBuiltinGlobalPrompt } from '../builtin-defaults';
import { resolveSegmentedContent } from '../segmented-prompt-store';
import { loadGlobalPromptRulesContent } from '../prompt-rule-files';

export class GlobalPromptLoader implements ResourceLoader {
  readonly type = 'global-prompt' as const;

  async resolve(ref: ResourceRef, ctx: LoaderContext): Promise<ResolvedResource> {
    let base: string | undefined;
    let usedSegmented = false;

    try {
      const segmented = await resolveSegmentedContent({ type: 'global' });
      if (segmented !== undefined) {
        base = segmented;
        usedSegmented = true;
      }
    } catch {
      /* fall through */
    }

    if (!usedSegmented) {
      try {
        const c = (await readFile(getGlobalPromptPath(), 'utf-8')).trim();
        if (c) base = c;
      } catch {
        /* fall through */
      }
    }

    if (!usedSegmented && (base === undefined || base === '')) {
      try {
        const c = (await readBuiltinGlobalPrompt())?.trim();
        if (c) base = c;
      } catch {
        /* fall through */
      }
    }

    const rules = await loadGlobalPromptRulesContent(ctx.promptGlobMatchPaths ?? []);
    let merged = (base ?? '').trim();
    if (rules) {
      merged = merged ? `${merged}\n\n---\n\n${rules}` : rules;
    }

    return { ref, content: merged, ok: !!merged };
  }
}
