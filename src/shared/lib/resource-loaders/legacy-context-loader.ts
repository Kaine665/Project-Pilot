/**
 * 兼容旧版 Todo / 会话里保存的 type: "context" 的 ResourceRef。
 * 新版应使用 flow-context、inline-text 等具体类型。
 */

import type { ResourceLoader, LoaderContext } from '../resource-loader';
import type { ResourceRef, ResolvedResource } from '@/types/resource';

export class LegacyContextLoader implements ResourceLoader {
  readonly type = 'context' as const;

  async resolve(ref: ResourceRef, _ctx: LoaderContext): Promise<ResolvedResource> {
    const r = ref as ResourceRef & { inlineContent?: string; content?: string };
    const text = (typeof r.inlineContent === 'string' ? r.inlineContent : '')
      || (typeof r.content === 'string' ? r.content : '')
      || '';
    const trimmed = text.trim();
    return {
      ref,
      content: trimmed,
      sectionTitle: ref.label,
      ok: trimmed.length > 0,
    };
  }
}
