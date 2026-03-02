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
    const results: ResolvedResource[] = [];

    for (const ref of refs) {
      const loader = this.loaders.get(ref.type);
      if (!loader) {
        console.warn(`[ResourceRegistry] No loader for type: ${ref.type}`);
        results.push({ ref, content: '', ok: false });
        continue;
      }
      try {
        results.push(await loader.resolve(ref, ctx));
      } catch (err) {
        console.error(`[ResourceRegistry] Failed to resolve ${ref.type}:${ref.id}`, err);
        results.push({ ref, content: '', ok: false });
      }
    }

    return results.sort((a, b) => (a.ref.priority ?? 50) - (b.ref.priority ?? 50));
  }

  /**
   * Join resolved resources into a single prompt string.
   *
   * Entries with the same sectionTitle are grouped under one ## heading,
   * separated by `---`. This preserves the original buildPreloadedContextSection
   * format where multiple context entries share one "Agent 预加载上下文" heading.
   */
  formatAsPrompt(resolved: ResolvedResource[]): string {
    const valid = resolved.filter(r => r.ok && r.content);
    if (valid.length === 0) return '';

    const parts: string[] = [];
    let i = 0;

    while (i < valid.length) {
      const r = valid[i];

      if (!r.sectionTitle) {
        // No heading — emit content directly
        parts.push(r.content);
        i++;
        continue;
      }

      // Collect consecutive entries with the same sectionTitle
      const group: ResolvedResource[] = [r];
      while (i + 1 < valid.length && valid[i + 1].sectionTitle === r.sectionTitle) {
        i++;
        group.push(valid[i]);
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
