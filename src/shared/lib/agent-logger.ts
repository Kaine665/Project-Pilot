/**
 * agent-logger.ts — 开发者向的 Agent 交互日志（SDK 输入 / 输出 / 工具调用 / 错误 / 用量）。
 *
 * 设计原则（和业务逻辑严格解耦）：
 *
 *   1. **默认关闭**。生产打包态零开销：`isEnabled()` 直接返回 false，
 *      所有 `log*()` 入口在第一行就 short-circuit，不做任何序列化、不访问对象字段。
 *   2. **永不抛异常**。整条 logger 路径用 `try/catch` 兜底；
 *      任何错误都吞掉（最多 `console.warn` 一次提示），业务永远拿不到 logger 的异常。
 *   3. **异步落盘**。基于内存队列 + 后台 flush 定时器；业务线程只 enqueue 一个浅拷贝过的小对象，
 *      `JSON.stringify` / 文件写入都发生在 flush 阶段。
 *   4. **截断 + 体量字段**。长文本只保留前 N 字符 + 总长度，避免日志变成「另一份对话存档」。
 *   5. **滚动 + 上限**。按日期切文件，目录下按文件数和总大小做最简清理；
 *      磁盘出问题时丢日志、不丢业务。
 *   6. **不进入产品 UI、不进入用户数据备份**。日志位置固定在 `~/.project-pilot/logs/`，
 *      由数据导出 / 同步路径显式排除（如未来引入备份功能）。
 *
 * 启用方式（开发者）：
 *   - `PP_AGENT_LOG=info` （默认 off）：记录 turn 起止 + 工具调用 + 错误。
 *   - `PP_AGENT_LOG=debug`：另外记录每条 SDK message 的类型与小预览。
 *   - `PP_AGENT_LOG=trace`：debug 之上再放宽截断阈值。
 *
 * 仅以 NDJSON 写入磁盘，不污染 stdout（那里已经有 `console.*`，避免重复）。
 */

import { promises as fsp, createWriteStream, mkdirSync, existsSync, type WriteStream } from 'fs';
import path from 'path';
import os from 'os';

// ── Levels & Config ──────────────────────────────────────────────────────────

export type AgentLogLevel = 'off' | 'error' | 'info' | 'debug' | 'trace';

const LEVEL_ORDER: Record<AgentLogLevel, number> = {
  off: 0,
  error: 1,
  info: 2,
  debug: 3,
  trace: 4,
};

interface LoggerConfig {
  level: AgentLogLevel;
  dir: string;
  /** 单条输入/输出/工具参数最大保留字符数；超过部分截断并附 `_truncated` 标记 */
  maxFieldChars: number;
  /** 单文件大小上限（字节），超过后切到下一个文件 */
  maxFileBytes: number;
  /** 目录下保留多少天的日志（按文件名日期清理） */
  retentionDays: number;
  /** 队列上限；超过则丢日志、累计 dropped 计数 */
  maxQueueSize: number;
  /** flush 周期（毫秒） */
  flushIntervalMs: number;
}

function readLevelEnv(): AgentLogLevel {
  const raw = (process.env.PP_AGENT_LOG ?? '').trim().toLowerCase();
  if (!raw) return 'off';
  if (raw === 'off' || raw === '0' || raw === 'false') return 'off';
  if (raw === 'error') return 'error';
  if (raw === 'info' || raw === 'on' || raw === '1' || raw === 'true') return 'info';
  if (raw === 'debug') return 'debug';
  if (raw === 'trace' || raw === 'verbose') return 'trace';
  return 'off';
}

function readNumberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function resolveLogDir(): string {
  const root = process.env.PROJECT_PILOT_DATA_DIR || path.join(os.homedir(), '.project-pilot');
  return path.join(root, 'logs');
}

const CONFIG: LoggerConfig = {
  level: readLevelEnv(),
  dir: resolveLogDir(),
  maxFieldChars: readNumberEnv('PP_AGENT_LOG_MAX_CHARS', readLevelEnv() === 'trace' ? 8000 : 2000),
  maxFileBytes: readNumberEnv('PP_AGENT_LOG_MAX_FILE_BYTES', 10 * 1024 * 1024),
  retentionDays: readNumberEnv('PP_AGENT_LOG_RETENTION_DAYS', 7),
  maxQueueSize: readNumberEnv('PP_AGENT_LOG_QUEUE_SIZE', 5000),
  flushIntervalMs: readNumberEnv('PP_AGENT_LOG_FLUSH_MS', 200),
};

