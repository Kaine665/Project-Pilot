/**
 * ProjectPromptLoader — resolves the project-level prompt.
 *
 * Resolution order:
 *   1. Segmented mode: prompts/projects/{projectKey}.d/ (if _index.json exists)
 *   2. Single file: prompts/projects/{projectKey}.md
 *
 * No projectKey in context, or file not existing → ok: false (silent skip).
 */

import type { ResourceLoader, LoaderContext } from '../resource-loader';
import type { ResourceRef, ResolvedResource } from '@/types/resource';
import { readFile } from 'fs/promises';
import { getProjectPromptPath } from '../file-store';
import { resolveSegmentedContent } from '../segmented-prompt-store';

export class ProjectPromptLoader implements ResourceLoader {
  readonly type = 'project-prompt' as const;

  async resolve(ref: ResourceRef, ctx: LoaderContext): Promise<ResolvedResource> {
    if (!ctx.projectKey) return { ref, content: '', ok: false };

    // 1. Try segmented mode first
    try {
      const segmented = await resolveSegmentedContent({
        type: 'project',
        projectKey: ctx.projectKey,
      });
      if (segmented !== undefined) {
        return { ref, content: segmented, ok: !!segmented };
      }
    } catch {
      // Segmented mode failed — fall through to single file
    }

    // 2. Fallback to single .md file
    try {
      const content = (await readFile(getProjectPromptPath(ctx.projectKey), 'utf-8')).trim();
      return { ref, content, ok: !!content };
    } catch {
      return { ref, content: '', ok: false };
    }
  }
}
