/**
 * Agent Sidecar Server — 独立 HTTP 进程，托管 AgentChatManager 和 SchedulerManager。
 *
 * 与 Next.js 进程完全独立，在 Next.js 热重载/重启时继续存活，保持所有 Agent 会话状态。
 * Next.js API 路由通过 localhost HTTP 与此进程通信（见 src/lib/sidecar-bridge.ts）。
 *
 * 启动：
 *   dev:   npx tsx src/sidecar/server.ts
 *   prod:  node electron/dist/sidecar.js
 *
 * 对外 API：
 *   GET  /health
 *   POST /agent-chat/start
 *   POST /agent-chat/stop
 *   POST /agent-chat/guest
 *   GET  /agent-chat/stream?sessionId=xxx     (SSE)
 *   GET  /agent-chat/status?sessionId=xxx
 *   POST /agent-chat/clear
 *   POST /agent-chat/update-config
 *   GET  /schedules
 *   POST /schedules
 *   GET  /schedules/:id
 *   PATCH /schedules/:id
 *   DELETE /schedules/:id
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { URL } from 'url';

// 使用 @/ 别名 — tsx（dev）和 esbuild --tsconfig（prod）均可解析
import { agentChatManager, generateSessionId } from '@/lib/chat-managers/agent-chat-manager';
import type { FlowContext } from '@/lib/chat-managers/agent-chat-manager';
import { loadSession } from '@/lib/chat-managers/agent-chat-session-store';
import { schedulerManager } from '@/lib/scheduler-manager';
import type { ChatSSEEvent } from '@/types';
import type { SessionConfig } from '@/types/agent-chat';
import type { ProviderId } from '@/types';

// ── 配置 ─────────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.SIDECAR_PORT ?? '4500', 10);
const LOCK_DIR = path.join(os.homedir(), '.project-pilot');
const LOCK_PATH = path.join(LOCK_DIR, 'sidecar.lock');

// ── Lock file ────────────────────────────────────────────────────────────────

function writeLock(): void {
  fs.mkdirSync(LOCK_DIR, { recursive: true });
  fs.writeFileSync(LOCK_PATH, JSON.stringify({ pid: process.pid, port: PORT }), 'utf8');
}

function removeLock(): void {
  try { fs.unlinkSync(LOCK_PATH); } catch { /* ignore */ }
}

// ── 工具函数 ─────────────────────────────────────────────────────────────────

async function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

function jsonResponse(res: http.ServerResponse, data: unknown, status = 200): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function notFound(res: http.ServerResponse): void {
  jsonResponse(res, { error: 'Not found' }, 404);
}

// ── Depth computation (recursive protection) ────────────────────────────────

/**
 * Walk the parentSessionId chain to compute the actual call depth.
 * Each hop from child → parent increments depth by 1.
 * Caps traversal at 10 to prevent infinite loops from circular refs.
 */
async function computeDepthFromParentChain(parentSessionId: string): Promise<number> {
  let depth = 1; // the current session will be one level deeper than parent
  let currentId: string | undefined = parentSessionId;
  const MAX_CHAIN = 10;

  while (currentId && depth < MAX_CHAIN) {
    const session = await loadSession(currentId);
    if (!session?.parentSessionId) break;
    currentId = session.parentSessionId;
    depth++;
  }
  return depth;
}

// ── Route handlers ───────────────────────────────────────────────────────────

function handleHealth(res: http.ServerResponse): void {
  jsonResponse(res, { ok: true, pid: process.pid, port: PORT });
}

async function handleStart(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const body = await readBody(req) as {
    sessionId?: string;
    agentId: string;
    message: string;
    flowContext?: FlowContext;
    images?: Array<{ mediaType: string; data: string }>;
    initialTitle?: string;
    config?: SessionConfig;
    parentSessionId?: string;
    providerOverride?: ProviderId;
    modelOverride?: string;
    effortOverride?: string;
    depth?: number;
  };

  const sessionId = body.sessionId ?? generateSessionId();

  // ── Recursive depth enforcement (行动项 4) ──
  // Server-side depth calculation from parentSessionId chain takes priority
  // over client-supplied depth, preventing bypass by forgetting --depth.
  let effectiveDepth: number = body.depth ?? 0;
  if (body.parentSessionId) {
    const serverDepth = await computeDepthFromParentChain(body.parentSessionId);
    effectiveDepth = Math.max(effectiveDepth, serverDepth);
  }
  const MAX_SUB_AGENT_DEPTH = 3;
  if (effectiveDepth > MAX_SUB_AGENT_DEPTH) {
    jsonResponse(res, {
      error: `Sub-agent call depth ${effectiveDepth} exceeds maximum ${MAX_SUB_AGENT_DEPTH}. ` +
        `This prevents infinite recursion. Consider restructuring the task.`,
    }, 400);
    return;
  }

  try {
    const runId = await agentChatManager.start(
      sessionId,
      body.agentId,
      body.message,
      body.flowContext,
      body.images as import('@/lib/chat-managers/agent-chat-manager').ImageAttachment[] | undefined,
      body.initialTitle,
      body.config,
      body.parentSessionId,
      body.providerOverride,
      body.modelOverride,
      body.effortOverride,
      undefined, // ephemeral
      effectiveDepth,
    );
    jsonResponse(res, { runId, sessionId });
  } catch (err) {
    jsonResponse(res, { error: (err as Error).message }, 500);
  }
}

