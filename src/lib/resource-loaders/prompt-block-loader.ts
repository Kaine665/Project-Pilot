/**
 * PromptBlockLoader — resolves reusable prompt fragments.
 *
 * ref.id = blockId → reads from prompts/blocks/{blockId}.md
 * Content is injected raw (no section heading), just like system-prompt.
 */

import { readFile } from 'fs/promises';
import { getPromptBlockPath } from '@/lib/file-store';
import type { ResourceLoader, LoaderContext } from '../resource-loader';
import type { ResourceRef, ResolvedResource } from '@/types/resource';

export class PromptBlockLoader implements ResourceLoader {
  readonly type = 'prompt-block' as const;

  async resolve(ref: ResourceRef, _ctx: LoaderContext): Promise<ResolvedResource> {
    try {
      const filePath = getPromptBlockPath(ref.id);
      const content = await readFile(filePath, 'utf-8');
      return {
        ref,
        content: content.trim(),
        // No sectionTitle — prompt blocks are injected raw, blending into the system prompt
        ok: !!content.trim(),
      };
    } catch {
      console.warn(`[PromptBlockLoader] Block not found: ${ref.id}`);
      return { ref, content: '', ok: false };
    }
  }
}
