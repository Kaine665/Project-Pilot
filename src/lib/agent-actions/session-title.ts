/**
 * session-title action — AI generates a short session title in its first response.
 */

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
  priority: 90,

  instructions: `在你的**第一条回复的开头**，用以下格式生成一个简短的会话标题（5-15 个字，概括这次对话的主题）：

<session-title>标题内容</session-title>

之后的回复不需要再输出标题。`,

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