async function handleStop(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const body = await readBody(req) as { sessionId: string };
  const stopped = await agentChatManager.stop(body.sessionId);
  jsonResponse(res, { stopped });
}

async function handleGuest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const body = await readBody(req) as {
    guestSessionId?: string;
    agentId: string;
    message: string;
    parentSessionId: string;
    importedTurnIndices: number[] | 'all';
  };

  const guestSessionId = body.guestSessionId ?? generateSessionId();

  try {
    const runId = await agentChatManager.startGuest(
      guestSessionId,
      body.agentId,
      body.message,
      body.parentSessionId,
      body.importedTurnIndices,
    );
    jsonResponse(res, { runId, sessionId: guestSessionId, parentSessionId: body.parentSessionId });
  } catch (err) {
    jsonResponse(res, { error: (err as Error).message }, 500);
  }
}

function handleStream(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
): void {
  const sessionId = url.searchParams.get('sessionId') ?? '';
  const since = parseInt(url.searchParams.get('since') ?? '0', 10);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  // 初始心跳，确认连接建立
  res.write(':ok\n\n');

  const push = (event: ChatSSEEvent, index: number): void => {
    try {
      const payload = JSON.stringify({ ...event, _idx: index });
      res.write(`data: ${payload}\n\n`);
    } catch { /* 连接已关闭 */ }

    if (event.type === 'done') {
      try { res.end(); } catch { /* already ended */ }
    }
  };

  const unsubscribe = agentChatManager.subscribe(sessionId, since, push);

  if (!unsubscribe) {
    // 无对应 run → 立即发 done
    res.write(`data: ${JSON.stringify({ type: 'done', _idx: -1 })}\n\n`);
    res.end();
    return;
  }

  // 客户端断开连接时取消订阅
  req.on('close', () => {
    unsubscribe();
  });
}

function handleStatus(res: http.ServerResponse, url: URL): void {
  const sessionId = url.searchParams.get('sessionId') ?? '';
  const info = agentChatManager.getStatus(sessionId);
  const messages = agentChatManager.getMessages(sessionId);
  jsonResponse(res, { ...info, messages });
}

async function handleClear(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const body = await readBody(req) as { sessionId: string };
  agentChatManager.clear(body.sessionId);
  jsonResponse(res, { ok: true });
}

async function handleUpdateConfig(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const body = await readBody(req) as { sessionId: string; config: SessionConfig };
  const found = await agentChatManager.updateConfig(body.sessionId, body.config);
  if (!found) {
    jsonResponse(res, { error: 'Session not found' }, 404);
    return;
  }
  jsonResponse(res, { ok: true });
}

// ── Schedules ────────────────────────────────────────────────────────────────

async function handleListSchedules(res: http.ServerResponse): Promise<void> {
  try {
    const schedules = await schedulerManager.listSchedules();
    jsonResponse(res, { schedules });
  } catch (err) {
    jsonResponse(res, { error: (err as Error).message }, 500);
  }
}

async function handleCreateSchedule(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const body = await readBody(req) as {
    agentId: string;
    cron: string;
    message: string;
    projectKey?: string;
    label?: string;
    enabled?: boolean;
  };
  try {
    const schedule = await schedulerManager.createSchedule({
      agentId: body.agentId,
      cron: body.cron,
      message: body.message,
      projectKey: body.projectKey,
      label: body.label,
      enabled: body.enabled !== false,
    });
    jsonResponse(res, { schedule }, 201);
  } catch (err) {
    jsonResponse(res, { error: (err as Error).message }, 400);
  }
}

async function handleGetSchedule(
  res: http.ServerResponse,
  scheduleId: string,
): Promise<void> {
  const schedules = await schedulerManager.listSchedules();
  const schedule = schedules.find(s => s.id === scheduleId);
  if (!schedule) {
    jsonResponse(res, { error: 'Not found' }, 404);
    return;
  }
  jsonResponse(res, { schedule });
}

