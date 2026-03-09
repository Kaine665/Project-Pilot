/**
 * GlobalPromptLoader — resolves the global prompt injected into every agent.
 *
 * Reads from ~/.project-pilot/data/prompts/_global.md.
 * File not existing → ok: false (silent skip).
 */

import type { ResourceLoader, LoaderContext } from '../resource-loader';
import type { ResourceRef, ResolvedResource } from '@/types/resource';
import { readFile } from 'fs/promises';
import { getGlobalPromptPath } from '../file-store';

export class GlobalPromptLoader implements ResourceLoader {
  readonly type = 'global-prompt' as const;

  async resolve(ref: ResourceRef, _ctx: LoaderContext): Promise<ResolvedResource> {
    try {
      const content = (await readFile(getGlobalPromptPath(), 'utf-8')).trim();
      return { ref, content, ok: !!content };
    } catch {
      return { ref, content: '', ok: false };
    }
  }
}
