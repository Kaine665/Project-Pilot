/**
 * sidecar-bridge.ts — Next.js 与 Agent Sidecar 进程的通信桥。
 *
 * 三个核心导出：
 *   ensureSidecar()   — 检查 sidecar 是否运行；未运行则 spawn 新进程（detached）
 *   sidecarFetch()    — 向 sidecar 发 HTTP 请求（JSON）
 *   proxySidecarSSE() — 将 sidecar 的 SSE 流代理给浏览器客户端
 *
 * 工作流：
 *   1. 读取当前 worktree 对应的 sidecar lock 获取 {pid, port}
 *   2. 用 GET /health 验证 sidecar 存活
 *   3. 若不存在/不存活 → spawn detached 进程 → 等待健康检查通过
 *   4. 缓存 port，后续请求直接使用
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { resolveSidecarConfigSync } from './sidecar-config';

// ── 常量 ─────────────────────────────────────────────────────────────────────

const LOCK_DIR = path.join(os.homedir(), '.project-pilot');
const SIDECAR_CONFIG = resolveSidecarConfigSync();
const LOCK_PATH = SIDECAR_CONFIG.lockPath;
const DEFAULT_PORT = SIDECAR_CONFIG.port;
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
let _lastSpawnFailure = 0;
const SPAWN_COOLDOWN_MS = 30_000; // spawn 失败后 30 秒内不重试

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

  // 开发环境：Next.js 编译后 __dirname 指向 .next/server/...，不能用。
  // 使用 process.cwd()（项目根目录）确保路径正确。
  return path.join(process.cwd(), 'src', 'sidecar', 'server.ts');
}

function resolveNodeExecutable(): string {
  // 优先使用当前 Node 进程的可执行文件路径
  return process.execPath;
}

function spawnSidecar(port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const script = resolveSidecarScript();
    const isProd = !script.endsWith('.ts');

    // Windows 下 node_modules/.bin/ 里是 .cmd 文件，需要用 shell:true 或直接调用 node + tsx 包入口。
    // 最可靠的方式：始终用当前 node 可执行文件，开发时加载 tsx/dist/esm/bin.mjs 作为 loader。
    let executable: string;
    let args: string[];

    if (isProd) {
      executable = resolveNodeExecutable();
      args = [script];
    } else {
      // 用 node 直接执行 tsx 的入口脚本（跨平台，避免 .cmd 问题）
      const tsxEntry = (() => {
        // tsx bin 入口（优先 cli.mjs，兼容不同版本）
        const candidates = [
          path.join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs'),
          path.join(process.cwd(), 'node_modules', 'tsx', 'dist', 'esm', 'index.cjs'),
          path.join(process.cwd(), 'node_modules', 'tsx', 'dist', 'esm', 'bin.mjs'),
        ];
        for (const c of candidates) {
          if (fs.existsSync(c)) return c;
        }
        // fallback: 直接用 .cmd 但开 shell（只在 Windows 生效）
        return null;
      })();

      if (tsxEntry) {
        executable = resolveNodeExecutable();
        args = [tsxEntry, script];
      } else {
        // shell:true fallback — 对 .cmd 文件有效
        const tsxCmd = path.join(process.cwd(), 'node_modules', '.bin',
          process.platform === 'win32' ? 'tsx.cmd' : 'tsx');
        executable = tsxCmd;
        args = [script];
      }
    }

    const useShell = !isProd && executable.endsWith('.cmd');

    // 将 sidecar 的 stdout/stderr 写入日志文件，方便排查启动失败
    const logDir = LOCK_DIR;
    fs.mkdirSync(logDir, { recursive: true });
    const logFd = fs.openSync(path.join(logDir, 'sidecar.log'), 'a');

    // Windows 上 detached:true 会弹出控制台窗口，但 Windows 子进程本身就独立于父进程，
    // 父进程退出后子进程不会被杀掉，所以不需要 detached。
    // Unix 上需要 detached:true 创建新 session，确保子进程不随父进程组被 kill。
    const isWin = process.platform === 'win32';

    const child = spawn(executable, args, {
      detached: !isWin,
      stdio: ['ignore', logFd, logFd],
      shell: useShell,
      windowsHide: true,
      env: {
        ...process.env,
        SIDECAR_PORT: String(port),
        SIDECAR_LOCK_PATH: LOCK_PATH,
        NODE_ENV: process.env.NODE_ENV ?? 'development',
      },
      cwd: process.cwd(),
    });

    // spawn 后关闭父进程持有的 fd，不影响子进程继续写入
    fs.closeSync(logFd);

    child.unref(); // 父进程不等待 sidecar 退出

    // 追踪子进程是否已退出（端口冲突/启动崩溃时快速失败，无需等足 10 秒）
    let childExited = false;
    let childExitCode: number | null = null;

    child.on('error', (err) => {
      reject(new Error(`Failed to spawn sidecar: ${err.message}`));
    });

    child.on('close', (code) => {
      childExited = true;
      childExitCode = code;
    });

    // 轮询 /health 直到 sidecar 就绪
    const deadline = Date.now() + HEALTH_TIMEOUT_MS;
    const poll = async (): Promise<void> => {
      // 子进程已退出（如 EADDRINUSE 导致启动崩溃），立即失败，无需等到超时
      if (childExited) {
        reject(new Error(
          `Sidecar process exited unexpectedly (code=${childExitCode ?? 'null'}). ` +
          `Port ${port} may already be in use. Check ~/.project-pilot/sidecar.log for details.`
        ));
        return;
      }
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

  // 冷却期内不重试 spawn，直接抛出
  if (_lastSpawnFailure && Date.now() - _lastSpawnFailure < SPAWN_COOLDOWN_MS) {
    throw new Error('Sidecar recently failed to start, waiting before retry');
  }

  const port = lock?.port ?? DEFAULT_PORT;

  _spawning = spawnSidecar(port).then((p) => {
    _cachedPort = p;
    _lastSpawnFailure = 0;
    _spawning = null;
    return p;
  }).catch((err) => {
    _lastSpawnFailure = Date.now();
    _spawning = null;
    throw err;
  });

  return _spawning;
}

/**
 * 向 sidecar 发送 HTTP 请求，返回原始 Response。
 * 调用方可以 `.json()` 或 `.text()` 处理响应。
 */
const SIDECAR_FETCH_TIMEOUT_MS = 30_000; // sidecar 无响应时的最大等待时间

export async function sidecarFetch(
  pathname: string,
  init?: RequestInit,
): Promise<Response> {
  const port = await ensureSidecar();
  const url = `http://127.0.0.1:${port}${pathname}`;
  return fetch(url, {
    ...init,
    signal: AbortSignal.timeout(SIDECAR_FETCH_TIMEOUT_MS),
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
