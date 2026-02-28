/**
 * SystemPromptLoader — resolves the agent's system prompt.
 *
 * ref.id = agentId. The actual prompt text is passed via LoaderContext
 * since the caller (AgentChatManager) already has the Agent object loaded.
 *
 * We extend LoaderContext with systemPromptText to avoid re-reading the
 * agent from disk inside the loader.
 */

import type { ResourceLoader, LoaderContext } from '../resource-loader';
import type { ResourceRef, ResolvedResource } from '@/types/resource';

export interface SystemPromptLoaderContext extends LoaderContext {
  /** The resolved system prompt text (from agent.systemPrompt or fallback) */
  systemPromptText?: string;
}

export class SystemPromptLoader implements ResourceLoader {
  readonly type = 'system-prompt' as const;

  async resolve(ref: ResourceRef, ctx: LoaderContext): Promise<ResolvedResource> {
    const text = (ctx as SystemPromptLoaderContext).systemPromptText ?? '';
    return {
      ref,
      content: text,
      // No sectionTitle — system prompt is raw, not wrapped in ##
      ok: !!text,
    };
  }
}
