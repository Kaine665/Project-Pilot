/**
 * call-agent-batch CLI — 批量并行调用多个 ProjectPilot Agent。
 *
 * 支持并发控制、超时管理、结果聚合，适合 MapReduce 场景。
 *
 * Usage:
 *   npx tsx src/lib/call-agent-batch.ts --tasks tasks.json [options]
 *
 * Options:
 *   --tasks            Required. JSON 文件路径，包含任务数组
 *   --output           Optional. 结果输出文件路径（默认 stdout）
 *   --timeout          Optional. 单个任务超时秒数（默认 300）
 *   --poll-interval    Optional. 轮询间隔毫秒（默认 2000）
 *   --concurrency      Optional. 最大并发数（默认 10，防止资源耗尽）
 *   --port             Optional. 服务端口（默认 4000 或 PROJECT_PILOT_PORT）
 *   --depth            Optional. 调用深度（默认 0，上限 3）
 *
 * tasks.json 格式:
 *   [
 *     { "agentId": "agent-a", "message": "分析组件 A", "projectKey": "project-pilot" },
 *     { "agentId": "agent-b", "message": "分析组件 B" }
 *   ]
 *
 * 输出格式（JSON）:
 *   {
 *     "summary": { "total": 64, "completed": 62, "failed": 1, "timeout": 1 },
 *     "results": [
 *       { "index": 0, "agentId": "agent-a", "status": "completed", "sessionId": "s-xxx", "result": "..." },
 *       { "index": 1, "agentId": "agent-b", "status": "failed", "sessionId": "s-yyy", "error": "..." }
 *     ]
 *   }
 *
 * Exit codes:
 *   0 — 全部成功
 *   1 — 部分或全部失败
 */

import http from 'http';
import { readFileSync, writeFileSync } from 'fs';

// ── Constants ──

const MAX_DEPTH = 3;
const DEFAULT_TIMEOUT_S = 300;
const DEFAULT_POLL_INTERVAL_MS = 2000;
const DEFAULT_CONCURRENCY = 10;
const DEFAULT_PORT = 4000;
const POST_TIMEOUT_MS = 15_000;

// ── Types ──

interface Task {
  agentId: string;
  message: string;
  projectKey?: string;
}

interface TaskResult {
  index: number;
  agentId: string;
  status: 'completed' | 'failed' | 'timeout';
  sessionId: string;
  result?: string;
  error?: string;
  durationMs: number;
}

interface BatchResult {
  summary: {
    total: number;
    completed: number;
    failed: number;
    timeout: number;
    totalDurationMs: number;
  };
  results: TaskResult[];
}

// ── HTTP helpers (from call-agent.ts) ──

interface HttpResult {
  statusCode: number;
  body: string;
}

function httpRequest(opts: {
  method: string;
  hostname: string;
  port: number;
  path: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs: number;
}): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        method: opts.method,
        hostname: opts.hostname,
        port: opts.port,
        path: opts.path,
        headers: opts.headers,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        res.on('end', () => resolve({ statusCode: res.statusCode!, body }));
      },
    );

    req.setTimeout(opts.timeoutMs, () => {
      req.destroy(new Error('Request timed out'));
    });
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

// ── Core functions ──

async function startSession(
  task: Task,
  port: number,
  depth: number,
  parentSessionId?: string,
): Promise<string> {
  const { agentId, message, projectKey } = task;

  if (depth > MAX_DEPTH) {
    throw new Error(
      `Sub-agent call depth ${depth} exceeds maximum ${MAX_DEPTH}. `
    );
  }

  const body = JSON.stringify({
    agentId,
    message,
    projectKey: projectKey || undefined,
    parentSessionId: parentSessionId || undefined,
    depth,
    background: true,
  });

  const postResult = await httpRequest({
    method: 'POST',
    hostname: '127.0.0.1',
    port,
    path: '/api/agent-chat',
    headers: { 'Content-Type': 'application/json' },
    body,
    timeoutMs: POST_TIMEOUT_MS,
  });

  if (postResult.statusCode !== 200) {
    let errorMsg = postResult.body;
    try {
      const parsed = JSON.parse(postResult.body);
      if (parsed.error) errorMsg = parsed.error;
    } catch { /* use raw body */ }
    throw new Error(`${errorMsg} (HTTP ${postResult.statusCode})`);
  }

  const parsed = JSON.parse(postResult.body);
  if (!parsed.sessionId) {
    throw new Error('No sessionId returned');
  }
  return parsed.sessionId;
}

/**
 * Poll a session's status. With the unified state source:
 * - `completed` guarantees data is on disk (no more race window)
 * - `running` includes `finalizing` (server maps it for backward compat)
 */
