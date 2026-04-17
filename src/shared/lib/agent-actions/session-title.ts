/**
 * session-title action — AI generates a short session title in its first response.
 */

import { PROMPT_PRIORITY } from '@/lib/prompt-priorities';
import type { AgentAction, ActionContext } from './types';

// ── Parsed tag data ──

interface SessionTitleData {
  title: string;
}

// ── Action definition ──

export const sessionTitleAction: AgentAction<SessionTitleData> = {
  id: 'session-title',
  resourceType: 'session-title-instructions',
  sectionTitle: '会话标题',
  priority: PROMPT_PRIORITY.SESSION_TITLE_INSTRUCTIONS,

  // 标题现在由 session-title-generator.ts 异步生成，不再需要注入 prompt 指令。
  // 保留 parse/strip/execute 供向后兼容（旧 AI 回复中可能仍含标签）。
  instructions: '',

  parse(text: string): SessionTitleData[] {
    const match = text.match(/<session-title>([\s\S]*?)<\/session-title>/);
    if (!match) return [];
    return [{ title: match[1].trim() }];
  },

  strip(text: string): string {
    return text.replace(/<session-title>[\s\S]*?<\/session-title>\s*/, '');
  },

  async execute(data: SessionTitleData, ctx: ActionContext): Promise<void> {
    // Only set title; the SSE event is emitted by onProcessClose after fallback logic
    ctx.setSessionTitle(data.title);
  },
};
