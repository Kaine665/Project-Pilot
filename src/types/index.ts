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

/** 内置供应商 ID */
export const BUILT_IN_PROVIDER_IDS = [
  'anthropic', 'openai', 'deepseek', 'qwen', 'zhipu', 'minimax', 'kimi',
  'openrouter', 'ollama', 'custom',
] as const;

export type BuiltInProviderId = (typeof BUILT_IN_PROVIDER_IDS)[number];

/**
 * AI 供应商 ID。
 * - 内置：anthropic, openai, deepseek, qwen, zhipu, minimax, kimi, openrouter, ollama, custom
 * - 自定义：custom-{id}，来自用户添加的自定义供应商
 */
export type ProviderId = BuiltInProviderId | `custom-${string}`;

/** API 协议：Anthropic 兼容 或 OpenAI 兼容 */
export type CustomProviderApiProtocol = 'anthropic' | 'openai';

/** 自定义供应商认证方式 */
export type CustomProviderAuthMethod = 'AUTH_TOKEN' | 'API_KEY';

/**
 * 自定义供应商配置（规范 schema，与「添加自定义供应商」表单一致）
 */
export interface CustomProviderConfig {
  /** 唯一 ID，格式 custom-{id} */
  id: `custom-${string}`;
  /** 供应商名称，必填 */
  name: string;
  /** 服务商标签，可选，如「云服务商」 */
  tag?: string;
  /** API 协议：anthropic 或 openai */
  apiProtocol: CustomProviderApiProtocol;
  /** API Base URL，必填 */
  baseUrl: string;
  /** 认证方式：AUTH_TOKEN 或 API_KEY */
  authMethod: CustomProviderAuthMethod;
  /** 模型 ID 列表，至少一个 */
  modelIds: string[];
  /** @deprecated API Key 统一到 providerCredentials[id].apiKey。旧数据迁移后保留供向后兼容。 */
  apiKey?: string;
}

/** 单个供应商的凭据记录 */
export interface ProviderCredential {
  /** 认证方式 */
  authMode: ClaudeAuthMode;
  /** API Key（authMode='api_key' 时有效） */
  apiKey?: string;
  /** OAuth 元数据（authMode='oauth' 时有效） */
  oauth?: {
    /** Token 文件路径（如 ~/.claude/.credentials.json），运行时解析 */
    tokenFile: string;
    /** 上次检查时的状态 */
    lastStatus?: 'authenticated' | 'expired' | 'unknown';
    /** 上次检查时间（epoch ms） */
    lastCheckedAt?: number;
  };
  /** 上次成功验证的时间（epoch ms） */
  lastVerifiedAt?: number;
}

/** 推理努力等级 */
export type EffortLevel = 'low' | 'medium' | 'high';

/** OpenAI 推理努力等级（Codex 支持 xhigh） */
export type OpenAIReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh';

/** Claude Code 配置 */
export interface ClaudeSettings {
  /** AI 供应商 */
  provider: ProviderId;
  /** @deprecated 使用 providerCredentials[provider].authMode 代替。旧数据迁移后保留供向后兼容。 */
  authMode: ClaudeAuthMode;
  /** @deprecated 使用 providerCredentials[provider].apiKey 代替 */
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
  /** 每供应商凭据（统一存储 authMode + apiKey + oauth 元数据） */
  providerCredentials?: Partial<Record<ProviderId, ProviderCredential>>;
  /** @deprecated 使用 providerCredentials[provider].apiKey 代替。迁移后不再写入。 */
  providerApiKeys?: Partial<Record<ProviderId, string>>;
  /** 每供应商当前选中的模型 ID */
  providerModels?: Partial<Record<ProviderId, string>>;
  /** 每供应商的模型历史库（用户曾成功使用/手动添加的模型列表） */
  providerModelLibrary?: Partial<Record<ProviderId, string[]>>;
  /** 每供应商的 baseUrl（如 Kimi 双 URL 探测后持久化） */
  providerBaseUrls?: Partial<Record<ProviderId, string>>;
  /** OpenAI 推理努力等级 */
  openaiReasoningEffort?: OpenAIReasoningEffort;
  /** 用户添加的自定义供应商列表（规范 schema） */
  customProviders?: CustomProviderConfig[];
}

