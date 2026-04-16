/**
 * ResourceLoader interface — one implementation per ResourceType.
 */

import type { ResourceRef, ResourceType, ResolvedResource } from '@/types/resource';

/** Ambient context passed to every loader (take what you need, ignore the rest) */
export interface LoaderContext {
  agentId?: string;
  projectKey?: string;
  /**
   * 条件注入（globs）用的路径候选：如并行任务 scope、项目根等。
   * 见 `prompt-rule-files.ts`、`global-prompt` / `project-prompt` Loader。
   */
  promptGlobMatchPaths?: string[];
}

/** A loader knows how to resolve one ResourceType into prompt-ready text */
export interface ResourceLoader {
  readonly type: ResourceType;
  resolve(ref: ResourceRef, ctx: LoaderContext): Promise<ResolvedResource>;
}
