/**
 * call-agent CLI — Invoke another ProjectPilot Agent via REST API.
 *
 * Designed to be called from within an Agent's Bash tool to delegate
 * sub-tasks to other system-defined Agents.
 *
 * Usage:
 *   # 同步模式（默认，阻塞等待完成）
 *   npx tsx src/lib/call-agent.ts --agent-id <ID> --message "指令" [options]
 *
 *   # 异步模式（发起后立即返回 sessionId）
 *   npx tsx src/lib/call-agent.ts --agent-id <ID> --message "指令" --async [options]
 *
 *   # 查询模式（检查异步任务状态和结果）
 *   npx tsx src/lib/call-agent.ts --poll <sessionId> [--port 4000]
 *
 * Options:
 *   --agent-id         Required (sync/async). Target agent ID
 *   --message          Required (sync/async). The message/task to send
 *   --async            Optional. Fire-and-forget mode, prints sessionId to stdout
 *   --poll             Optional. Poll a session's status and retrieve result
 *   --project          Optional. Project key for flow context
 *   --parent-session   Optional. Parent session ID for traceability
 *   --port             Optional. Server port (default: 4000 or PROJECT_PILOT_PORT)
 *   --timeout          Optional. Timeout in seconds (default: 300, sync mode only)
 *   --task-file        Optional. Path to a file containing full task details (appended to --message)
 *   --depth            Optional. Current call depth for recursion guard (default: 0, max: 3)
 *
 * Stdout (structured JSON — ALWAYS machine-parseable):
 *   Sync completed:   {"status":"completed","sessionId":"...","content":"..."}
 *   Async started:    {"status":"started","sessionId":"..."}
 *   Poll completed:   {"status":"completed","sessionId":"...","content":"..."}
 *   Poll running:     {"status":"running","sessionId":"..."}
 *   Error:            {"status":"failed","sessionId":"...","error":"..."}
 *
 * Stderr: Diagnostic messages (session lifecycle, errors)
 * Exit codes:
 *   0 — Success (completed/started, result on stdout as JSON)
 *   1 — Error (failed, stopped, or timeout)
 *   2 — Still running (--poll mode only)
 */

import fs from 'fs';
import http from 'http';

// ── Constants ──

const MAX_DEPTH = 3;
const DEFAULT_TIMEOUT_S = 300;
const DEFAULT_PORT = 4000;
const POST_TIMEOUT_MS = 15_000;

// ── Types ──

interface CallAgentOptions {
  agentId: string;
  message: string;
  projectKey?: string;
  parentSessionId?: string;
  port: number;
  timeoutSeconds: number;
  depth: number;
}

interface CallAgentResult {
  sessionId: string;
  content: string;
}

// ── Structured output helper ──

/** Write a structured JSON result to stdout. All modes use this. */
function writeResult(data: {
  status: 'completed' | 'started' | 'running' | 'failed';
  sessionId: string;
  content?: string;
  error?: string;
}): void {
  process.stdout.write(JSON.stringify(data) + '\n');
}

// ── Core logic ──

