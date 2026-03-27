/**
 * Shared types for the chat manager hierarchy.
 *
 * BaseRun contains all fields shared between ProcessRun and AgentChatRun.
 * Each sub-manager extends BaseRun with its own domain-specific fields.
 */

import type { ChildProcess } from 'child_process';
import type { ChatSSEEvent, ChatToolCall, ContentBlock, DangerDetectorSettings } from '@/types';

// Run lifecycle

/**
 * Run lifecycle:
 *   running -> finalizing -> completed | failed | stopped
 *
 * `finalizing`: stream has ended, persistence and post-processing are in progress.
 * `completed`: result has been persisted to disk - safe to read from any source.
 */
export type RunStatus = 'running' | 'finalizing' | 'awaiting' | 'completed' | 'failed' | 'stopped';

export interface RunStatusInfo {
  status: RunStatus | 'none';
  runId?: string;
  eventCount: number;
  startedAt?: string;
  errorMessage?: string;
}

// Sub Agent structured result

/**
 * Structured result object emitted after a Sub Agent run completes.
 * Other manager layers and CLI callers consume this instead of parsing natural language.
 */
export interface SubAgentResult {
  status: 'completed' | 'failed' | 'stopped' | 'timeout';
  summary: string;
  output?: unknown;
  artifacts?: string[];
  error?: { code: string; message: string };
}

// Session execution record

/**
 * Persisted summary of the latest completed or awaiting run.
 * This is a disk-readable summary, not a runtime snapshot.
 */
export interface SessionExecution {
  runId: string;
  status: 'completed' | 'failed' | 'stopped' | 'awaiting';
  startedAt: string;
  completedAt: string;
  errorMessage?: string;
  stopReason?: string;
  resultSummary?: string;
  result?: SubAgentResult;
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    contextWindow?: number;
  };
  eventCount: number;
  awaiting?: {
    waiting: true;
    subAgentSessionIds: string[];
    registeredAt: number;
    timeoutMs: number;
  };
}

// Base run data (shared by all managers)

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

// Spawn configuration (built by subclass, consumed by base)

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
