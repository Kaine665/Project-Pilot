/**
 * ResourceLoader interface — one implementation per ResourceType.
 */

import type { ResourceRef, ResourceType, ResolvedResource } from '@/types/resource';

/** Ambient context passed to every loader (take what you need, ignore the rest) */
export interface LoaderContext {
  agentId?: string;
  projectKey?: string;
}

/** A loader knows how to resolve one ResourceType into prompt-ready text */
export interface ResourceLoader {
  readonly type: ResourceType;
  resolve(ref: ResourceRef, ctx: LoaderContext): Promise<ResolvedResource>;
}
