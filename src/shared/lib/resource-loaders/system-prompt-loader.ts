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
import { resolveSegmentedContent } from '../segmented-prompt-store';

export interface SystemPromptLoaderContext extends LoaderContext {
  /** The resolved system prompt text (from agent.systemPrompt or fallback) */
  systemPromptText?: string;
  /** Agent ID — used to check for segmented agent prompts */
  agentId?: string;
  /** Absolute path to the prompt .md file — injected when exposePromptPath is enabled */
  promptFilePath?: string;
  /** Absolute path to the session prompt override working copy — session-level isolation */
  sessionPromptOverridePath?: string;
  /** @deprecated Prefer sessionPromptOverridePath. */
  runtimePromptPath?: string;
}

export class SystemPromptLoader implements ResourceLoader {
  readonly type = 'system-prompt' as const;

  async resolve(ref: ResourceRef, ctx: LoaderContext): Promise<ResolvedResource> {
    const {
      systemPromptText,
      agentId,
      promptFilePath,
      sessionPromptOverridePath,
      runtimePromptPath,
    } = ctx as SystemPromptLoaderContext;
    const effectiveSessionPromptOverridePath = sessionPromptOverridePath ?? runtimePromptPath;

    // Try segmented agent prompt first (if agent scope is in segmented mode)
    let text = systemPromptText ?? '';
    if (agentId) {
      try {
        const segmented = await resolveSegmentedContent({ type: 'agent', agentId });
        if (segmented !== undefined) {
          text = segmented;
        }
      } catch {
        // Segmented mode failed — use systemPromptText fallback
      }
    }

    // Append prompt file path if the agent opted in
    if (promptFilePath) {
      if (effectiveSessionPromptOverridePath) {
        text += `\n\n---\n\n> 会话级系统提示词覆盖文件：\`${effectiveSessionPromptOverridePath}\`\n> 本会话独立副本；修改仅影响本会话。\n> 正式版文件：\`${promptFilePath}\`（修改正式版影响之后的新会话）`;
      } else {
        text += `\n\n---\n\n> 系统提示词文件：\`${promptFilePath}\`\n> 编辑后对新开会话生效。`;
      }
    }

    return {
      ref,
      content: text,
      // No sectionTitle — system prompt is raw, not wrapped in ##
      ok: !!text,
    };
  }
}
