/**
 * Shared types for the chat manager hierarchy.
 *
 * BaseRun contains all fields shared between ProcessRun and AgentChatRun.
 * Each sub-manager extends BaseRun with its own domain-specific fields.
 */

import type { ChildProcess } from 'child_process';
import type { ChatSSEEvent, ChatToolCall, ContentBlock, DangerDetectorSettings } from '@/types';

// ── Run lifecycle ──

export type RunStatus = 'running' | 'completed' | 'failed' | 'stopped';

export interface RunStatusInfo {
  status: RunStatus | 'none';
  runId?: string;
  eventCount: number;
  startedAt?: string;
}

// ── Base run data (shared by all managers) ──

export interface BaseRun {
  runId: string;
  process: ChildProcess | null;
  status: RunStatus;
  events: ChatSSEEvent[];
  listeners: Set<(event: ChatSSEEvent, index: number) => void>;
  startedAt: number;
  completedAt?: number;

  // Accumulation
  assistantText: string;
  contentBlocks: ContentBlock[];
  toolCalls: ChatToolCall[];

  // Resume support
  claudeSessionId?: string;

  // Danger detector settings snapshot (captured at spawn time)
  dangerSettings?: DangerDetectorSettings;
}

// ── Spawn configuration (built by subclass, consumed by base) ──

export interface SpawnConfig<TDomain = unknown> {
  /** Key for the runs Map (taskId or sessionId) */
  runKey: string;
  /** Claude working directory */
  workingDir: string;
  /** Content to write to stdin */
  stdinContent: string;
  /** Whether this is a --resume call */
  isResume: boolean;
  /** Existing Claude session ID (for resume) */
  claudeSessionId?: string;
  /** Extra CLI args (e.g. --image, --resume, phase-specific permissions) */
  extraCliArgs: string[];
  /** Environment variables for the subprocess */
  env: NodeJS.ProcessEnv;
  /** Callback after persist, before emitting done */
  onBeforeEmitDone?: () => Promise<void>;
  /** Domain-specific data passed through to createRun (avoids shared mutable state) */
  domainData: TDomain;
}
