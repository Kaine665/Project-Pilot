/**
 * GlobalPromptLoader — resolves the global prompt injected into every agent.
 *
 * Resolution order:
 *   1. Segmented mode: {DATA_DIR}/prompts/global.d/ (if _index.json exists)
 *   2. Single file: {DATA_DIR}/prompts/global.md
 *   3. Builtin defaults: src/data/defaults/prompts/_global.md
 *
 * All missing → ok: false (silent skip).
 */

import type { ResourceLoader, LoaderContext } from '../resource-loader';
import type { ResourceRef, ResolvedResource } from '@/types/resource';
import { readFile } from 'fs/promises';
import { getGlobalPromptPath } from '../file-store';
import { readBuiltinGlobalPrompt } from '../builtin-defaults';
import { resolveSegmentedContent } from '../segmented-prompt-store';

export class GlobalPromptLoader implements ResourceLoader {
  readonly type = 'global-prompt' as const;

  async resolve(ref: ResourceRef, _ctx: LoaderContext): Promise<ResolvedResource> {
    // 1. Try segmented mode first
    try {
      const segmented = await resolveSegmentedContent({ type: 'global' });
      if (segmented !== undefined) {
        // In segmented mode — even empty string means "segmented but all disabled"
        return { ref, content: segmented, ok: !!segmented };
      }
    } catch {
      // Segmented mode failed — fall through to single file
    }

    // 2. Try single .md file in user data directory
    try {
      const content = (await readFile(getGlobalPromptPath(), 'utf-8')).trim();
      if (content) {
        return { ref, content, ok: true };
      }
    } catch {
      // File not found — fall through to defaults
    }

    // 3. Fallback to builtin defaults
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
