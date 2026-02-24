// ==================== Session（AI 会话） ====================

import type { FlowTaskContext } from './flow-context';

/** Session 当前所处的工作流阶段 */
export type SessionPhase = 'branching' | 'understanding' | 'planning' | 'executing' | 'summarizing';

/**
 * AI 会话 — 用户发起的一次 AI 协作。
 *
 * Session 是容器，以下是它在各 Phase 中产出的平级产物：
 * - Phase 1 → TaskUnderstanding（任务理解，四要素）
 * - Phase 1 → DeliverableInference（交付物推断）
 * - Phase 3 → AIPlan（执行计划）
 * - Phase 5 → TaskResult（执行结果）
 *
 * 见 docs/types/flow-task-context.md
 */
export interface Session {
  id: string;
  title: string;
  content?: string;
  projectKey?: string; // 对应 projects.json 中的 key
  status: 'todo' | 'doing' | 'done';
  phase?: SessionPhase; // 当前工作流阶段，默认 'understanding'
  archived?: boolean;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  ai_execution?: AIExecution;
  gitBranch?: string; // 执行时创建的一次性 git 分支名
  claudeSessionId?: string; // Claude CLI 会话 ID（旧数据兼容；新数据写入 conversation 级别）
  activeConversationId?: string; // 当前活跃的对话 ID
  /** 从项目跟踪链路发起时附带的上下文（见 docs/types/flow-task-context.md） */
  flowContext?: FlowTaskContext;
}

export interface SessionsData {
  sessions: Session[];
}

/** @deprecated 使用 Session 代替，将在后续版本移除 */
export type Task = Session;
/**
 * @deprecated 使用 SessionsData 代替，将在后续版本移除。
 * 注意：运行时 JSON 文件仍使用 `tasks` 作为 key，因此此类型保留 `tasks` 字段。
 */
export interface TasksData {
  tasks: Task[];
}

// ==================== Project Registry ====================

export interface ProjectConfig {
  name: string;
  path: string;
  type: 'react-native' | 'nextjs' | 'node' | 'python' | 'other';
  description?: string; // 项目简要描述
  defaultBranch?: string; // 合并目标分支，默认 main/master
  webCommand?: string;
  webUrl?: string;
}

export interface ProjectsData {
  projects: Record<string, ProjectConfig>;
}

// ==================== AI Execution ====================

export interface AIExecution {
  status: 'idle' | 'planning' | 'pending_approval' | 'running' | 'pending_review' | 'completed' | 'failed';
  current_plan_id?: string;
  current_execution_id?: string;
  plan_count: number;
  execution_count: number;
  last_update?: string;
}

// ==================== AI Plan ====================

export interface AIPlanStep {
  id: number;
  type: 'auto' | 'manual' | 'confirm';
  action: string;
  description?: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  started_at?: string;
  completed_at?: string;
  output?: string;
  error?: string;
  estimated_time?: string;
  risk_level?: 'low' | 'medium' | 'high';
  dependencies?: number[];
}

export interface AIPlanQuestion {
  id: number;
  question: string;
  type: 'yes_no' | 'text' | 'choice';
  importance: 'required' | 'optional';
  options?: string[];
  answer?: string;
}

export type PlanStatus = 'planning' | 'pending_approval' | 'approved' | 'rejected' | 'completed' | 'failed' | 'archived';

export interface AIPlan {
  plan_id: string;
  session_id?: string;
  /** @deprecated 运行时 JSON 仍使用 task_id，待迁移 */
  task_id?: string;
  version: number;
  status: PlanStatus;
  created_at: string;
  updated_at?: string;
  analysis: string;
  steps: AIPlanStep[];
  step_count: number;
  steps_completed: number;
  execution_count: number;
  questions?: AIPlanQuestion[];
  expected_results?: string;
  risks?: string;
  execution_notes?: string;
  discussion_notes?: string;
  user_confirmations?: string[];
  clarifications?: string;
  execution_history?: Array<{
    timestamp: string;
    event: string;
    details: string;
  }>;
}

export interface PlansData {
  plans: AIPlan[];
}

// ==================== AI Execution Record ====================

export interface AIExecutionRecord {
  execution_id: string;
  plan_id: string;
  session_id: string;
  plan_version: number;
  run_number: number;
  started_at: string;
  completed_at?: string;
  status: 'running' | 'pending_review' | 'completed' | 'failed' | 'cancelled';
  current_step?: number;
  current_action?: string;
  steps_completed: number;
  total_steps: number;
  duration_seconds?: number;
  error?: string;
}

