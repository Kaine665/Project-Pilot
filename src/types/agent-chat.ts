/**
 * Agent 聊天会话类型定义
 */

export interface AgentChatSession {
  id: string;                    // "agent-chat-{timestamp}-{random}"
  agentId: string;
  projectKey?: string;           // 项目作用域（管家侧边栏/全屏模式）
  title: string;                 // AI 生成或 fallback
  messages: Array<{
    role: 'user' | 'assistant';
    content: string;
    images?: string[];
    contentBlocks?: import('./index').ContentBlock[];
  }>;
  claudeSessionId?: string;      // 用于 --resume
  createdAt: string;
  updatedAt: string;

  /** 未读消息计数（agent 回复但用户尚未查看） */
  unreadCount?: number;

  // ── Guest Agent（旁听 Agent）字段 ──

  /** 宿主会话 ID（仅 guest 会话有此字段） */
  parentSessionId?: string;
  /** 从宿主会话导入的轮次索引（message index，0-based） */
  importedTurnIndices?: number[];
}

export interface AgentChatSessionsData {
  sessions: AgentChatSession[];
}
