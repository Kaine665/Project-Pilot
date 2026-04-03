/**
 * Execution Event Store — Event JSONL + Run JSON 持久化。
 *
 * - events/<sessionId>.jsonl: 每行一个 ExecutionEvent JSON
 * - runs/<sessionId>.json: { runs: ExecutionRun[] }
 *
 * Event 写入时机：Turn 结束后（finalizeRun），从 AgentChatRun 的内存累积中归约。
 */

import { promises as fs } from 'fs';
import { appendFileSync, mkdirSync } from 'fs';
import {
  getSessionEventsDir,
  getSessionEventsPath,
  getSessionRunsDir,
  getSessionRunsPath,
  readJsonFile,
  parseJsonSafe,
} from '@/lib/file-store';
import type {
  ExecutionEvent,
  ExecutionRun,
  SessionRunsData,
  RunOutcome,
} from '@/types/execution';
import {
  makeEventId,
  makeTurnId,
  makeRunId,
} from '@/types/execution';

// ── Event JSONL I/O ──

/**
 * Append events to the session's event JSONL file (sync, like appendMessages).
 */
export function appendEvents(sessionId: string, events: ExecutionEvent[]): void {
  if (events.length === 0) return;
  const filePath = getSessionEventsPath(sessionId);
  const dir = getSessionEventsDir();
  try { mkdirSync(dir, { recursive: true }); } catch { /* already exists */ }
  const lines = events.map(e => JSON.stringify(e)).join('\n') + '\n';
  appendFileSync(filePath, lines, 'utf-8');
}

/**
 * Read all execution events for a session.
 */
export async function readEvents(sessionId: string): Promise<ExecutionEvent[]> {
  const filePath = getSessionEventsPath(sessionId);
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const events: ExecutionEvent[] = [];
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        events.push(parseJsonSafe<ExecutionEvent>(trimmed));
      } catch {
        console.warn(`[execution-event-store] Skipping malformed event line in ${sessionId}`);
      }
    }
    return events;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

/**
 * Delete events file for a session.
 */
export async function deleteEventsFile(sessionId: string): Promise<void> {
  await fs.unlink(getSessionEventsPath(sessionId)).catch(() => {});
}

// ── Run JSON I/O ──

const DEFAULT_RUNS_DATA: SessionRunsData = { runs: [] };

export async function readRuns(sessionId: string): Promise<ExecutionRun[]> {
  const data = await readJsonFile<SessionRunsData>(
    getSessionRunsPath(sessionId),
    DEFAULT_RUNS_DATA,
  );
  return data.runs;
}

async function writeRuns(sessionId: string, runs: ExecutionRun[]): Promise<void> {
  const dir = getSessionRunsDir();
  await fs.mkdir(dir, { recursive: true });
  const filePath = getSessionRunsPath(sessionId);
  await fs.writeFile(filePath, JSON.stringify({ runs }, null, 2), 'utf-8');
}

export async function deleteRunsFile(sessionId: string): Promise<void> {
  await fs.unlink(getSessionRunsPath(sessionId)).catch(() => {});
}

// ── Run Lifecycle ──

export async function openRun(
  sessionId: string,
  opts: { goal?: string; taskId?: string; startEventId: string },
): Promise<ExecutionRun> {
  const run: ExecutionRun = {
    runId: makeRunId(),
    goal: opts.goal,
    taskId: opts.taskId,
    status: 'active',
    startedAt: new Date().toISOString(),
    startEventId: opts.startEventId,
  };
  const existing = await readRuns(sessionId);

  const activeIdx = existing.findIndex(r => r.status === 'active');
  if (activeIdx >= 0) {
    existing[activeIdx].status = 'shelved';
    existing[activeIdx].completedAt = new Date().toISOString();
  }

  existing.push(run);
  await writeRuns(sessionId, existing);
  return run;
}

export async function closeRun(
  sessionId: string,
  runId: string,
  opts: { outcome: RunOutcome; evaluationText?: string; endEventId?: string },
): Promise<ExecutionRun | null> {
  const runs = await readRuns(sessionId);
  const run = runs.find(r => r.runId === runId);
  if (!run) return null;

  const statusMap: Record<RunOutcome, ExecutionRun['status']> = {
    success: 'completed',
    failure: 'failed',
    partial: 'completed',
    shelved: 'shelved',
  };

  run.status = statusMap[opts.outcome];
  run.completedAt = new Date().toISOString();
  run.endEventId = opts.endEventId;
  run.evaluation = {
    outcome: opts.outcome,
    text: opts.evaluationText,
  };

  await writeRuns(sessionId, runs);
  return run;
}

export async function getActiveRun(sessionId: string): Promise<ExecutionRun | undefined> {
  const runs = await readRuns(sessionId);
  return runs.find(r => r.status === 'active');
}

// ── Turn → Event 归约 ──

export interface TurnData {
  sessionId: string;
  userContent: string;
  userImages?: string[];
  assistantContent: string;
  contentBlocks: Array<{ type: string; text: string }>;
  toolCalls: Array<{
    id: string;
    toolName: string;
    input: string;
    output?: string;
    status: 'running' | 'completed' | 'failed';
  }>;
  errors: string[];
  turnStatus: 'completed' | 'stopped' | 'failed' | 'awaiting';
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    contextWindow?: number;
  };
  startedAt: number;
  completedAt: number;
}

/**
 * 从一次 Turn（AgentChatRun）的内存累积中归约出 ExecutionEvent 列表，并追加到 JSONL。
 *
 * 归约策略：只提取完成态的完整事件，不存 delta。
 */
export function reduceAndPersistTurnEvents(data: TurnData, activeRunId?: string): ExecutionEvent[] {
  const turnId = makeTurnId();
  const now = new Date(data.completedAt).toISOString();
  const events: ExecutionEvent[] = [];

  const base = () => ({ id: makeEventId(), ts: now, turnId, runId: activeRunId });

  // 1. turn_start
  events.push({ ...base(), type: 'turn_start', ts: new Date(data.startedAt).toISOString() });

  // 2. user_message
  events.push({
    ...base(),
    type: 'user_message',
    ts: new Date(data.startedAt).toISOString(),
    content: data.userContent,
    images: data.userImages?.length ? data.userImages : undefined,
  });

  // 3. thinking blocks
  for (const block of data.contentBlocks) {
    if (block.type === 'thinking' && block.text.trim()) {
      events.push({ ...base(), type: 'thinking', text: block.text });
    }
  }

  // 4. tool_call (completed)
  for (const tc of data.toolCalls) {
    if (tc.status === 'running') continue;
    events.push({
      ...base(),
      type: 'tool_call',
      toolCallId: tc.id,
      toolName: tc.toolName,
      input: tc.input,
      output: tc.output,
      status: tc.status,
    });
  }

  // 5. errors
  for (const msg of data.errors) {
    events.push({ ...base(), type: 'error', message: msg });
  }

  // 6. assistant_message
  if (data.assistantContent.trim()) {
    const textBlocks = data.contentBlocks
      .filter(b => b.type === 'text' && b.text.trim())
      .map(b => ({ type: 'text' as const, text: b.text }));

    events.push({
      ...base(),
      type: 'assistant_message',
      content: data.assistantContent,
      contentBlocks: textBlocks.length > 0 ? textBlocks : undefined,
    });
  }

  // 7. turn_end
  events.push({
    ...base(),
    type: 'turn_end',
    turnStatus: data.turnStatus,
    tokenUsage: data.tokenUsage,
  });

  // Persist
  appendEvents(data.sessionId, events);

  return events;
}

// Re-export ID generators for convenience
export { makeEventId, makeTurnId, makeRunId };
