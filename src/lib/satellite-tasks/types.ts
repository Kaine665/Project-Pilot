/**
 * Satellite Tasks — pluggable meta-cognition layer for Agent sessions.
 *
 * Satellite tasks run after each conversation turn (in finalizeRun),
 * observing the conversation and making auxiliary decisions
 * (title updates, health checks, etc.) without participating in the main task.
 */

import type { ChatSSEEvent } from '@/types';
import type { RunStatus } from '@/lib/chat-managers/types';

// ── Satellite Context ──

/**
 * Context passed to each satellite task, containing session state
 * and side-effect callbacks.
 */
export interface SatelliteContext {
  sessionId: string;
  agentId: string;
  projectKey?: string;

  /** All messages in the session (including the latest assistant turn) */
  messages: Array<{ role: string; content: string }>;
  /** Raw assistant text from the current turn (before action stripping) */
  assistantText: string;
  /** How many assistant turns have been completed (including this one) */
  assistantTurnCount: number;

  /** Current session title (may be undefined for new sessions) */
  sessionTitle?: string;
  /** How the run ended */
  runStatus: RunStatus;
  /** Whether the user explicitly stopped the session */
  userStopped?: boolean;
  /** How many times Health Guard has already retried */
  guardRetryCount?: number;

  // ── Side-effect callbacks ──

  /** Emit an SSE event to the frontend */
  emit: (event: ChatSSEEvent) => void;
  /** Update the session title */
  setSessionTitle: (title: string) => void;
  /** Resume the session with a new user message (for health guard) */
  resumeSession: (message: string) => Promise<void>;
}

// ── Satellite Task Interface ──

/**
 * A satellite task that runs alongside the main Agent conversation.
 *
 * Each task decides whether to run (shouldRun), optionally calls AI (requiresAI),
 * and executes side-effects based on the result.
 */
export interface SatelliteTask<TResult = unknown> {
  /** Unique task identifier */
  readonly id: string;
  /** Human-readable description */
  readonly description: string;
  /** Execution priority (lower = runs first) */
  readonly priority: number;
  /** Whether this task needs an AI call, or is pure local logic */
  readonly requiresAI: boolean;

  /** Determine if this task should run for the current turn */
  shouldRun(ctx: SatelliteContext): boolean;

  /**
   * Build the prompt for AI evaluation.
   * Only called when requiresAI is true and shouldRun returns true.
   */
  buildPrompt(ctx: SatelliteContext): string;

  /**
   * Parse AI response into a structured result.
   * Only called when requiresAI is true.
   */
  parseResult(raw: string): TResult;

  /**
   * Execute side-effects based on the result.
   * For non-AI tasks, called directly (result will be undefined).
   * For AI tasks, called with the parsed result.
   */
  execute(result: TResult, ctx: SatelliteContext): Promise<void>;
}
