import type { ChatSSEEvent } from '@/types';

// ── 编排阶段 ──

export type OrchestratorPhase =
  | 'pending'
  | 'splitting'
  | 'spawning'
  | 'executing'
  | 'synthesizing'
  | 'merging'
  | 'completed'
  | 'failed';

// ── AI 拆分结果 ──

export interface SplitPlan {
  analysis: string;
  tasks: Array<{
    title: string;
    description: string;
    branchSlug: string;
    estimatedComplexity?: 'low' | 'medium' | 'high';
    /** 依赖的其他任务的 branchSlug 列表。为空或省略表示无依赖，可立即执行 */
    dependsOn?: string[];
    /** AI 分配的 Agent ID（来自 Team 配置），用于 Worker-Agent 绑定 */
    agentId?: string;
  }>;
  expectedOutcome: string;
  /** 可选的自定义编排计划（省略时使用默认 DAG 并行模式） */
  orchestration?: OrchestrationPlan;
}

// ── Worker 子任务 ──

export interface WorkerTask {
  id: string;
  orchestrationId: string;
  title: string;
  description: string;
  gitBranch: string;
  worktreePath: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'stopped';
  /** 依赖的其他 worker 的 ID 列表（由 spawn 阶段从 SplitPlan.dependsOn 映射） */
  dependsOn: string[];
  /** 绑定的 Agent ID，Worker 将继承该 Agent 的 prompt 和资源链 */
  agentId?: string;
  claudeSessionId?: string;
  startedAt?: string;
  completedAt?: string;
  result?: WorkerResult;
  errorMessage?: string;
  eventCount: number;
}

export interface WorkerResult {
  status: 'completed' | 'failed' | 'partial';
  summary: string;
  filesChanged: Array<{ path: string; action: 'created' | 'modified' | 'deleted' }>;
}

// ── 编排原语 ──

/** 编排预设模式 */
export type OrchestrationPreset =
  | 'parallel'        // 经典：拆分 → 并行执行 → 合并
  | 'pipeline'        // 流水线：A → B → C
  | 'review-loop'     // 开发 + 审查：A 写 → B review → A 修改
  | 'free-form';      // 自由编排：自定义 step 序列

/** 编排步骤 */
export type OrchestrationStep =
  | { type: 'parallel'; branchSlugs: string[] }
  | { type: 'sequence'; branchSlugs: string[] }
  | { type: 'gate'; condition: 'user-confirm' | 'auto'; label?: string }
  | { type: 'review'; reviewerAgentId: string; targetBranchSlugs: string[] }
  | { type: 'merge'; branchSlugs: string[] }
  | { type: 'synthesize'; prompt?: string };

/** 编排计划（可选，附加在 SplitPlan 上或独立使用） */
export interface OrchestrationPlan {
  preset?: OrchestrationPreset;
  steps?: OrchestrationStep[];
}

// ── 编排会话（持久化） ──

export interface OrchestratorSession {
  id: string;
  projectKey: string;
  originalPrompt: string;
  phase: OrchestratorPhase;
  splitPlan?: SplitPlan;
  /** 自定义编排计划（从 SplitPlan.orchestration 提取，或由 preset 生成） */
  orchestrationPlan?: OrchestrationPlan;
  workers: WorkerTask[];
  synthesisResult?: string;
  baseBranch: string;
  /** 关联的 Agent Team ID（可选） */
  teamId?: string;
  mergeStatus?: 'pending' | 'completed' | 'conflict';
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface OrchestratorSessionsData {
  sessions: OrchestratorSession[];
}

// ── SSE 事件类型 ──

export type OrchestratorSSEEvent =
  | { type: 'orch_phase_changed'; phase: OrchestratorPhase }
  | { type: 'orch_split_completed'; plan: SplitPlan }
  | { type: 'worker_started'; workerId: string; title: string }
  | { type: 'worker_completed'; workerId: string; result: WorkerResult }
  | { type: 'worker_failed'; workerId: string; error: string }
  | { type: 'worker_event'; workerId: string; event: ChatSSEEvent }
  | { type: 'orch_synthesis_started' }
  | { type: 'orch_synthesis_completed'; summary: string }
  | { type: 'orch_merge_completed'; branches: string[] }
  | { type: 'orch_error'; message: string }
  | { type: 'orch_done' };
