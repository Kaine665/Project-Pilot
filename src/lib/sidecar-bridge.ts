/**
 * sidecar-bridge.ts — Next.js 与 Agent Sidecar 进程的通信桥。
 *
 * 三个核心导出：
 *   ensureSidecar()   — 检查 sidecar 是否运行；未运行则 spawn 新进程（detached）
 *   sidecarFetch()    — 向 sidecar 发 HTTP 请求（JSON）
 *   proxySidecarSSE() — 将 sidecar 的 SSE 流代理给浏览器客户端
 *
 * 工作流：
 *   1. 读取 ~/.project-pilot/sidecar.lock 获取 {pid, port}
 *   2. 用 GET /health 验证 sidecar 存活
 *   3. 若不存在/不存活 → spawn detached 进程 → 等待健康检查通过
 *   4. 缓存 port，后续请求直接使用
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

// ── 常量 ─────────────────────────────────────────────────────────────────────

const LOCK_DIR = path.join(os.homedir(), '.project-pilot');
const LOCK_PATH = path.join(LOCK_DIR, 'sidecar.lock');
const DEFAULT_PORT = 4500;
const HEALTH_TIMEOUT_MS = 10_000;   // 等待新 sidecar 启动最长 10 秒
const HEALTH_POLL_MS = 200;          // 每 200ms 轮询一次 /health

// ── Lock file 格式 ────────────────────────────────────────────────────────────

interface SidecarLock {
  pid: number;
  port: number;
}

// ── 内部状态（模块级缓存，在 Next.js 进程生命周期内有效） ──────────────────────

let _cachedPort: number | null = null;
let _spawning: Promise<number> | null = null;

// ── 内部辅助 ─────────────────────────────────────────────────────────────────

function readLock(): SidecarLock | null {
  try {
    const raw = fs.readFileSync(LOCK_PATH, 'utf8');
    const parsed = JSON.parse(raw) as SidecarLock;
    if (typeof parsed.port === 'number' && typeof parsed.pid === 'number') {
      return parsed;
    }
  } catch { /* file missing or malformed */ }
  return null;
}

async function pingHealth(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function resolveSidecarScript(): string {
  // 生产：electron/dist/sidecar.js（与 main.js 同目录）
  // 开发：src/sidecar/server.ts（用 tsx 运行）
  const p = process as NodeJS.Process & { resourcesPath?: string };
  if (p.resourcesPath) {
    // Electron 打包环境
    return path.join(path.dirname(process.execPath), 'resources', 'sidecar.js');
  }

  // 开发/standalone 环境：相对于本文件（src/lib/sidecar-bridge.ts → src/sidecar/server.ts）
  return path.join(__dirname, '..', 'sidecar', 'server.ts');
}

function resolveNodeExecutable(): string {
  // 优先使用当前 Node 进程的可执行文件路径
  return process.execPath;
}

function spawnSidecar(port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const script = resolveSidecarScript();
    const isProd = !script.endsWith('.ts');

    // 开发模式：用 tsx 运行 .ts 文件（tsx 在 PATH 中或 node_modules/.bin）
    // 生产模式：用 node 运行编译后的 .js 文件
    const executable = isProd
      ? resolveNodeExecutable()
      : (() => {
          const tsxBin = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');
          return tsxBin;
        })();

    const args = isProd ? [script] : [script];

    const child = spawn(executable, args, {
      detached: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        SIDECAR_PORT: String(port),
        NODE_ENV: process.env.NODE_ENV ?? 'development',
      },
      cwd: process.cwd(),
    });

    child.unref(); // 父进程不等待 sidecar 退出

    child.on('error', (err) => {
      reject(new Error(`Failed to spawn sidecar: ${err.message}`));
    });

    // 轮询 /health 直到 sidecar 就绪
    const deadline = Date.now() + HEALTH_TIMEOUT_MS;
    const poll = async (): Promise<void> => {
      if (await pingHealth(port)) {
        resolve(port);
        return;
      }
      if (Date.now() >= deadline) {
        reject(new Error(`Sidecar did not become healthy within ${HEALTH_TIMEOUT_MS}ms`));
        return;
      }
      setTimeout(() => void poll(), HEALTH_POLL_MS);
    };

    // 稍等一下再开始轮询（给进程一点启动时间）
    setTimeout(() => void poll(), 300);
  });
}

// ── 公共 API ─────────────────────────────────────────────────────────────────

/**
 * 确保 sidecar 正在运行，返回其端口号。
 *
 * - 读 lock file → /health 检查 → 若存活直接返回端口
 * - 否则 spawn 新进程（detached），等待启动完成
 * - 并发调用时共享同一个 spawn Promise，避免重复启动
 */
export async function ensureSidecar(): Promise<number> {
  // 优先使用缓存的端口（同一 Next.js 进程内多次调用）
  if (_cachedPort !== null) {
    if (await pingHealth(_cachedPort)) return _cachedPort;
    _cachedPort = null;
  }

  // 读 lock file 检查已有 sidecar
  const lock = readLock();
  if (lock) {
    if (await pingHealth(lock.port)) {
      _cachedPort = lock.port;
      return lock.port;
    }
  }

  // 需要启动新 sidecar
  if (_spawning) return _spawning;

  const port = lock?.port ?? DEFAULT_PORT;

  _spawning = spawnSidecar(port).then((p) => {
    _cachedPort = p;
    _spawning = null;
    return p;
  }).catch((err) => {
    _spawning = null;
    throw err;
  });

  return _spawning;
}

/**
 * 向 sidecar 发送 HTTP 请求，返回原始 Response。
 * 调用方可以 `.json()` 或 `.text()` 处理响应。
 */
export async function sidecarFetch(
  pathname: string,
  init?: RequestInit,
): Promise<Response> {
  const port = await ensureSidecar();
  const url = `http://127.0.0.1:${port}${pathname}`;
  return fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
}

/**
 * 将 sidecar 的 SSE 流代理给浏览器客户端。
 * 返回一个可直接 return 给 Next.js API route handler 的 Response。
 */
export async function proxySidecarSSE(pathname: string): Promise<Response> {
  const port = await ensureSidecar();
  const url = `http://127.0.0.1:${port}${pathname}`;

  const upstream = await fetch(url, {
    headers: { Accept: 'text/event-stream' },
  });

  if (!upstream.ok || !upstream.body) {
    return new Response(
      `data: ${JSON.stringify({ type: 'error', message: 'Sidecar stream unavailable' })}\n\n`,
      {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          'Connection': 'keep-alive',
        },
      },
    );
  }

  return new Response(upstream.body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