async function handlePatchSchedule(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  scheduleId: string,
): Promise<void> {
  const body = await readBody(req) as {
    cron?: string;
    message?: string;
    label?: string;
    enabled?: boolean;
    projectKey?: string;
  };
  try {
    const updated = await schedulerManager.updateSchedule(scheduleId, {
      ...(body.cron !== undefined ? { cron: body.cron } : {}),
      ...(body.message !== undefined ? { message: body.message } : {}),
      ...(body.label !== undefined ? { label: String(body.label).slice(0, 100) } : {}),
      ...(body.enabled !== undefined ? { enabled: Boolean(body.enabled) } : {}),
      ...(body.projectKey !== undefined ? { projectKey: body.projectKey } : {}),
    });
    if (!updated) {
      jsonResponse(res, { error: 'Not found' }, 404);
      return;
    }
    jsonResponse(res, { schedule: updated });
  } catch (err) {
    jsonResponse(res, { error: (err as Error).message }, 400);
  }
}

async function handleDeleteSchedule(
  res: http.ServerResponse,
  scheduleId: string,
): Promise<void> {
  const deleted = await schedulerManager.deleteSchedule(scheduleId);
  if (!deleted) {
    jsonResponse(res, { error: 'Not found' }, 404);
    return;
  }
  jsonResponse(res, { success: true });
}

// ── HTTP server ──────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  // CORS for localhost
  res.setHeader('Access-Control-Allow-Origin', '127.0.0.1');

  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);
  const pathname = url.pathname;
  const method = req.method?.toUpperCase() ?? 'GET';

  // OPTIONS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    // ── Health ──
    if (pathname === '/health' && method === 'GET') {
      handleHealth(res);
      return;
    }

    // ── Agent Chat ──
    if (pathname === '/agent-chat/start' && method === 'POST') {
      await handleStart(req, res);
      return;
    }
    if (pathname === '/agent-chat/stop' && method === 'POST') {
      await handleStop(req, res);
      return;
    }
    if (pathname === '/agent-chat/guest' && method === 'POST') {
      await handleGuest(req, res);
      return;
    }
    if (pathname === '/agent-chat/stream' && method === 'GET') {
      handleStream(req, res, url);
      return;
    }
    if (pathname === '/agent-chat/status' && method === 'GET') {
      handleStatus(res, url);
      return;
    }
    if (pathname === '/agent-chat/clear' && method === 'POST') {
      await handleClear(req, res);
      return;
    }
    if (pathname === '/agent-chat/update-config' && method === 'POST') {
      await handleUpdateConfig(req, res);
      return;
    }

    // ── Schedules ──
    const scheduleMatch = pathname.match(/^\/schedules\/([^/]+)$/);

    if (pathname === '/schedules' && method === 'GET') {
      await handleListSchedules(res);
      return;
    }
    if (pathname === '/schedules' && method === 'POST') {
      await handleCreateSchedule(req, res);
      return;
    }
    if (scheduleMatch && method === 'GET') {
      await handleGetSchedule(res, scheduleMatch[1]);
      return;
    }
    if (scheduleMatch && method === 'PATCH') {
      await handlePatchSchedule(req, res, scheduleMatch[1]);
      return;
    }
    if (scheduleMatch && method === 'DELETE') {
      await handleDeleteSchedule(res, scheduleMatch[1]);
      return;
    }

    notFound(res);
  } catch (err) {
    console.error('[Sidecar] Unhandled error:', err);
    try {
      jsonResponse(res, { error: 'Internal server error' }, 500);
    } catch { /* response already sent */ }
  }
});

// ── Startup ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Write lock file so sidecar-bridge can find this process
  writeLock();

  // Graceful shutdown
  const shutdown = (): void => {
    console.log('[Sidecar] Shutting down...');
    removeLock();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  process.on('exit', removeLock);

  // Initialize scheduler (reads schedules from disk, registers cron jobs)
  try {
    await schedulerManager.init();
  } catch (err) {
    console.error('[Sidecar] SchedulerManager init failed:', err);
  }

  // Start HTTP server
  await new Promise<void>((resolve, reject) => {
    server.listen(PORT, '127.0.0.1', () => resolve());
    server.on('error', reject);
  });

  console.log(`[Sidecar] Listening on http://127.0.0.1:${PORT} (pid=${process.pid})`);
}

main().catch((err) => {
  console.error('[Sidecar] Fatal startup error:', err);
  removeLock();
  process.exit(1);
});
