/**
 * ProjectPromptLoader — resolves the project-level prompt.
 *
 * Resolution order:
 *   1. Segmented mode: prompts/projects/{projectKey}.d/ (if _index.json exists)
 *   2. Single file: prompts/projects/{projectKey}.md
 *   3. 条件规则: prompts/projects/{projectKey}/rules/*.md（frontmatter）
 *
 * No projectKey in context, or file not existing → ok: false (unless 仅 rules 命中)。
 */

import type { ResourceLoader, LoaderContext } from '../resource-loader';
import type { ResourceRef, ResolvedResource } from '@/types/resource';
import { readFile } from 'fs/promises';
import { getProjectPromptPath } from '../file-store';
import { resolveSegmentedContent } from '../segmented-prompt-store';
import { loadProjectPromptRulesContent } from '../prompt-rule-files';

export class ProjectPromptLoader implements ResourceLoader {
  readonly type = 'project-prompt' as const;

  async resolve(ref: ResourceRef, ctx: LoaderContext): Promise<ResolvedResource> {
    if (!ctx.projectKey) return { ref, content: '', ok: false };

    let base: string | undefined;
    let usedSegmented = false;

    try {
      const segmented = await resolveSegmentedContent({
        type: 'project',
        projectKey: ctx.projectKey,
      });
      if (segmented !== undefined) {
        base = segmented;
        usedSegmented = true;
      }
    } catch {
      /* fall through */
    }

    if (!usedSegmented) {
      try {
        const c = (await readFile(getProjectPromptPath(ctx.projectKey), 'utf-8')).trim();
        if (c) base = c;
      } catch {
        /* fall through */
      }
    }

    const rules = await loadProjectPromptRulesContent(ctx.projectKey, ctx.promptGlobMatchPaths ?? []);
    let merged = (base ?? '').trim();
    if (rules) {
      merged = merged ? `${merged}\n\n---\n\n${rules}` : rules;
    }

    return { ref, content: merged, ok: !!merged };
  }
}