/** POST /api/agent-chat — create session and start agent, return sessionId */
async function startSession(opts: {
  agentId: string;
  message: string;
  projectKey?: string;
  parentSessionId?: string;
  port: number;
  depth: number;
}): Promise<string> {
  const { agentId, message, projectKey, parentSessionId, port, depth } = opts;

  // Recursion guard
  if (depth > MAX_DEPTH) {
    throw new Error(
      `Sub-agent call depth ${depth} exceeds maximum ${MAX_DEPTH}. ` +
      `This prevents infinite recursion (A calls B calls A...). ` +
      `Consider restructuring the task to avoid deep nesting.`
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

  let sessionId: string;
  try {
    const parsed = JSON.parse(postResult.body);
    sessionId = parsed.sessionId;
  } catch {
    throw new Error(`Invalid JSON response from POST /api/agent-chat: ${postResult.body}`);
  }

  if (!sessionId) {
    throw new Error('No sessionId returned from POST /api/agent-chat');
  }

  return sessionId;
}

/**
 * 同步模式：发起 + 等待 SSE 完成 + fallback 验证。
 *
 * 关键改进：SSE 流结束后如果 fullText 为空，自动从磁盘读取结果。
 * 这样即使 SSE 事件丢失或 text_delta 未到达，也能拿到完整结果。
 */
async function callAgent(opts: CallAgentOptions): Promise<CallAgentResult> {
  const { port, timeoutSeconds, depth } = opts;

  const sessionId = await startSession({ ...opts, depth });
  // 立即输出 sessionId 到 stderr，即使后续 stdout 被吞也有据可查
  process.stderr.write(`[call-agent] Session started: ${sessionId} (depth=${depth})\n`);

  const sseText = await consumeSSEStream({
    hostname: '127.0.0.1',
    port,
    path: `/api/agent-chat/stream?sessionId=${encodeURIComponent(sessionId)}&since=0`,
    timeoutMs: timeoutSeconds * 1000,
  });

  // ── Fallback：SSE 文本为空时从磁盘读取 ──
  if (sseText.length > 0) {
    process.stderr.write(`[call-agent] Session completed via SSE. Response length: ${sseText.length} chars\n`);
    return { sessionId, content: sseText };
  }

  process.stderr.write(`[call-agent] SSE text empty, falling back to disk read for session ${sessionId}\n`);
  const diskContent = await readSessionFromDisk(sessionId, port);
  process.stderr.write(`[call-agent] Disk fallback result: ${diskContent.length} chars\n`);
  return { sessionId, content: diskContent };
}

/**
 * 从磁盘读取会话的最后一条 assistant 消息。
 * 用于 SSE 流文本为空时的 fallback 验证。
 */
async function readSessionFromDisk(sessionId: string, port: number): Promise<string> {
  const sessionResult = await httpRequest({
    method: 'GET',
    hostname: '127.0.0.1',
    port,
    path: `/api/agent-chat/sessions/${encodeURIComponent(sessionId)}`,
    timeoutMs: POST_TIMEOUT_MS,
  });

  if (sessionResult.statusCode !== 200) {
    throw new Error(`Disk read failed for session ${sessionId}: HTTP ${sessionResult.statusCode}`);
  }

  const session = JSON.parse(sessionResult.body);
  const messages: Array<{ role: string; content: string }> = session.messages || [];

  // Check execution record for failure
  const execution = session.execution as { status?: string; result?: { error?: { message: string } } } | undefined;
  if (execution?.status === 'failed' || execution?.status === 'stopped') {
    throw new Error(execution.result?.error?.message ?? `Session ${execution.status}`);
  }

  const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant');
  return lastAssistant?.content ?? '';
}

// ── Poll logic ──

const POLL_EXIT_RUNNING = 2;

/**
 * 查询会话状态和结果。
 *
 * 统一状态源策略：
 * 1. 先查内存状态 (/api/agent-chat/status)
 *    - `running` → 仍在执行，exit 2
 *    - `completed` → 数据保证已落盘（finalizing→completed 原子化），直接取结果
 *    - `failed`/`stopped` → exit 1
 *    - `none` → 内存已清除，回退到磁盘
 * 2. 内存 completed 时：优先使用内存消息（零延迟），否则从磁盘读取
 * 3. 内存 none 时：从磁盘会话索引读取 execution 记录
 */
async function pollSession(sessionId: string, port: number): Promise<void> {
  // Step 1: 查询内存中的运行状态
  const statusResult = await httpRequest({
    method: 'GET',
    hostname: '127.0.0.1',
    port,
    path: `/api/agent-chat/status?sessionId=${encodeURIComponent(sessionId)}`,
    timeoutMs: POST_TIMEOUT_MS,
  });

  if (statusResult.statusCode !== 200) {
    throw new Error(`GET /api/agent-chat/status failed: HTTP ${statusResult.statusCode} — ${statusResult.body}`);
  }

  const statusData = JSON.parse(statusResult.body);
  const status: string = statusData.status;

  if (status === 'running' || status === 'awaiting') {
    writeResult({ status: 'running', sessionId });
    process.exit(POLL_EXIT_RUNNING);
  }

  if (status === 'failed' || status === 'stopped') {
    process.stderr.write(`[call-agent] Session ${status}: ${sessionId}\n`);
    writeResult({ status: 'failed', sessionId, error: `Session ${status}` });
    process.exit(1);
  }

  // status === 'completed': data is guaranteed on disk (finalizing→completed is atomic).
  // Try in-memory messages first (faster), then disk.
  if (status === 'completed') {
    const snapshotResult = await httpRequest({
      method: 'GET',
      hostname: '127.0.0.1',
      port,
      path: `/api/agent-chat/runtime-snapshot?sessionId=${encodeURIComponent(sessionId)}`,
      timeoutMs: POST_TIMEOUT_MS,
    });
    if (snapshotResult.statusCode === 200) {
      const snapshotData = JSON.parse(snapshotResult.body) as {
        available?: boolean;
        messages?: Array<{ role: string; content: string }>;
      };
      const snapshotMessages = snapshotData.available ? (snapshotData.messages || []) : [];
      const inMemoryAssistant = [...snapshotMessages].reverse().find(m => m.role === 'assistant');
      if (inMemoryAssistant) {
        writeResult({ status: 'completed', sessionId, content: inMemoryAssistant.content });
        return;
      }
    }
  }

  // status === 'completed' (no in-memory msgs) or 'none' → read from disk
  const sessionResult = await httpRequest({
    method: 'GET',
    hostname: '127.0.0.1',
    port,
    path: `/api/agent-chat/sessions/${encodeURIComponent(sessionId)}`,
    timeoutMs: POST_TIMEOUT_MS,
  });

  if (sessionResult.statusCode === 404) {
    if (status === 'none') {
      throw new Error(`Session not found: ${sessionId}. It may have been deleted or never persisted.`);
    }
    // completed but 404 should never happen now, but handle gracefully
    throw new Error(`Session ${sessionId} completed but not found on disk (unexpected)`);
  }
  if (sessionResult.statusCode !== 200) {
    throw new Error(`GET /api/agent-chat/sessions/${sessionId} failed: HTTP ${sessionResult.statusCode}`);
  }

  const session = JSON.parse(sessionResult.body);
  const messages: Array<{ role: string; content: string }> = session.messages || [];

  // Check execution record for terminal status (unified state source)
  const execution = session.execution as { status?: string; result?: { status: string; summary: string; error?: { message: string } } } | undefined;
  if (execution?.status === 'failed' || execution?.status === 'stopped') {
    const errMsg = execution.result?.error?.message ?? `Session ${execution.status}`;
    process.stderr.write(`[call-agent] Session ${execution.status}: ${errMsg}\n`);
    writeResult({ status: 'failed', sessionId, error: errMsg });
    process.exit(1);
  }

  const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant');
  if (!lastAssistant) {
    throw new Error(`Session ${sessionId} has no assistant response`);
  }

  writeResult({ status: 'completed', sessionId, content: lastAssistant.content });
}

// ── HTTP helpers ──

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

function consumeSSEStream(opts: {
  hostname: string;
  port: number;
  path: string;
  timeoutMs: number;
}): Promise<string> {
  return new Promise((resolve, reject) => {
    let fullText = '';
    let settled = false;

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        req.destroy();
        reject(new Error(`SSE stream timed out after ${opts.timeoutMs / 1000}s`));
      }
    }, opts.timeoutMs);

    const settle = (fn: () => void) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        fn();
      }
    };

    const req = http.get(
      {
        hostname: opts.hostname,
        port: opts.port,
        path: opts.path,
        headers: { Accept: 'text/event-stream' },
      },
      (res) => {
        let buffer = '';

        res.on('data', (chunk: Buffer) => {
          buffer += chunk.toString();

          // Parse SSE frames: "data: {...}\n\n"
          let idx: number;
          while ((idx = buffer.indexOf('\n\n')) !== -1) {
            const frame = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);

            for (const line of frame.split('\n')) {
              if (!line.startsWith('data: ')) continue;

              const jsonStr = line.slice(6);
              try {
                const event = JSON.parse(jsonStr);

                if (event.type === 'text_delta' && typeof event.text === 'string') {
                  fullText += event.text;
                } else if (event.type === 'done') {
                  settle(() => {
                    req.destroy();
                    resolve(fullText);
                  });
                  return;
                } else if (event.type === 'error') {
                  process.stderr.write(`[call-agent] Error event: ${event.message ?? JSON.stringify(event)}\n`);
                }
              } catch {
                // Ignore non-JSON lines (e.g. SSE comments)
              }
            }
          }
        });

        res.on('end', () => {
          settle(() => resolve(fullText));
        });

        res.on('error', (err) => {
          settle(() => reject(err));
        });
      },
    );

    req.on('error', (err) => {
      settle(() => reject(err));
    });
  });
}

