/**
 * Agent 聊天会话类型定义
 */

import type { SessionExecution } from '@/lib/chat-managers/types';

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
  /** 会话级别追加的 Skill 名称列表（与 Agent 绑定的 skills 合并） */
  skillNames?: string[];
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

/** 单条消息 */
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  images?: string[];
  contentBlocks?: import('./index').ContentBlock[];
}

export interface PendingUserQueueItem {
  text: string;
  images?: string[];
}

export interface PendingUserQueueState {
  items: PendingUserQueueItem[];
  expanded?: boolean;
}

export interface AgentChatSession {
  id: string;                    // "agent-chat-{timestamp}-{random}"
  agentId: string;
  projectKey?: string;           // 项目作用域（管家侧边栏/全屏模式）
  title: string;                 // AI 生成或 fallback
  messages: ChatMessage[];
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

  /** Sub Agent 调用深度（0=顶层，服务端自动追踪，用于递归保护） */
  depth?: number;

  /** 助手回复期间用户继续提交的待发送消息队列 */
  pendingUserQueue?: PendingUserQueueState;
}

/**
 * 索引文件中的会话元数据（不含 messages，消息存储在单独的 JSONL 文件中）。
 * 索引文件路径：agent-chat-sessions.json
 * 消息文件路径：agent-chat-messages/{sessionId}.jsonl
 */
export type SessionMeta = Omit<AgentChatSession, 'messages'> & {
  /** 消息总数（冗余缓存，避免读 JSONL 文件只为计数） */
  messageCount?: number;

  /** 最近一次运行的执行记录（含状态、结构化结果等） */
  execution?: SessionExecution;
};

/**
 * 索引文件结构（v2：仅元数据，不含消息）。
 * 向后兼容：如果 sessions[i] 包含 messages 字段，说明是旧格式，需要自动迁移。
 */
export interface AgentChatSessionsData {
  sessions: SessionMeta[];
}
