// ==================== Task ====================

export interface Task {
  id: string;
  title: string;
  content?: string;
  projectKey: string; // 对应 projects.json 中的 key
  status: 'todo' | 'doing' | 'done';
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  ai_execution?: AIExecution;
}

export interface TasksData {
  tasks: Task[];
}

// ==================== Project Registry ====================

export interface ProjectConfig {
  name: string;
  path: string;
  type: 'react-native' | 'nextjs' | 'node' | 'python' | 'other';
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
  task_id: string;
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
  task_id: string;
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

// ==================== Artifacts ====================

export interface ArtifactItem {
  type: 'screenshot' | 'diff' | 'log';
  path: string; // 相对于 artifacts/{planId}/ 的路径
  label: string;
}

export interface ArtifactSummary {
  planId: string;
  taskId: string;
  timestamp: string;
  changeType: 'frontend' | 'backend' | 'both' | 'unknown';
  filesChanged: string[];
  artifacts: ArtifactItem[];
}