/** 通用设置 */
export interface GeneralSettings {
  /** 是否启用遥测（默认 false，当前版本无遥测） */
  telemetry?: boolean;
}

/** 会话标题自动生成配置 */
export interface TitleGenerationChainEntry {
  provider: ProviderId;
  model: string;
}

export interface TitleGenerationSettings {
  /** 是否启用自动标题生成（默认 true） */
  enabled?: boolean;
  /** 重试链：按顺序尝试，一个失败就试下一个 */
  chain?: TitleGenerationChainEntry[];
}

export const DEFAULT_TITLE_GENERATION: TitleGenerationSettings = {
  enabled: true,
  chain: [{ provider: 'anthropic', model: 'claude-haiku-4-5-20251001' }],
};

/** 通知和音频设置 */
export interface NotificationSettings {
  /** 是否启用桌面通知（默认 true） */
  enabled?: boolean;
  /** 是否启用通知音频（默认 true） */
  soundEnabled?: boolean;
  /** 音频音量（0-1，默认 0.5） */
  soundVolume?: number;
  /** 仅在窗口失焦时通知（默认 false，始终通知） */
  onlyWhenUnfocused?: boolean;
}

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  enabled: true,
  soundEnabled: true,
  soundVolume: 0.5,
  onlyWhenUnfocused: false,
};

/** 全局应用设置 */
export interface AppSettings {
  claude: ClaudeSettings;
  general?: GeneralSettings;
  /** 危险命令检测配置（各分类的检测级别） */
  dangerDetector?: DangerDetectorSettings;
  /** 会话标题自动生成配置 */
  titleGeneration?: TitleGenerationSettings;
  /** 通知和音频设置 */
  notifications?: NotificationSettings;
  version: number;
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  claude: {
    provider: 'anthropic',
    authMode: 'api_key',
    model: 'claude-sonnet-4-6',
  },
  notifications: DEFAULT_NOTIFICATION_SETTINGS,
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
  /** 会话检查点已生成（提示前端可显示续接按钮） */
  | { type: 'checkpoint_saved'; checkpoint: import('@/types/agent-chat').SessionCheckpoint }
  /** 模型 token 用量（来自 SDK result.modelUsage 或 streaming message_start/message_delta） */
  | { type: 'token_usage'; inputTokens: number; outputTokens: number; contextWindow?: number; final?: boolean }
  | { type: 'error'; message: string }
  | { type: 'awaiting_sub_agents' }
  /** 卫星任务：主题完成检测结果 */
  | { type: 'topic_completion'; completed: boolean; confidence: number; summary: string }
  /** 卫星任务：任务卡片已更新 */
  | { type: 'task_card_updated'; card: import('@/lib/task-card-store').TaskCard }
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
  /** Grant agent read/write access to its private data store (agent-data/{agentId}/) */
  dataStore: boolean;
}