// ==================== Chat ====================

export interface ChatToolCall {
  id: string;
  toolName: string;
  input: string;
  output?: string;
  status: 'running' | 'completed' | 'failed';
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; toolCall: ChatToolCall };

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  toolCalls?: ChatToolCall[];
  contentBlocks?: ContentBlock[];
  extractedPlanId?: string;
  interrupted?: boolean;
}

export interface ChatSession {
  sessionId: string;
  conversationId: string;
  claudeSessionId?: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

// ==================== Conversation History ====================

/** 单个对话的轻量元数据，用于列表展示 */
export interface ConversationMeta {
  conversationId: string;
  title: string;
  claudeSessionId?: string;
  messageCount: number;
  archived?: boolean;
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
  /** 分支来源：源对话 ID */
  parentConversationId?: string;
  /** 分支来源：分支点消息 ID */
  branchFromMessageId?: string;
  /** 分支来源：分支点消息序号 (0-based) */
  branchFromMessageIndex?: number;
}

/** 每个 Task 的对话索引，存储在 conversations/{taskId}/_index.json */
export interface ConversationIndex {
  taskId: string;
  activeConversationId?: string;
  conversations: ConversationMeta[];
}

export type ChatSSEEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_use_start'; id: string; toolName: string; input: string }
  | { type: 'tool_use_end'; id: string; output: string; status: 'completed' | 'failed' }
  | { type: 'plan_extracted'; planId: string }
  | { type: 'understanding_extracted'; understanding: TaskUnderstanding }
  | { type: 'result_extracted'; result: TaskResult }
  | { type: 'branch_created'; branch: string; slug: string }
  | { type: 'branch_merged'; branch: string; targetBranch: string }
  | { type: 'phase_changed'; phase: SessionPhase }
  | { type: 'retry_needed'; attempt: number; maxAttempts: number; retryMessage: string }
  | { type: 'error'; message: string }
  | { type: 'done' };

// ==================== Session Artifacts（各 Phase 产物） ====================

import type { DeliverableInference } from './deliverable';

/**
 * 任务理解 — Phase 1 的产物。
 * 四要素定义了"任务是什么"，是 Session 中最先确定的产物。
 */
export interface TaskUnderstanding {
  project: string;
  action: string;
  goal: string;
  deliverable: string;
  /** AI 生成的英文分支名 slug，如 "fix-login-button" */
  branchSlug?: string;
  /** AI 推断的交付物类型组合（见 docs/types/deliverable-types.md） */
  deliverableInference?: DeliverableInference;
}

/**
 * 执行结果 — Phase 5 的产物。
 */
export interface TaskResult {
  status: 'completed' | 'failed' | 'partial';
  branch?: string;
  summary: string;
  files_changed?: Array<{
    path: string;
    action: 'created' | 'modified' | 'deleted';
  }>;
  stats?: {
    added: number;
    modified: number;
    deleted: number;
  };
}

/**
 * Session 各 Phase 产物的聚合视图，用于侧面板展示。
 *
 * 这些产物是平级的，不是嵌套的：
 * - understanding: Phase 1 产物
 * - planId:        Phase 3 产物的引用
 * - result:        Phase 5 产物
 */
export interface SessionArtifacts {
  sessionId: string;
  understanding?: TaskUnderstanding;
  planId?: string;
  result?: TaskResult;
  updatedAt: string;
}

/**
 * @deprecated 使用 SessionArtifacts 代替。
 * 运行时 JSON 仍使用 taskId，因此保留独立接口。
 */
export interface TaskArtifacts {
  taskId?: string;
  sessionId?: string;
  understanding?: TaskUnderstanding;
  planId?: string;
  result?: TaskResult;
  updatedAt: string;
}

// ==================== Artifacts ====================

export interface ArtifactItem {
  type: 'screenshot' | 'diff' | 'log';
  path: string; // 相对于 artifacts/{planId}/ 的路径
  label: string;
}

export interface ArtifactSummary {
  planId: string;
  sessionId?: string;
  /** @deprecated 运行时 JSON 仍使用 taskId，待迁移 */
  taskId?: string;
  timestamp: string;
  changeType: 'frontend' | 'backend' | 'both' | 'unknown';
  filesChanged: string[];
  artifacts: ArtifactItem[];
}
