/**
 * Shared types for the chat manager hierarchy.
 *
 * BaseRun contains all fields shared between ProcessRun and AgentChatRun.
 * Each sub-manager extends BaseRun with its own domain-specific fields.
 */

import type { ChildProcess } from 'child_process';
import type { ChatSSEEvent, ChatToolCall, ContentBlock, DangerDetectorSettings } from '@/types';

// ── Run lifecycle ──

/**
 * Run lifecycle:
 *   running → finalizing → completed | failed | stopped
 *
 * `finalizing`: stream has ended, satellite tasks and persistence are in progress.
 * `completed`: result has been persisted to disk — safe to read from any source.
 */
export type RunStatus = 'running' | 'finalizing' | 'completed' | 'failed' | 'stopped';

export interface RunStatusInfo {
  status: RunStatus | 'none';
  runId?: string;
  eventCount: number;
  startedAt?: string;
  /** 最后一次 error 事件的 message，便于测试连接等场景展示具体失败原因 */
  errorMessage?: string;
}

// ── Sub Agent structured result ──

/**
 * 结构化结果对象 — Sub Agent 执行完成后的标准输出。
 * 编排器和 CLI 调用方通过此对象消费结果，不再依赖解析自然语言。
 */
export interface SubAgentResult {
  /** 最终运行状态 */
  status: 'completed' | 'failed' | 'stopped' | 'timeout';
  /** AI 生成的一句话摘要（便于编排器快速消费） */
  summary: string;
  /** 可选的结构化输出（JSON 可序列化） */
  output?: unknown;
  /** 可选的产物文件路径列表 */
  artifacts?: string[];
  /** 失败时的错误信息 */
  error?: { code: string; message: string };
}

// ── Session execution record ──

/**
 * 会话运行执行记录 — 写入 SessionMeta，让磁盘读取方一次查询即可获取完整状态。
 * 消除了内存态/持久态分裂：`completed` 状态只在此记录落盘后才设置。
 */
export interface SessionExecution {
  /** 最终运行状态 */
  status: 'completed' | 'failed' | 'stopped';
  /** 运行开始时间 */
  startedAt: string;
  /** 运行完成时间 */
  completedAt: string;
  /** 结构化结果（仅 Sub Agent 调用时有） */
  result?: SubAgentResult;
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
