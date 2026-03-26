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
      promptFilePath,
      sessionPromptOverridePath,
      runtimePromptPath,
    } = ctx as SystemPromptLoaderContext;
    const effectiveSessionPromptOverridePath = sessionPromptOverridePath ?? runtimePromptPath;
    let text = systemPromptText ?? '';

    // Append prompt file path if the agent opted in
    if (promptFilePath) {
      if (effectiveSessionPromptOverridePath) {
        // 会话级 prompt override：修改只影响本会话
        text += `\n\n---\n\n> 你的会话级系统提示词覆盖文件路径：\`${effectiveSessionPromptOverridePath}\`\n> 这是本会话的独立副本。修改它只应影响本会话。\n> 正式版路径：\`${promptFilePath}\`（修改正式版影响所有新会话）`;
      } else {
        text += `\n\n---\n\n> 你的系统提示词文件路径：\`${promptFilePath}\`\n> 你可以通过 Read 工具查看或 Edit 工具修改它。修改后下次对话生效。`;
      }
    }

    // AskUserQuestion tool constraint — ensure AI stops after asking
    text += `\n\n**重要约束**：当你调用 AskUserQuestion 工具后，必须立即结束当前回复。不要猜测用户的选择，不要在同一轮继续执行其他操作。等待用户在下一轮消息中给出选择后再继续。`;

    return {
      ref,
      content: text,
      // No sectionTitle — system prompt is raw, not wrapped in ##
      ok: !!text,
    };
  }
}