async function pollSession(sessionId: string, port: number): Promise<{ status: 'running' | 'completed' | 'failed'; result?: string; error?: string }> {
  // Step 1: Check in-memory status
  const statusResult = await httpRequest({
    method: 'GET',
    hostname: '127.0.0.1',
    port,
    path: `/api/agent-chat/status?sessionId=${encodeURIComponent(sessionId)}`,
    timeoutMs: POST_TIMEOUT_MS,
  });

  if (statusResult.statusCode !== 200) {
    return { status: 'failed', error: `Status check failed: HTTP ${statusResult.statusCode}` };
  }

  const statusData = JSON.parse(statusResult.body);
  const status: string = statusData.status;
  const statusMessages: Array<{ role: string; content: string }> = statusData.messages || [];

  if (status === 'running') {
    return { status: 'running' };
  }

  if (status === 'failed' || status === 'stopped') {
    return { status: 'failed', error: `Session ${status}` };
  }

  // status === 'completed': data guaranteed on disk. Try in-memory messages first.
  if (status === 'completed') {
    const inMemoryAssistant = [...statusMessages].reverse().find(m => m.role === 'assistant');
    if (inMemoryAssistant) {
      return { status: 'completed', result: inMemoryAssistant.content };
    }
  }

  // status === 'completed' (no in-mem msgs) or 'none' → fetch from disk
  const sessionResult = await httpRequest({
    method: 'GET',
    hostname: '127.0.0.1',
    port,
    path: `/api/agent-chat/sessions/${encodeURIComponent(sessionId)}`,
    timeoutMs: POST_TIMEOUT_MS,
  });

  if (sessionResult.statusCode === 404) {
    if (status === 'none') {
      // Memory cleared, disk missing — treat as still starting or deleted
      return { status: 'running' };
    }
    return { status: 'failed', error: 'Session completed but not found on disk' };
  }
  if (sessionResult.statusCode !== 200) {
    return { status: 'failed', error: `Fetch failed: HTTP ${sessionResult.statusCode}` };
  }

  const session = JSON.parse(sessionResult.body);
  const messages: Array<{ role: string; content: string }> = session.messages || [];

  // Check execution record (unified state source)
  const execution = session.execution as { status?: string; result?: { error?: { message: string } } } | undefined;
  if (execution?.status === 'failed' || execution?.status === 'stopped') {
    return { status: 'failed', error: execution.result?.error?.message ?? `Session ${execution.status}` };
  }

  const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant');
  if (!lastAssistant) {
    return { status: 'failed', error: 'No assistant response' };
  }

  return { status: 'completed', result: lastAssistant.content };
}

// ── Batch processing with concurrency control ──

async function runBatch(
  tasks: Task[],
  options: {
    port: number;
    timeoutSeconds: number;
    pollIntervalMs: number;
    concurrency: number;
    depth: number;
    parentSessionId?: string;
  },
): Promise<BatchResult> {
  const { port, timeoutSeconds, pollIntervalMs, concurrency, depth, parentSessionId } = options;
  const startTime = Date.now();

  // State tracking for each task
  const state = new Map<number, {
    task: Task;
    sessionId?: string;
    status: 'pending' | 'starting' | 'running' | 'completed' | 'failed' | 'timeout';
    result?: string;
    error?: string;
    startTime?: number;
    endTime?: number;
  }>();

  tasks.forEach((task, index) => {
    state.set(index, { task, status: 'pending' });
  });

  // Start tasks with concurrency limit
  const starting = new Set<number>();
  const running = new Set<number>();

  async function startNext(): Promise<void> {
    // Find next pending task
    for (const [index, s] of state) {
      if (s.status === 'pending' && starting.size < concurrency) {
        starting.add(index);
        s.status = 'starting';
        s.startTime = Date.now();

        try {
          const sessionId = await startSession(s.task, port, depth, parentSessionId);
          s.sessionId = sessionId;
          s.status = 'running';
          running.add(index);
          process.stderr.write(`[batch] Task ${index} started: ${sessionId}\n`);
        } catch (err) {
          s.status = 'failed';
          s.error = (err as Error).message;
          s.endTime = Date.now();
          process.stderr.write(`[batch] Task ${index} failed to start: ${s.error}\n`);
        }

        starting.delete(index);
        // Try to start more
        await startNext();
        return;
      }
    }
  }

  // Initial batch start
  const initialPromises: Promise<void>[] = [];
  for (let i = 0; i < Math.min(concurrency, tasks.length); i++) {
    initialPromises.push(startNext());
  }
  await Promise.all(initialPromises);

  // Poll loop
  const timeoutMs = timeoutSeconds * 1000;

  while (true) {
    const pendingOrRunning = [...state.values()].filter(
      s => s.status === 'starting' || s.status === 'running'
    );

    if (pendingOrRunning.length === 0) {
      break; // All done
    }

    // Check each running task
    for (const [index, s] of state) {
      if (s.status === 'running' && s.sessionId) {
        const elapsed = Date.now() - (s.startTime || 0);

        if (elapsed > timeoutMs) {
          s.status = 'timeout';
          s.error = `Timeout after ${timeoutSeconds}s`;
          s.endTime = Date.now();
          running.delete(index);
          process.stderr.write(`[batch] Task ${index} timeout\n`);
          // Try to start next
          await startNext();
          continue;
        }

        try {
          const poll = await pollSession(s.sessionId, port);

          if (poll.status === 'completed') {
            s.status = 'completed';
            s.result = poll.result;
            s.endTime = Date.now();
            running.delete(index);
            process.stderr.write(`[batch] Task ${index} completed (${s.result?.length || 0} chars)\n`);
            // Try to start next
            await startNext();
          } else if (poll.status === 'failed') {
            s.status = 'failed';
            s.error = poll.error;
            s.endTime = Date.now();
            running.delete(index);
            process.stderr.write(`[batch] Task ${index} failed: ${poll.error}\n`);
            // Try to start next
            await startNext();
          }
          // else still running, continue polling
        } catch (err) {
          // Poll error, will retry next cycle
          process.stderr.write(`[batch] Task ${index} poll error: ${(err as Error).message}\n`);
        }
      }
    }

    // Wait before next poll
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
  }

  // Build result
  const totalDuration = Date.now() - startTime;
  const results: TaskResult[] = [];

  for (let i = 0; i < tasks.length; i++) {
    const s = state.get(i)!;
    results.push({
      index: i,
      agentId: s.task.agentId,
      status: s.status as 'completed' | 'failed' | 'timeout',
      sessionId: s.sessionId || '',
      result: s.result,
      error: s.error,
      durationMs: s.startTime ? (s.endTime ?? Date.now()) - s.startTime : 0,
    });
  }

  const summary = {
    total: tasks.length,
    completed: results.filter(r => r.status === 'completed').length,
    failed: results.filter(r => r.status === 'failed').length,
    timeout: results.filter(r => r.status === 'timeout').length,
    totalDurationMs: totalDuration,
  };

  return { summary, results };
}