export const DEFAULT_AGENT_CAPABILITIES: AgentCapabilities = {
  bash: true,
  fileAccess: true,
  web: true,
  subAgent: true,
  skipReview: false,
  todoRead: false,
  exposePromptPath: true,
  dataStore: false,
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
  /**
   * 触发提示——告诉其他 Agent "什么情况下应该找我"。
   * 每条是一个简短的场景描述，如 "需要审查 PR"、"遇到数据库迁移问题"。
   * 在可调用 Agent 列表中展示，帮助 Agent 智能选择协作对象。
   */
  triggerHints?: string[];
  /** 所属项目。undefined = 全局 Agent（所有项目可见） */
  projectKey?: string;
  /** 上下文标签筛选：只自动注入包含这些标签的项目级上下文。为空则注入所有匹配 projectKey 的上下文 */
  contextTags?: string[];
  /**
   * 上下文注入策略：
   * - 'additive'（默认）：自动注入项目级上下文（按 contextTags 过滤） + Agent 自身绑定的上下文
   * - 'exclusive'：只注入 Agent 自身绑定的上下文（defaultResources / contextIds），跳过项目级自动注入
   */
  contextStrategy?: 'additive' | 'exclusive';
  /** 默认供应商（创建新会话时预选）。留空则继承全局设置。 */
  defaultProvider?: ProviderId;
  /** 默认模型 ID（创建新会话时预选）。留空则继承全局设置。 */
  defaultModel?: string;
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
  /** 外部文件路径（绝对路径）。设置后从此路径读取内容，不复制到 context/ 目录 */
  sourcePath?: string;
  /** 逻辑标签，用于按需筛选（如 ["数据库", "阅读"]） */
  tags?: string[];
  /**
   * 'draft' = Agent 自动产出，等待用户确认。
   * 'active' / undefined = 正常生效。
   */
  status?: 'draft' | 'active';
  /** 产出此条目的 Agent 会话 ID */
  sourceAgentSessionId?: string;
  /** Agent 产出此知识的时间 */
  producedAt?: string;
  /**
   * 摘要文本，注入 prompt 时替代全文。
   * 可选；缺失时 fallback 到 description（>20字符）或文件前 500 字符。
   */
  summary?: string;
  /**
   * 此条目覆盖的源码路径前缀（仅 code-card 类型使用）。
   * 用于与 ActiveTask.scope 做前缀匹配，实现自动注入。
   * 示例：["src/lib/oauth-", "src/app/api/settings/auth-"]
   */
  coveredPaths?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ContextIndexData {
  entries: ContextEntry[];
}

// ==================== Todo（AI 待办清单） ====================

export type TodoPriority = 'high' | 'medium' | 'low';
export type TodoStatus = 'pending' | 'in_progress' | 'done';

/**
 * Backend lifecycle — 比 status 更精细的状态，用于 Agent 决策。
 * 前端仍然只展示 status（pending/in_progress/done），lifecycle 对用户透明。
 *
 * draft    → AI 自动生成，未经人工确认，不可被 Agent 认领
 * pending  → 已确认，等待认领
 * active   → 有 Agent 正在执行（绑定了 activeTaskId）
 * stale    → 内容可能过期（超期未认领 / 关联文件已变更），需重新确认
 * done     → 已完成
 * archived → 不再活跃但保留记录
 */
export type TodoLifecycle = 'draft' | 'pending' | 'active' | 'stale' | 'done' | 'archived';

export interface TodoSubTask {
  id: string;
  title: string;
  done: boolean;
}

export interface TodoItem {
  id: string;
  title: string;
  description?: string;
  status: TodoStatus;
  priority: TodoPriority;
  agentId?: string;
  sessionId?: string;
  projectKey?: string;
  dueAt?: string;
  tags?: string[];
  subTasks?: TodoSubTask[];
  createdAt: string;
  updatedAt: string;

  // ── Lifecycle 扩展（后端使用，前端透明） ──

  /** 精细生命周期状态，默认跟随 status 映射 */
  lifecycle?: TodoLifecycle;
  /** 被哪个 ActiveTask 认领（双向绑定） */
  activeTaskId?: string;
  /** 被哪个 git 分支认领 */
  claimedByBranch?: string;
  /** 关联的源码文件路径（用于 stale 检测） */
  subjectFiles?: string[];
  /**
   * 任务级上下文引用列表。
   * 当 Agent 认领此 Todo 时，这些引用会自动合并到会话的资源列表中，
   * 实现零信息丢失的任务交接。
   */
  contextRefs?: import('@/types/resource').ResourceRef[];
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

/** 项目所在位置类型 */
export type ProjectLocation = 'local' | 'github' | 'gitee' | 'cloud-server' | 'hybrid';

/** 项目主技术栈 */
export type ProjectTechStack =
  | 'react-native' | 'nextjs' | 'react' | 'vue' | 'angular'
  | 'node' | 'python' | 'go' | 'rust' | 'java'
  | 'electron' | 'flutter' | 'other';

export interface ProjectEntry {
  key: string;
  name: string;
  description?: string;

  // ── 位置与路径 ──
  /** 项目所在位置类型 */
  location?: ProjectLocation;
  /** 本地文件系统路径（必填） */
  path?: string;

  // ── Git 与仓库 ──
  repository?: {
    url?: string;
    defaultBranch?: string;
    provider?: 'github' | 'gitlab' | 'gitee' | 'bitbucket' | 'other';
  };

  // ── 技术信息 ──
  techStack?: ProjectTechStack;

  // ── 开发环境 ──
  devServer?: {
    command?: string;
    url?: string;
    port?: number;
  };

  // ── 访问权限（根据 location 动态展示） ──
  access?: {
    /** SSH 密钥路径或名称（cloud-server 时显示） */
    sshKey?: string;
    /** Token 环境变量名（github/gitee 时显示） */
    tokenEnvVar?: string;
    /** 其他权限说明 */
    notes?: string;
  };

  // ── AI 默认配置 ──
  /** 创建待办时默认绑定的 Agent ID */
  defaultAgentId?: string;

  // ── 视觉标识 ──
  icon?: string;
  color?: string;
  tags?: string[];

  // ── 时间戳 ──
  createdAt?: string;
  updatedAt?: string;

  // ── 归档 ──
  archived?: boolean;
  archivedAt?: string;
}

export interface ProjectIndex {
  projects: ProjectEntry[];
}

// ==================== Design Docs（项目设计文档） ====================

/** 文档生命周期状态 */
export type DocStatus = 'active' | 'draft' | 'deprecated';

export interface DocEntry {
  id: string;           // doc-{timestamp}-{random}
  title: string;
  description?: string;
  fileName: string;     // design-docs/{docId}.md
  projectKey: string;   // 关联项目
  /** 分类 ID（对应 categories 中的 id），可选 */
  category?: string;
  /** 自由标签列表 */
  tags?: string[];
  /** 文档状态，默认 'active' */
  status?: DocStatus;
  /** 本文档被哪个文档替代（新文档 ID） */
  supersededBy?: string;
  /** 本文档替代了哪个文档（旧文档 ID） */
  supersedes?: string;
  createdAt: string;
  updatedAt: string;
}

/** 文档分类定义 */
export interface CategoryDef {
  id: string;           // cat-{timestamp}-{random}
  /** 分类名称 */
  name: string;
  /** 分类描述 */
  description?: string;
  /** 排序权重（越小越靠前） */
  sortOrder?: number;
  /** 所属项目（可选，undefined = 全局分类） */
  projectKey?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DocsIndexData {
  projects: Record<string, DocEntry[]>;
  /** 文档分类定义列表 */
  categories?: CategoryDef[];
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

// ==================== Agent Schedules（定时运行） ====================

/**
 * Agent 定时运行配置。
 * 每条记录对应一个"每到 cron 时间就启动一次 Agent 会话"的规则。
 */
export interface AgentSchedule {
  id: string;           // sched-{timestamp}-{random4}
  agentId: string;      // 关联的 Agent ID
  /** cron 表达式，标准 5 段格式（分 时 日 月 周）*/
  cron: string;
  /** 启动时发送的初始消息 */
  message: string;
  /** 可选：绑定的项目 key（会加载项目流程数据） */
  projectKey?: string;
  /** 是否启用，默认 true */
  enabled: boolean;
  /** 备注名称（方便用户识别） */
  label?: string;
  lastRunAt?: string;   // ISO timestamp，上次触发时间
  nextRunAt?: string;   // ISO timestamp，下次预计触发时间（前端展示用）
  createdAt: string;
  updatedAt: string;
}

export interface AgentSchedulesData {
  schedules: AgentSchedule[];
}

/**
 * 单次调度执行记录。
 */
export interface ScheduleRunRecord {
  id: string;           // run-{timestamp}-{random4}
  scheduleId: string;   // 关联的 AgentSchedule ID
  sessionId: string;    // 创建的 Agent 会话 ID
  trigger: 'cron' | 'manual';  // 触发方式
  startedAt: string;    // ISO timestamp
  status: 'started' | 'completed' | 'failed';
  error?: string;       // 失败时的错误信息
}

export interface ScheduleRunsData {
  runs: ScheduleRunRecord[];
}
