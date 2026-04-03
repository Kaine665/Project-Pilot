/**
 * Execution 领域类型 — Event 落盘 + Run 生命周期。
 *
 * 设计见 docs/roadmap/A5-execution设计.md
 *
 * - ExecutionEvent：Turn 结束后归约出的完整事件（非流式 delta）。
 * - ExecutionRun：跨多个 Turn 的目标导向尝试。
 */

import type { ContentBlock } from './index';

// ── ID generators ──

export function makeEventId(): string {
  return `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

export function makeTurnId(): string {
  return `turn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

export function makeRunId(): string {
  return `run-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

// ── ExecutionEvent ──

interface ExecutionEventBase {
  id: string;
  ts: string;
  turnId: string;
  runId?: string;
}

export interface TurnStartEvent extends ExecutionEventBase {
  type: 'turn_start';
}

export interface UserMessageEvent extends ExecutionEventBase {
  type: 'user_message';
  content: string;
  images?: string[];
}

export interface ThinkingEvent extends ExecutionEventBase {
  type: 'thinking';
  text: string;
}

export interface ToolCallEvent extends ExecutionEventBase {
  type: 'tool_call';
  toolCallId: string;
  toolName: string;
  input: string;
  output?: string;
  status: 'completed' | 'failed';
  durationMs?: number;
}

export interface AssistantMessageEvent extends ExecutionEventBase {
  type: 'assistant_message';
  content: string;
  contentBlocks?: ContentBlock[];
}

export interface TurnEndEvent extends ExecutionEventBase {
  type: 'turn_end';
  turnStatus: 'completed' | 'stopped' | 'failed' | 'awaiting';
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    contextWindow?: number;
  };
}

export interface RunOpenEvent extends ExecutionEventBase {
  type: 'run_open';
  goal?: string;
  taskId?: string;
}

export interface RunCloseEvent extends ExecutionEventBase {
  type: 'run_close';
  outcome: RunOutcome;
  evaluationText?: string;
}

export interface ErrorEvent extends ExecutionEventBase {
  type: 'error';
  message: string;
}

export type ExecutionEvent =
  | TurnStartEvent
  | UserMessageEvent
  | ThinkingEvent
  | ToolCallEvent
  | AssistantMessageEvent
  | TurnEndEvent
  | RunOpenEvent
  | RunCloseEvent
  | ErrorEvent;

// ── ExecutionRun ──

export type RunOutcome = 'success' | 'failure' | 'partial' | 'shelved';

export interface RunEvaluation {
  outcome: RunOutcome;
  text?: string;
}

export interface ExecutionRun {
  runId: string;
  goal?: string;
  taskId?: string;
  status: 'active' | 'completed' | 'failed' | 'shelved';
  startedAt: string;
  completedAt?: string;
  startEventId: string;
  endEventId?: string;
  evaluation?: RunEvaluation;
}

export interface SessionRunsData {
  runs: ExecutionRun[];
}