// ── CLI ──

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        result[key] = next;
        i++;
      } else {
        result[key] = 'true';
      }
    }
  }
  return result;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const port = parseInt(opts['port'] || process.env.PROJECT_PILOT_PORT || String(DEFAULT_PORT), 10);

  const tasksFile = opts['tasks'];
  if (!tasksFile) {
    process.stderr.write(
      'Usage: npx tsx src/lib/call-agent-batch.ts --tasks tasks.json [options]\n\n' +
      'Options:\n' +
      '  --tasks            Required. JSON file with task array\n' +
      '  --output           Optional. Output file (default: stdout)\n' +
      '  --timeout          Optional. Timeout per task in seconds (default: 300)\n' +
      '  --poll-interval    Optional. Poll interval in ms (default: 2000)\n' +
      '  --concurrency      Optional. Max concurrent tasks (default: 10)\n' +
      '  --port             Optional. Server port (default: 4000)\n' +
      '  --depth            Optional. Call depth (default: 0)\n',
    );
    process.exit(1);
  }

  // Parse tasks
  let tasks: Task[];
  try {
    const content = readFileSync(tasksFile, 'utf-8');
    tasks = JSON.parse(content);
    if (!Array.isArray(tasks)) {
      throw new Error('Tasks file must contain an array');
    }
    if (tasks.length === 0) {
      throw new Error('Tasks array is empty');
    }
    for (const task of tasks) {
      if (!task.agentId || !task.message) {
        throw new Error('Each task must have agentId and message');
      }
    }
  } catch (err) {
    process.stderr.write(`[batch] Failed to parse tasks file: ${(err as Error).message}\n`);
    process.exit(1);
  }

  const timeoutSeconds = parseInt(opts['timeout'] || String(DEFAULT_TIMEOUT_S), 10);
  const pollIntervalMs = parseInt(opts['poll-interval'] || String(DEFAULT_POLL_INTERVAL_MS), 10);
  const concurrency = parseInt(opts['concurrency'] || String(DEFAULT_CONCURRENCY), 10);
  const depth = parseInt(opts['depth'] || '0', 10);

  process.stderr.write(`[batch] Starting ${tasks.length} tasks with concurrency=${concurrency}, timeout=${timeoutSeconds}s\n`);

  try {
    const result = await runBatch(tasks, {
      port,
      timeoutSeconds,
      pollIntervalMs,
      concurrency,
      depth,
    });

    const outputJson = JSON.stringify(result, null, 2);

    if (opts['output']) {
      writeFileSync(opts['output'], outputJson);
      process.stderr.write(`[batch] Results written to ${opts['output']}\n`);
    } else {
      process.stdout.write(outputJson);
    }

    process.stderr.write(
      `[batch] Summary: ${result.summary.completed}/${result.summary.total} completed, ` +
      `${result.summary.failed} failed, ${result.summary.timeout} timeout ` +
      `(${result.summary.totalDurationMs}ms)\n`,
    );

    // Exit 1 if any failed
    process.exit(result.summary.completed === result.summary.total ? 0 : 1);
  } catch (err) {
    process.stderr.write(`[batch] Fatal error: ${(err as Error).message}\n`);
    process.exit(1);
  }
}

// Run when invoked directly
const isDirectRun = process.argv[1]?.replace(/\\/g, '/').includes('call-agent-batch');
if (isDirectRun) {
  main().catch((err) => {
    process.stderr.write(`[batch] ${err.message}\n`);
    process.exit(1);
  });
}
