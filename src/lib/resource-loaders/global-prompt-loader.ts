/**
 * GlobalPromptLoader — resolves the global prompt injected into every agent.
 *
 * Priority:
 *   1. User data dir: ~/.project-pilot/data/prompts/_global.md
 *   2. Builtin defaults: src/data/defaults/prompts/_global.md
 *
 * Both missing → ok: false (silent skip).
 */

import type { ResourceLoader, LoaderContext } from '../resource-loader';
import type { ResourceRef, ResolvedResource } from '@/types/resource';
import { readFile } from 'fs/promises';
import { getGlobalPromptPath } from '../file-store';
import { readBuiltinGlobalPrompt } from '../builtin-defaults';

export class GlobalPromptLoader implements ResourceLoader {
  readonly type = 'global-prompt' as const;

  async resolve(ref: ResourceRef, _ctx: LoaderContext): Promise<ResolvedResource> {
    // 1. Try user data directory
    try {
      const content = (await readFile(getGlobalPromptPath(), 'utf-8')).trim();
      if (content) {
        return { ref, content, ok: true };
      }
    } catch {
      // File not found — fall through to defaults
    }

    // 2. Fallback to builtin defaults
    try {
      const content = (await readBuiltinGlobalPrompt())?.trim();
      if (content) {
        return { ref, content, ok: true };
      }
    } catch {
      // Defaults not found either
    }

    return { ref, content: '', ok: false };
  }
}
