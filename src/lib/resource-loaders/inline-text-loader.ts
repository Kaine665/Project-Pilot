/**
 * InlineTextLoader — resolves inline text snippets.
 *
 * Content is stored directly in the ref (InlineTextRef.inlineContent).
 */

import type { ResourceLoader, LoaderContext } from '../resource-loader';
import type { ResourceRef, ResolvedResource, InlineTextRef } from '@/types/resource';

export class InlineTextLoader implements ResourceLoader {
  readonly type = 'inline-text' as const;

  async resolve(ref: ResourceRef, _ctx: LoaderContext): Promise<ResolvedResource> {
    const textRef = ref as InlineTextRef;
    const content = textRef.inlineContent ?? '';
    return {
      ref,
      content,
      sectionTitle: ref.label,
      ok: !!content,
    };
  }
}
