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
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  ai_execution?: AIExecution;
  gitBranch?: string; // 执行时创建的一次性 git 分支名
  worktreePath?: string; // git worktree 绝对路径，用于并行任务隔离
  claudeSessionId?: string; // Claude CLI 会话 ID（旧数据兼容；新数据写入 conversation 级别）
  activeConversationId?: string; // 当前活跃的对话 ID
  /** 从项目跟踪链路发起时附带的上下文（见 docs/types/flow-task-context.md） */
  flowContext?: FlowTaskContext;
  /** Agent ID used for this session — determines tool capabilities */
  agentId?: string;
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

// ==================== App Settings ====================

/** Claude Code 认证方式 */
export type ClaudeAuthMode = 'api_key' | 'oauth';

/** Supported Claude model IDs */
export type ClaudeModel = 'claude-opus-4-6' | 'claude-sonnet-4-5-20250929' | 'claude-haiku-4-5-20250929' | 'claude-haiku-4-5-20251001';

/**
 * AI 供应商 ID。
 *
 * - anthropic: Anthropic 官方（默认）
 * - deepseek / qwen / zhipu / minimax: 中国厂商（原生 Anthropic 兼容端点）
 * - openrouter: 聚合网关
 * - ollama: 本地模型
 * - custom: 用户自定义端点
 */
export type ProviderId =
  | 'anthropic'
  | 'deepseek'
  | 'qwen'
  | 'zhipu'
  | 'minimax'
  | 'openrouter'
  | 'ollama'
  | 'custom';

/** 推理努力等级 */
export type EffortLevel = 'low' | 'medium' | 'high';

/** Claude Code 配置 */
export interface ClaudeSettings {
  /** AI 供应商 */
  provider: ProviderId;
  authMode: ClaudeAuthMode;
  apiKey?: string;
  /** 模型 ID（自由字符串，供应商不同格式不同） */
  model: string;
  baseUrl?: string;
  /** 是否跳过工具权限审查（--dangerously-skip-permissions），默认 true */
  skipPermissions?: boolean;
  /** 推理努力等级（low/medium/high），默认 high */
  effortLevel?: EffortLevel;
  /** 每次对话最大 agentic 轮次，0 = 不限制 */
  maxTurns?: number;
}

/** 通用设置 */
export interface GeneralSettings {
  /** 是否启用遥测（默认 false，当前版本无遥测） */
  telemetry?: boolean;
}

/** 全局应用设置 */
export interface AppSettings {
  claude: ClaudeSettings;
  general?: GeneralSettings;
  version: number;
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  claude: {
    provider: 'anthropic',
    authMode: 'api_key',
    model: 'claude-sonnet-4-5-20250929',
  },
  version: 1,
};

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
  images?: string[];          // base64 data URLs，仅用户消息有
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

export type DangerLevel = 'warning' | 'critical';

export type ChatSSEEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_use_start'; id: string; toolName: string; input: string }
  | { type: 'tool_use_end'; id: string; output: string; status: 'completed' | 'failed' }
  | { type: 'dangerous_tool_warning'; toolCallId: string; toolName: string; command: string; reason: string; level: DangerLevel }
  | { type: 'plan_extracted'; planId: string }
  | { type: 'understanding_extracted'; understanding: TaskUnderstanding }
  | { type: 'result_extracted'; result: TaskResult }
  | { type: 'branch_created'; branch: string; slug: string }
  | { type: 'branch_merged'; branch: string; targetBranch: string }
  | { type: 'phase_changed'; phase: SessionPhase }
  | { type: 'retry_needed'; attempt: number; maxAttempts: number; retryMessage: string }
  | { type: 'knowledge_draft_created'; entryId: string; label: string }
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

// ==================== Agent ====================

/** Per-agent tool capabilities — controls what Claude Code tools this agent can use */
export interface AgentCapabilities {
  /** Bash tool (command execution, including Git) */
  bash: boolean;
  /** Read, Write, Edit, Glob, Grep, NotebookEdit tools */
  fileAccess: boolean;
  /** WebFetch, WebSearch tools */
  web: boolean;
  /** Task tool (sub-agents) */
  subAgent: boolean;
  /** Maps to --dangerously-skip-permissions (auto-approve all tool calls) */
  skipReview: boolean;
}

export const DEFAULT_AGENT_CAPABILITIES: AgentCapabilities = {
  bash: true,
  fileAccess: true,
  web: true,
  subAgent: true,
  skipReview: false,
};

export interface Agent {
  id: string;
  name: string;
  /** Stable identifier for built-in agents (e.g., "butler"). User-created agents have no slug. */
  slug?: string;
  /** True for system-provided agents that cannot be deleted */
  builtIn?: boolean;
  description?: string;
  /** System prompt / instructions for this agent */
  systemPrompt?: string;
  /** Icon identifier (lucide icon name) */
  icon?: string;
  /** Per-agent tool capabilities */
  capabilities?: AgentCapabilities;
  /**
   * Execution mode for this agent in task sessions.
   * - 'task': uses ProcessManager + buildPrompt + phases (git worktree, understanding/doing/summarizing)
   * - 'chat': uses AgentChatManager + systemPrompt directly (lightweight interactive chat)
   * Defaults to 'chat' for custom agents. Only task worker uses 'task'.
   */
  executionMode?: 'task' | 'chat';
  /** Parameter names this agent requires to run (template only, values filled at project/task level) */
  requiredParams?: string[];
  archived?: boolean;
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentsData {
  agents: Agent[];
}

// ==================== Dimension（信息角度） ====================

export interface Dimension {
  id: string;
  name: string;
  description?: string;
  archived?: boolean;
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DimensionsData {
  dimensions: Dimension[];
}

// ==================== Context（上下文） ====================

export interface ContextEntry {
  id: string;           // e.g., "ctx-1740464738582-a3f"
  label: string;        // e.g., "用户基本信息"
  description: string;  // agent 靠这个决定是否读文件
  fileName: string;     // 相对于 context 目录，如 "user-profile.json"
  format: 'json' | 'markdown' | 'text';
  group?: string;       // 上下文包/分组名，如 "ELApp"，可选
  /** 原始文件的本地绝对路径，由用户在从本地文件导入时填写，供 AI 修改源文件使用 */
  sourcePath?: string;
  /**
   * 'draft' = Agent 自动产出，等待用户确认。
   * 'active' / undefined = 正常生效。
   */
  status?: 'draft' | 'active';
  /** 产出此条目的 Agent 会话 ID */
  sourceAgentSessionId?: string;
  /** Agent 产出此知识的时间 */
  producedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ContextIndexData {
  entries: ContextEntry[];
}

// ==================== Flow Project ====================

export interface ProjectEntry {
  key: string;
  name: string;
  description?: string;
  archived?: boolean;
  archivedAt?: string;
}

export interface ProjectIndex {
  projects: ProjectEntry[];
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