export function isEnabled(level: AgentLogLevel = 'info'): boolean {
  return LEVEL_ORDER[CONFIG.level] >= LEVEL_ORDER[level];
}

export function getAgentLoggerConfig(): Readonly<LoggerConfig> {
  return CONFIG;
}

// ── Truncation helpers ───────────────────────────────────────────────────────

interface TruncatedString {
  text: string;
  length: number;
  truncated: boolean;
}

function truncate(value: unknown, max: number = CONFIG.maxFieldChars): TruncatedString {
  if (value == null) return { text: '', length: 0, truncated: false };
  let str: string;
  try {
    str = typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    str = '[unserializable]';
  }
  if (str.length <= max) {
    return { text: str, length: str.length, truncated: false };
  }
  return { text: str.slice(0, max), length: str.length, truncated: true };
}

/**
 * 简单的 token 估算（粗：4 字符 ≈ 1 token，仅在 SDK 没给 usage 时作参考）。
 * 不要用来计费。
 */
export function roughTokenEstimate(text: string | undefined | null): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

// ── Async queue + writer ─────────────────────────────────────────────────────

interface LogRecord {
  ts: string;
  kind: string;
  [key: string]: unknown;
}

let queue: LogRecord[] = [];
let dropped = 0;
let flushTimer: NodeJS.Timeout | null = null;
let currentStream: WriteStream | null = null;
let currentFilePath: string | null = null;
let currentFileBytes = 0;
let dirEnsured = false;
let writerWarned = false;
let retentionRanAt = 0;

function ensureDirSync(): boolean {
  if (dirEnsured) return true;
  try {
    mkdirSync(CONFIG.dir, { recursive: true });
    dirEnsured = true;
    return true;
  } catch (e) {
    if (!writerWarned) {
      writerWarned = true;
      // 只 warn 一次，避免刷屏；不影响业务
      // eslint-disable-next-line no-console
      console.warn('[agent-logger] mkdir failed, agent logs disabled:', (e as Error).message);
    }
    return false;
  }
}