// ── CLI entry ──

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

  // ── Mode: --poll <sessionId> ──
  const pollSessionId = opts['poll'];
  if (pollSessionId && pollSessionId !== 'true') {
    try {
      await pollSession(pollSessionId, port);
    } catch (err) {
      process.stderr.write(`[call-agent] POLL FAILED: ${(err as Error).message}\n`);
      writeResult({ status: 'failed', sessionId: pollSessionId, error: (err as Error).message });
      process.exit(1);
    }
    return;
  }

  // ── Mode: --async / sync (default) ──
  const agentId = opts['agent-id'];
  const isAsync = opts['async'] === 'true';

  // --task-file: read file content and append/use as message
  const taskFile = opts['task-file'];
  let message = opts['message'] || '';
  if (taskFile && taskFile !== 'true') {
    const fileContent = fs.readFileSync(taskFile, 'utf-8').trim();
    message = message ? `${message}\n\n---\n\n${fileContent}` : fileContent;
  }

  if (!agentId || !message) {
    process.stderr.write(
      'Usage:\n' +
      '  npx tsx src/lib/call-agent.ts --agent-id <ID> --message "指令" [--task-file path] [options]\n' +
      '  npx tsx src/lib/call-agent.ts --agent-id <ID> --message "指令" --async [--task-file path] [options]\n' +
      '  npx tsx src/lib/call-agent.ts --poll <sessionId> [--port 4000]\n',
    );
    process.exit(1);
  }

  const timeoutSeconds = parseInt(opts['timeout'] || String(DEFAULT_TIMEOUT_S), 10);
  const depth = parseInt(opts['depth'] || '0', 10);

  try {
    if (isAsync) {
      // 异步模式：发起后立即返回 sessionId
      const sessionId = await startSession({
        agentId,
        message,
        projectKey: opts['project'],
        parentSessionId: opts['parent-session'],
        port,
        depth,
      });
      process.stderr.write(`[call-agent] Async session started: ${sessionId} (depth=${depth})\n`);
      writeResult({ status: 'started', sessionId });
    } else {
      // 同步模式：阻塞等待完成，含 fallback 验证
      const result = await callAgent({
        agentId,
        message,
        projectKey: opts['project'],
        parentSessionId: opts['parent-session'],
        port,
        timeoutSeconds,
        depth,
      });
      writeResult({ status: 'completed', sessionId: result.sessionId, content: result.content });
    }
  } catch (err) {
    process.stderr.write(`[call-agent] FAILED: ${(err as Error).message}\n`);
    writeResult({ status: 'failed', sessionId: '', error: (err as Error).message });
    process.exit(1);
  }
}

// Run when invoked directly
const isDirectRun = process.argv[1]?.replace(/\\/g, '/').includes('call-agent');
if (isDirectRun) {
  main().catch((err) => {
    process.stderr.write(`[call-agent] ${err.message}\n`);
    process.exit(1);
  });
}
