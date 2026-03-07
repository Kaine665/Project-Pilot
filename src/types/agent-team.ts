/**
 * Agent Team — 可配置的 Agent 小队。
 *
 * Team 引用现有 Agent（通过 agentId），为每个成员分配角色和职责。
 * Orchestrator 可在拆分时将子任务分配给 Team 中的具体 Agent。
 */

// ── Team Member ──

export interface TeamMember {
  /** 关联的 Agent ID */
  agentId: string;
  /** 在 Team 中的角色名称，如 "前端开发"、"后端开发" */
  role: string;
  /** 职责边界的自然语言描述 */
  responsibilities: string;
  /** 是否可担任 Planner / 领导角色 */
  canLead?: boolean;
  /** 擅长处理的文件 glob 模式，如 ["src/components/**", "*.tsx"] */
  filePatterns?: string[];
}

// ── Conflict Policy ──

export interface ConflictPolicy {
  /** 冲突处理策略 */
  strategy: 'fail' | 'ai-resolve' | 'manual';
  /** strategy='ai-resolve' 时，用哪个 Agent 解决冲突 */
  resolverAgentId?: string;
}

// ── Agent Team ──

export interface AgentTeam {
  id: string;
  name: string;
  description?: string;
  members: TeamMember[];
  /** 默认冲突策略 */
  conflictPolicy?: ConflictPolicy;
  archived?: boolean;
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentTeamsData {
  teams: AgentTeam[];
}
