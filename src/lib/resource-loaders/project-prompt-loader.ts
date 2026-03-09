/**
 * ProjectPromptLoader — resolves the project-level prompt.
 *
 * Reads from ~/.project-pilot/data/project-prompts/{projectKey}.md.
 * No projectKey in context, or file not existing → ok: false (silent skip).
 */

import type { ResourceLoader, LoaderContext } from '../resource-loader';
import type { ResourceRef, ResolvedResource } from '@/types/resource';
import { readFile } from 'fs/promises';
import { getProjectPromptPath } from '../file-store';

export class ProjectPromptLoader implements ResourceLoader {
  readonly type = 'project-prompt' as const;

  async resolve(ref: ResourceRef, ctx: LoaderContext): Promise<ResolvedResource> {
    if (!ctx.projectKey) return { ref, content: '', ok: false };
    try {
      const content = (await readFile(getProjectPromptPath(ctx.projectKey), 'utf-8')).trim();
      return { ref, content, ok: !!content };
    } catch {
      return { ref, content: '', ok: false };
    }
  }
}
