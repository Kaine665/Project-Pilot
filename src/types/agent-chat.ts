/**
 * Agent 聊天会话类型定义
 */

/**
 * 会话级别的可选配置。
 *
 * 设计原则：会话是 Agent（模板）的实例。
 * - 会话可覆盖 Agent 的系统提示词、模型、能力开关等配置
 * - 能力开关只能收紧（关闭 Agent 已开启的能力），不能放宽
 * - 会话可追加上下文和补充提示词
 * - 未配置时完全继承 Agent 模板的默认行为
 */
export interface SessionConfig {
  /** 会话级别追加的预加载上下文 ID 列表（与 Agent 默认上下文合并） */
  contextIds?: string[];
  /** 会话级别的补充提示词（追加到系统提示词之后） */
  supplementaryPrompt?: string;
  /** 会话使用的供应商（覆盖 Agent 默认值和全局设置） */
  provider?: import('./index').ProviderId;
  /** 会话使用的模型 ID（覆盖 Agent 默认值和全局设置） */
  model?: string;
  /** 会话级别的系统提示词覆盖（替换 Agent 的 systemPrompt，不影响 supplementaryPrompt） */
  systemPrompt?: string;
  /** 会话级别的能力覆盖（与 Agent 默认值合并，只能收紧不能放宽） */
  capabilities?: Partial<import('./index').AgentCapabilities>;
}

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

  /** 会话已归档（已完成的任务，侧边栏显示为灰色） */
  archived?: boolean;

  /** 会话级别的可选配置（追加上下文、补充提示词） */
  config?: SessionConfig;

  /** 健康检查守卫已自动干预的次数（防止递归，达到上限后不再触发） */
  guardRetryCount?: number;

  // ── Guest Agent（旁听 Agent）字段 ──

  /** 宿主会话 ID（仅 guest 会话有此字段） */
  parentSessionId?: string;
  /** 从宿主会话导入的轮次索引（message index，0-based） */
  importedTurnIndices?: number[];
}

export interface AgentChatSessionsData {
  sessions: AgentChatSession[];
}
