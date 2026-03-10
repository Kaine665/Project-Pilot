/**
 * ResourceRegistry — global singleton that maps ResourceType → ResourceLoader.
 *
 * Usage:
 *   import { resourceRegistry } from '@/lib/resource-registry';
 *   const resolved = await resourceRegistry.resolveAll(refs, ctx);
 *   const prompt   = resourceRegistry.formatAsPrompt(resolved);
 */

import type { ResourceRef, ResourceType, ResolvedResource } from '@/types/resource';
import type { ResourceLoader, LoaderContext } from './resource-loader';

class ResourceRegistry {
  private loaders = new Map<ResourceType, ResourceLoader>();

  register(loader: ResourceLoader): void {
    this.loaders.set(loader.type, loader);
  }

  /** Resolve an array of ResourceRefs, returning results sorted by priority (asc). */
  async resolveAll(
    refs: ResourceRef[],
    ctx: LoaderContext,
  ): Promise<ResolvedResource[]> {
    const promises = refs.map(async (ref): Promise<ResolvedResource> => {
      const loader = this.loaders.get(ref.type);
      if (!loader) {
        console.warn(`[ResourceRegistry] No loader for type: ${ref.type}`);
        return { ref, content: '', ok: false };
      }
      try {
        return await loader.resolve(ref, ctx);
      } catch (err) {
        console.error(`[ResourceRegistry] Failed to resolve ${ref.type}:${ref.id}`, err);
        return { ref, content: '', ok: false };
      }
    });

    const results = await Promise.all(promises);
    return results.sort((a, b) => (a.ref.priority ?? 50) - (b.ref.priority ?? 50));
  }

  /**
   * Join resolved resources into a single prompt string.
   *
   * Entries with the same sectionTitle are grouped under one ## heading,
   * separated by `---`. This preserves the original buildPreloadedContextSection
   * format where multiple context entries share one "Agent 预加载上下文" heading.
   *
   * @param maxChars - 总字符数上限（粗估 token 用）。超出时跳过低优先级（priority 大）的资源。
   *                   默认 400,000 字符（约 100K tokens），为对话留出足够空间。
   */
  formatAsPrompt(resolved: ResolvedResource[], maxChars = 400_000): string {
    const valid = resolved.filter(r => r.ok && r.content);
    if (valid.length === 0) return '';

    // 按 priority 已排序（resolveAll 阶段完成），此处按序纳入预算
    let totalChars = 0;
    const included: ResolvedResource[] = [];
    for (const r of valid) {
      const cost = r.content.length + (r.sectionTitle?.length ?? 0) + 20;
      if (totalChars + cost > maxChars) {
        console.warn(`[ResourceRegistry] prompt 超预算，跳过 ${r.ref.type}:${r.ref.id} (priority=${r.ref.priority ?? 50}, cost=${cost})`);
        continue;
      }
      totalChars += cost;
      included.push(r);
    }

    if (included.length === 0) return '';

    const parts: string[] = [];
    let i = 0;

    while (i < included.length) {
      const r = included[i];

      if (!r.sectionTitle) {
        // No heading — emit content directly
        parts.push(r.content);
        i++;
        continue;
      }

      // Collect consecutive entries with the same sectionTitle
      const group: ResolvedResource[] = [r];
      while (i + 1 < included.length && included[i + 1].sectionTitle === r.sectionTitle) {
        i++;
        group.push(included[i]);
      }

      // Emit grouped section
      const preamble = group.find(g => g.sectionPreamble)?.sectionPreamble;
      const body = group.map(g => g.content).join('\n\n---\n\n');
      const preambleText = preamble ? `${preamble}\n\n` : '';
      parts.push(`\n\n## ${r.sectionTitle}\n\n${preambleText}${body}`);
      i++;
    }

    return parts.join('');
  }
}

// ── Singleton (HMR-safe) ──

const g = globalThis as unknown as { __resourceRegistry?: ResourceRegistry };
export const resourceRegistry = g.__resourceRegistry ?? new ResourceRegistry();
if (process.env.NODE_ENV !== 'production') {
  g.__resourceRegistry = resourceRegistry;
}
