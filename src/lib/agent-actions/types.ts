/**
 * AgentAction — AI can proactively trigger actions by embedding XML tags in responses.
 *
 * Each action defines:
 * - instructions: prompt text telling the AI about this capability
 * - parse/strip: extract and clean the tag from AI response text
 * - execute: run the side-effect (e.g. persist data)
 *
 * Actions are registered in AgentActionRegistry and invoked uniformly
 * by AgentChatManager.onProcessClose().
 */

import type { AgentEvent } from '@/types';
import type { SessionCheckpoint } from '@/types/agent-chat';

// ── Action execution context ──

export interface ActionContext {
  sessionId: string;
  agentId: string;
  projectKey?: string;
  /** Emit an SSE event to the frontend */
  emit: (event: AgentEvent) => void;
  /** Set the session title (used by session-title action) */
  setSessionTitle: (title: string) => void;
  /** Save a session checkpoint for context-window continuity */
  setCheckpoint: (checkpoint: SessionCheckpoint) => void;
}

// ── AgentAction interface ──

export interface AgentAction<T = unknown> {
  /** Unique action identifier, e.g. 'session-title', 'session-checkpoint' */
  readonly id: string;

  /**
   * The ResourceType this action maps to in the resource system.
   * Used for backward-compatible ResourceLoader registration.
   */
  readonly resourceType: string;

  /** Section title in the prompt (## heading) */
  readonly sectionTitle: string;

  /** Priority for ordering in the prompt (lower = earlier). */
  readonly priority: number;

  /** Instruction text injected into the AI prompt */
  readonly instructions: string;

  /** Extract all occurrences of this action's tag from the AI response */
  parse(text: string): T[];

  /** Remove all occurrences of this action's tag from text (for clean display) */
  strip(text: string): string;

  /** Execute the side-effect for each parsed occurrence */
  execute(data: T, ctx: ActionContext): Promise<void>;
}
