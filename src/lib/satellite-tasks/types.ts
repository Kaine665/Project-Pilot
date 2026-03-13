/**
 * Satellite Task System — core type definitions.
 *
 * A SatelliteTask is a lightweight meta-cognition unit that runs
 * after each Agent conversation turn. Unlike the main Agent which
 * executes user tasks, satellites handle auxiliary decisions:
 * title updates, health checks, topic completion detection, etc.
 */

import type { ChatSSEEvent } from '@/types';
import type { RunStatus } from '@/lib/chat-managers/types';

// ── Satellite context (passed to every task) ──

export interface SatelliteContext {
  sessionId: string;
  agentId: string;
  projectKey?: string;
  /** Full message history */
  messages: Array<{ role: string; content: string }>;
  /** Raw assistant text from this turn */
  assistantText: string;
  /** Number of assistant turns so far (including this one) */
  assistantTurnCount: number;
  /** Final run status */
  runStatus: RunStatus;
  /** Whether the user explicitly stopped the run */
  userStopped?: boolean;
  /** How many times health guard has already retried */
  guardRetryCount: number;
  /** Current session title (if any) */
  sessionTitle?: string;

  // ── Side-effect callbacks ──
  emit: (event: ChatSSEEvent) => void;
  setSessionTitle: (title: string) => void;
  /**
   * Resume the session with a new user message.
   * Implementation should use setTimeout(0) to defer
   * until after current finalization completes.
   */
  resumeSession: (message: string) => void;
}

// ── Satellite task interface ──

export interface SatelliteTask<TResult = unknown> {
  /** Unique task identifier */
  readonly id: string;
  /** Human-readable description */
  readonly description: string;
  /** Execution priority (lower = earlier) */
  readonly priority: number;
  /** Whether this task needs an AI call (true) or handles it internally (false) */
  readonly requiresAI: boolean;

  /** Determine if this task should run given the current context */
  shouldRun(ctx: SatelliteContext): boolean;

  /**
   * Build prompt for AI call. Only called when requiresAI is true.
   * For non-AI tasks, this is never called.
   */
  buildPrompt(ctx: SatelliteContext): string;

  /** Parse raw AI response into structured result */
  parseResult(raw: string): TResult;

  /**
   * Execute the side-effect.
   * For AI tasks: called with parsed result.
   * For non-AI tasks: called with undefined (task handles its own logic).
   */
  execute(result: TResult, ctx: SatelliteContext): Promise<void>;
}
