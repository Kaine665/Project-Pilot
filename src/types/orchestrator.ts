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
  }>;
  expectedOutcome: string;
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

// ── 编排会话（持久化） ──

export interface OrchestratorSession {
  id: string;
  projectKey: string;
  originalPrompt: string;
  phase: OrchestratorPhase;
  splitPlan?: SplitPlan;
  workers: WorkerTask[];
  synthesisResult?: string;
  baseBranch: string;
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