function todayStamp(): string {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function expectedFilePath(): string {
  return path.join(CONFIG.dir, `agent-${todayStamp()}.ndjson`);
}

function rotateIfNeeded(): void {
  const expected = expectedFilePath();
  if (currentStream && currentFilePath === expected && currentFileBytes < CONFIG.maxFileBytes) {
    return;
  }
  // 关闭旧 stream；如果同一天但超大，加序号轮转
  if (currentStream) {
    try { currentStream.end(); } catch { /* ignore */ }
    currentStream = null;
  }

  let target = expected;
  if (currentFilePath === expected && currentFileBytes >= CONFIG.maxFileBytes) {
    let i = 1;
    while (true) {
      const candidate = path.join(CONFIG.dir, `agent-${todayStamp()}.${i}.ndjson`);
      try {
        if (!existsSync(candidate)) {
          target = candidate;
          break;
        }
      } catch {
        target = candidate;
        break;
      }
      i++;
      if (i > 999) { target = candidate; break; }
    }
  }

  try {
    currentStream = createWriteStream(target, { flags: 'a' });
    currentStream.on('error', (e) => {
      if (!writerWarned) {
        writerWarned = true;
        // eslint-disable-next-line no-console
        console.warn('[agent-logger] write stream error, future logs may be dropped:', e.message);
      }
    });
    currentFilePath = target;
    currentFileBytes = 0;
  } catch (e) {
    if (!writerWarned) {
      writerWarned = true;
      // eslint-disable-next-line no-console
      console.warn('[agent-logger] open log file failed:', (e as Error).message);
    }
    currentStream = null;
    currentFilePath = null;
  }
}

async function pruneOldLogs(): Promise<void> {
  const now = Date.now();
  // 一小时内只跑一次
  if (now - retentionRanAt < 60 * 60 * 1000) return;
  retentionRanAt = now;
  try {
    const entries = await fsp.readdir(CONFIG.dir);
    const cutoff = now - CONFIG.retentionDays * 24 * 60 * 60 * 1000;
    await Promise.all(
      entries
        .filter((name) => name.startsWith('agent-') && name.endsWith('.ndjson'))
        .map(async (name) => {
          const full = path.join(CONFIG.dir, name);
          try {
            const stat = await fsp.stat(full);
            if (stat.mtimeMs < cutoff) await fsp.unlink(full);
          } catch { /* ignore single-file failures */ }
        }),
    );
  } catch { /* ignore */ }
}

function flushNow(): void {
  if (queue.length === 0) return;
  if (!ensureDirSync()) {
    // 目录建不出来，丢弃
    queue = [];
    return;
  }
  rotateIfNeeded();
  if (!currentStream) {
    queue = [];
    return;
  }

  const batch = queue;
  queue = [];
  // 批量写一次，减少 I/O 调用
  const lines: string[] = [];
  for (const rec of batch) {
    try {
      lines.push(JSON.stringify(rec));
    } catch {
      // 极端情况下序列化失败：写一条最小记录
      lines.push(JSON.stringify({ ts: rec.ts, kind: rec.kind, _serializeError: true }));
    }
  }
  const payload = lines.join('\n') + '\n';
  try {
    currentStream.write(payload);
    currentFileBytes += Buffer.byteLength(payload, 'utf8');
  } catch (e) {
    if (!writerWarned) {
      writerWarned = true;
      // eslint-disable-next-line no-console
      console.warn('[agent-logger] write failed:', (e as Error).message);
    }
  }

  // 异步触发清理；失败也不要紧
  void pruneOldLogs();
}

function ensureFlushTimer(): void {
  if (flushTimer) return;
  flushTimer = setInterval(() => {
    try {
      flushNow();
    } catch { /* swallow */ }
  }, CONFIG.flushIntervalMs);
  // 不阻止进程退出
  if (typeof flushTimer.unref === 'function') flushTimer.unref();
}

function enqueue(record: LogRecord): void {
  if (queue.length >= CONFIG.maxQueueSize) {
    dropped++;
    // 每丢 1000 条提示一次，避免静默
    if (dropped % 1000 === 1) {
      // eslint-disable-next-line no-console
      console.warn(`[agent-logger] queue full, dropped=${dropped}`);
    }
    return;
  }
  queue.push(record);
  ensureFlushTimer();
}

// ── Public API: structured events ────────────────────────────────────────────

export interface TurnContext {
  /** 业务会话 ID（AgentChatManager 内部）。和 Claude/Codex 的 SDK session 不一定相同。 */
  sessionId: string;
  /** PP 内的 Agent ID（不是 SDK 的） */
  agentId?: string;
  /** AgentChatManager 内 runId（一次调用），用于把同一轮的多条记录串起来 */
  runId?: string;
  provider?: string;
  model?: string;
  /** 是否为 resume 模式 */
  resume?: boolean;
  resumeSessionId?: string;
}

export interface TurnStartFields extends TurnContext {
  promptText: string;
  /** 多模态附件简要 */
  images?: Array<{ mediaType: string; bytes: number }>;
  /** SDK 可见的关键 options 摘要（脱敏后） */
  sdkOptionsSummary?: Record<string, unknown>;
}

export interface TurnEndFields extends TurnContext {
  durationMs: number;
  ok: boolean;
  aborted?: boolean;
  /** 完整 assistant 文本（会按规则截断） */
  assistantText?: string;
  /** SDK 提供的 token 用量（若有） */
  inputTokens?: number;
  outputTokens?: number;
  contextWindow?: number;
  /** 模型本轮消息条数（SDK message count），便于和 promptLen 一起估算流量 */
  sdkMessageCount?: number;
  /** error 信息（仅类型 + 截断后的消息） */
  errorMessage?: string;
}

export interface ToolUseFields extends TurnContext {
  phase: 'start' | 'end';
  toolId: string;
  toolName: string;
  /** 仅在 phase === 'start' 出现 */
  inputJson?: string;
  /** 仅在 phase === 'end' 出现 */
  output?: string;
  status?: 'completed' | 'failed';
}

export interface SdkMessageFields extends TurnContext {
  msgIndex: number;
  msgType: string;
  /** debug 级以上才会带：尝试拿一段可读的小预览 */
  preview?: string;
}

function withMeta<T extends Record<string, unknown>>(kind: string, fields: T): LogRecord {
  return {
    ts: new Date().toISOString(),
    kind,
    pid: process.pid,
    ...fields,
  };
}

/** 安全地包一层 try/catch，logger 永远不抛 */
function safe(fn: () => void): void {
  try { fn(); } catch (e) {
    // logger 自己出错只 warn 一次
    if (!writerWarned) {
      writerWarned = true;
      // eslint-disable-next-line no-console
      console.warn('[agent-logger] internal error:', (e as Error)?.message);
    }
  }
}

export function logTurnStart(fields: TurnStartFields): void {
  if (!isEnabled('info')) return;
  safe(() => {
    const promptT = truncate(fields.promptText);
    enqueue(withMeta('agent.turn.start', {
      sessionId: fields.sessionId,
      agentId: fields.agentId,
      runId: fields.runId,
      provider: fields.provider,
      model: fields.model,
      resume: fields.resume,
      resumeSessionId: fields.resumeSessionId,
      prompt: {
        preview: promptT.text,
        length: promptT.length,
        truncated: promptT.truncated,
        roughInputTokens: roughTokenEstimate(fields.promptText),
      },
      images: fields.images,
      sdkOptions: fields.sdkOptionsSummary,
    }));
  });
}

export function logTurnEnd(fields: TurnEndFields): void {
  if (!isEnabled('info')) return;
  safe(() => {
    const out = fields.assistantText ? truncate(fields.assistantText) : undefined;
    enqueue(withMeta('agent.turn.end', {
      sessionId: fields.sessionId,
      agentId: fields.agentId,
      runId: fields.runId,
      provider: fields.provider,
      model: fields.model,
      durationMs: fields.durationMs,
      ok: fields.ok,
      aborted: fields.aborted,
      assistant: out
        ? { preview: out.text, length: out.length, truncated: out.truncated, roughOutputTokens: roughTokenEstimate(fields.assistantText) }
        : undefined,
      usage: (fields.inputTokens != null || fields.outputTokens != null)
        ? { inputTokens: fields.inputTokens, outputTokens: fields.outputTokens, contextWindow: fields.contextWindow }
        : undefined,
      sdkMessageCount: fields.sdkMessageCount,
      errorMessage: fields.errorMessage ? truncate(fields.errorMessage, 1000).text : undefined,
    }));
    // turn.end 之后立刻 flush 一次，便于实时观察
    flushNow();
  });
}

export function logToolUse(fields: ToolUseFields): void {
  if (!isEnabled('info')) return;
  safe(() => {
    const inputT = fields.inputJson ? truncate(fields.inputJson) : undefined;
    const outputT = fields.output ? truncate(fields.output) : undefined;
    enqueue(withMeta('agent.tool', {
      sessionId: fields.sessionId,
      runId: fields.runId,
      phase: fields.phase,
      toolId: fields.toolId,
      toolName: fields.toolName,
      input: inputT ? { preview: inputT.text, length: inputT.length, truncated: inputT.truncated } : undefined,
      output: outputT ? { preview: outputT.text, length: outputT.length, truncated: outputT.truncated } : undefined,
      status: fields.status,
    }));
  });
}

export function logSdkMessage(fields: SdkMessageFields): void {
  if (!isEnabled('debug')) return;
  safe(() => {
    enqueue(withMeta('agent.sdk.msg', {
      sessionId: fields.sessionId,
      runId: fields.runId,
      msgIndex: fields.msgIndex,
      msgType: fields.msgType,
      preview: fields.preview ? truncate(fields.preview, 500).text : undefined,
    }));
  });
}

/**
 * 强制 flush（用于测试或手动触发）。生产路径不要依赖。
 */
export function flushAgentLog(): void {
  safe(flushNow);
}

/**
 * 仅供测试 / 调试：返回当前日志文件路径（可能为 null）。
 */
export function currentLogFilePath(): string | null {
  return currentFilePath;
}
