// ==================== Session（AI 会话） ====================

import type { FlowTaskContext } from './flow-context';
import type { ResourceRef } from './resource';

/**
 * AI 会话 — 用户发起的一次 AI 协作。
 */
export interface Session {
  id: string;
  title: string;
  content?: string;
  projectKey?: string; // 对应 projects.json 中的 key
  status: 'todo' | 'doing' | 'done';
  archived?: boolean;
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
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
  | 'openai'
  | 'deepseek'
  | 'qwen'
  | 'zhipu'
  | 'minimax'
  | 'kimi'
  | 'openrouter'
  | 'ollama'
  | 'custom';

/** 推理努力等级 */
export type EffortLevel = 'low' | 'medium' | 'high';

/** OpenAI 推理努力等级（Codex 支持 xhigh） */
export type OpenAIReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh';

/** Claude Code 配置 */
export interface ClaudeSettings {
  /** AI 供应商 */
  provider: ProviderId;
  authMode: ClaudeAuthMode;
  /** @deprecated 使用 providerApiKeys[provider] 代替 */
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
  /** 新建 Agent 时是否默认暴露提示词路径（默认 true） */
  defaultExposePromptPath?: boolean;
  /** 每供应商 API Key 映射 */
  providerApiKeys?: Partial<Record<ProviderId, string>>;
  /** 每供应商当前选中的模型 ID */
  providerModels?: Partial<Record<ProviderId, string>>;
  /** 每供应商的模型历史库（用户曾成功使用/手动添加的模型列表） */
  providerModelLibrary?: Partial<Record<ProviderId, string[]>>;
  /** OpenAI 推理努力等级 */
  openaiReasoningEffort?: OpenAIReasoningEffort;
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
  /** 危险命令检测配置（各分类的检测级别） */
  dangerDetector?: DangerDetectorSettings;
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
  interrupted?: boolean;
}

export type DangerLevel = 'warning' | 'critical';

/** Danger Detector 检测级别（含 disabled） */
export type DangerActionLevel = DangerLevel | 'disabled';

/**
 * 危险命令检测分类 ID。
 * 每个分类对应一组相关的检测规则。
 */
export type DangerCategory =
  | 'dataDirectory'    // 数据目录写入保护
  | 'sqlDestructive'   // SQL DROP/TRUNCATE
  | 'diskFormat'       // 磁盘格式化
  | 'fileDestructive'  // rm -rf, del /s
  | 'gitDangerous'     // git push, force push, reset --hard 等
  | 'npmPublish'       // npm publish
  | 'processKill';     // kill -9

/** 各分类的检测级别配置 */
export type DangerDetectorSettings = Record<DangerCategory, DangerActionLevel>;

/** 默认 Danger Detector 配置 */
export const DEFAULT_DANGER_SETTINGS: DangerDetectorSettings = {
  dataDirectory: 'warning',
  sqlDestructive: 'critical',
  diskFormat: 'critical',
  fileDestructive: 'warning',
  gitDangerous: 'warning',
  npmPublish: 'warning',
  processKill: 'warning',
};

export type ChatSSEEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_use_start'; id: string; toolName: string; input: string }
  | { type: 'tool_use_end'; id: string; output: string; status: 'completed' | 'failed' }
  | { type: 'dangerous_tool_warning'; toolCallId: string; toolName: string; command: string; reason: string; level: DangerLevel }
  | { type: 'session_title_set'; title: string }
  | { type: 'knowledge_draft_created'; entryId: string; label: string }
  | { type: 'doc_created'; docId: string; title: string; projectKey: string }
  | { type: 'task_suspended'; taskId: string; title: string }
  | { type: 'task_completed'; taskId: string }
  | { type: 'error'; message: string }
  | { type: 'done' };

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
  /** Inject pending todos into the system prompt */
  todoRead: boolean;
  /** Expose the prompt file path in the system prompt so the AI can read/edit its own instructions */
  exposePromptPath: boolean;
}

export const DEFAULT_AGENT_CAPABILITIES: AgentCapabilities = {
  bash: true,
  fileAccess: true,
  web: true,
  subAgent: true,
  skipReview: false,
  todoRead: false,
  exposePromptPath: true,
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
  /** Parameter names this agent requires to run (template only, values filled at project/task level) */
  requiredParams?: string[];
  /** @deprecated Use defaultResources instead. Kept for backward compatibility with existing data. */
  contextIds?: string[];
  /**
   * Default resource set for this agent.
   * When a new chat session starts, these refs are used to build the prompt.
   * If absent, migrateAgentToResources() derives them from legacy fields at runtime.
   */
  defaultResources?: ResourceRef[];
  /** 所属项目。undefined = 全局 Agent（所有项目可见） */
  projectKey?: string;
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
  projectKey?: string;      // 关联项目（空=全局上下文）
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

// ==================== Todo（AI 待办清单） ====================

export type TodoPriority = 'high' | 'medium' | 'low';
export type TodoStatus = 'pending' | 'in_progress' | 'done';

export interface TodoItem {
  id: string;
  title: string;
  description?: string;
  status: TodoStatus;
  priority: TodoPriority;
  agentId?: string;
  projectKey?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TodosData {
  todos: TodoItem[];
}

// ==================== Suspended Tasks（跨会话任务交接） ====================

export type SuspendedTaskStatus = 'suspended' | 'resumed' | 'completed';

export interface SuspendedTask {
  id: string;                    // suspend-{timestamp}-{random}
  title: string;                 // 任务简述
  projectKey?: string;           // 关联项目
  agentId: string;               // 挂起时的 Agent
  sessionId: string;             // 挂起时的会话 ID

  // 交接内容（Agent 生成）
  progress: string;              // 当前进度
  blockReason: string;           // 阻塞原因
  nextSteps: string;             // 恢复建议 / 下一步
  context?: string;              // 补充上下文（相关文件、分支等）

  // 状态
  status: SuspendedTaskStatus;
  suspendedAt: string;
  resumedAt?: string;
  resumedBy?: string;            // 接续的会话 ID
  completedAt?: string;
}

export interface SuspendedTasksData {
  tasks: SuspendedTask[];
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

// ==================== Design Docs（项目设计文档） ====================

export interface DocEntry {
  id: string;           // doc-{timestamp}-{random}
  title: string;
  description?: string;
  fileName: string;     // design-docs/{docId}.md
  projectKey: string;   // 关联项目
  createdAt: string;
  updatedAt: string;
}

export interface DocsIndexData {
  projects: Record<string, DocEntry[]>;
}

// ==================== Orchestrator ====================

export type {
  OrchestratorPhase, SplitPlan, WorkerTask, WorkerResult,
  OrchestratorSession, OrchestratorSessionsData, OrchestratorSSEEvent,
} from './orchestrator';

// ==================== Inbox（收件箱） ====================

/** 收件箱条目 —— 未结构化的快速记录 */
export interface InboxItem {
  id: string;           // 格式: inbox-{timestamp}-{random4}
  content: string;      // 条目内容（一句话）
  createdAt: string;    // ISO timestamp
  status: 'inbox' | 'archived';  // inbox=待整理, archived=已归档到结构化任务
  archivedTo?: {        // 归档去向（可选）
    sectionId: string;
    taskId: string;
  };
}

/** 项目收件箱数据 */
export interface ProjectInbox {
  items: InboxItem[];
}
