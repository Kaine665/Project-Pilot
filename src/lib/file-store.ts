/**
 * JSON 文件读写工具（简化版，无文件锁）
 * ProjectPilot 数据存储在用户目录：
 * - Windows: C:\Users\<username>\.project-pilot\data\
 * - macOS: /Users/<username>/.project-pilot/data/
 * - Linux: /home/<username>/.project-pilot/data/
 *
 * 可通过环境变量 PROJECT_PILOT_DATA_DIR 自定义位置
 */

import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

/**
 * Strip UTF-8 BOM (byte order mark) and parse JSON.
 * Some editors (Notepad, VS Code in rare cases) prepend BOM to files,
 * causing JSON.parse to fail with "Unexpected token".
 */
export function parseJsonSafe<T>(raw: string): T {
  const cleaned = raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw;
  return JSON.parse(cleaned);
}

// 默认存到用户目录的隐藏文件夹
const DEFAULT_DATA_DIR = path.join(os.homedir(), '.project-pilot', 'data');

// 支持环境变量自定义（用于测试或特殊部署场景）
const DATA_DIR = process.env.PROJECT_PILOT_DATA_DIR || DEFAULT_DATA_DIR;

export function getDataDir(): string {
  return DATA_DIR;
}

export function getProjectsPath(): string {
  return path.join(DATA_DIR, 'projects.json');
}

export function getFlowsDir(): string {
  return path.join(DATA_DIR, 'flows');
}

export function getFlowIndexPath(): string {
  return path.join(DATA_DIR, 'flows', '_index.json');
}

export function getFlowDataPath(projectKey: string): string {
  const safe = projectKey.replace(/[^a-zA-Z0-9_-]/g, '');

  // 🔒 Security: prevent empty filename or invalid project keys
  if (!safe || safe.length < 1 || safe.length > 100) {
    throw new Error(`Invalid project key: ${projectKey}`);
  }

  return path.join(DATA_DIR, 'flows', `${safe}.json`);
}

/** 旧版 flow 数据目录（源码内） */
const LEGACY_FLOWS_DIR = path.join(process.cwd(), 'src', 'data', 'flows');

let _flowsMigrated = false;

/**
 * 懒迁移：如果用户目录没有 flows 数据但源码目录有，自动复制过去。
 * 仅在首次调用时执行，后续调用直接返回。
 */
export async function ensureFlowsMigrated(): Promise<void> {
  if (_flowsMigrated) return;
  _flowsMigrated = true;

  const destDir = getFlowsDir();
  const destIndex = getFlowIndexPath();

  try {
    await fs.stat(destIndex);
    // 目标已存在，无需迁移
    return;
  } catch {
    // 目标不存在，继续迁移
  }

  const srcIndex = path.join(LEGACY_FLOWS_DIR, '_index.json');
  try {
    await fs.stat(srcIndex);
  } catch {
    // 源也不存在，首次使用，创建空索引
    await fs.mkdir(destDir, { recursive: true });
    await fs.writeFile(destIndex, JSON.stringify({ projects: [] }, null, 2), 'utf-8');
    return;
  }

  // 复制所有 flow 文件
  await fs.mkdir(destDir, { recursive: true });
  const files = await fs.readdir(LEGACY_FLOWS_DIR);
  for (const file of files) {
    if (file.endsWith('.json')) {
      const src = path.join(LEGACY_FLOWS_DIR, file);
      const dest = path.join(destDir, file);
      await fs.copyFile(src, dest);
    }
  }
}


export function getSettingsPath(): string {
  return path.join(DATA_DIR, 'settings.json');
}

export function getAgentsPath(): string {
  return path.join(DATA_DIR, 'agents.json');
}

export function getDimensionsPath(): string {
  return path.join(DATA_DIR, 'dimensions.json');
}

export function getAgentChatSessionsPath(): string {
  return path.join(DATA_DIR, 'agent-chat-sessions.json');
}

export function getWorktreePortsPath(): string {
  return path.join(DATA_DIR, 'worktree-ports.json');
}

export function getTodosPath(): string {
  return path.join(DATA_DIR, 'todos.json');
}

export function getOrchestratorSessionsPath(): string {
  return path.join(DATA_DIR, 'orchestrator-sessions.json');
}

export function getAgentTeamsPath(): string {
  return path.join(DATA_DIR, 'agent-teams.json');
}

/** 编排会话的跨 Worker 消息文件（JSONL 格式，追加写） */
export function getOrchestratorMessagesPath(orchId: string): string {
  const safeId = orchId.replace(/[^a-zA-Z0-9_-]/g, '');
  return path.join(DATA_DIR, 'orchestrations', `${safeId}-messages.jsonl`);
}

export function getActiveTasksPath(): string {
  return path.join(DATA_DIR, 'active-tasks.json');
}

export function getSuspendedTasksPath(): string {
  return path.join(DATA_DIR, 'suspended-tasks.json');
}

// ── Prompt 文件路径函数 ──

export function getPromptsDir(): string {
  return path.join(DATA_DIR, 'prompts');
}

export function getPromptFilePath(agentId: string): string {
  const safe = agentId.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safe || safe.length < 1 || safe.length > 100) {
    throw new Error(`Invalid agent id: ${agentId}`);
  }
  return path.join(DATA_DIR, 'prompts', `${safe}.md`);
}

export function getPromptHistoryDir(agentId: string): string {
  const safe = agentId.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safe || safe.length < 1 || safe.length > 100) {
    throw new Error(`Invalid agent id: ${agentId}`);
  }
  return path.join(DATA_DIR, 'prompts', `${safe}.history`);
}

export function getPromptRuntimeDir(agentId: string): string {
  const safe = agentId.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safe || safe.length < 1 || safe.length > 100) {
    throw new Error(`Invalid agent id: ${agentId}`);
  }
  return path.join(DATA_DIR, 'prompts', `${safe}.runtime`);
}

export function getPromptRuntimePath(agentId: string, sessionId: string): string {
  const safeAgent = agentId.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safeAgent || safeAgent.length < 1 || safeAgent.length > 100) {
    throw new Error(`Invalid agent id: ${agentId}`);
  }
  const safeSession = sessionId.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safeSession || safeSession.length < 1 || safeSession.length > 200) {
    throw new Error(`Invalid session id: ${sessionId}`);
  }
  return path.join(DATA_DIR, 'prompts', `${safeAgent}.runtime`, `${safeSession}.md`);
}

export function getGlobalPromptPath(): string {
  return path.join(DATA_DIR, 'prompts', '_global.md');
}

export function getProjectPromptsDir(): string {
  return path.join(DATA_DIR, 'project-prompts');
}

export function getProjectPromptPath(projectKey: string): string {
  const safe = projectKey.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safe || safe.length < 1 || safe.length > 100) {
    throw new Error(`Invalid project key: ${projectKey}`);
  }
  return path.join(DATA_DIR, 'project-prompts', `${safe}.md`);
}

// ── Context 路径函数 ──
// 索引 + 内容文件分离设计（详见 docs/context-system.md）：
//   index.json  → 元数据，注入 agent prompt（buildContextSection）
//   {fileName}  → 内容，agent 通过 bash cat 按需读取
// getContextFilePath 的 path.basename 安全检查不可移除 — 防路径穿越

export function getContextDir(): string {
  return path.join(DATA_DIR, 'context');
}

export function getContextIndexPath(): string {
  return path.join(DATA_DIR, 'context', 'index.json');
}

export function getContextFilePath(fileName: string): string {
  // 🔒 Security: prevent path traversal — fileName must be flat (no directory separators)
  const safe = path.basename(fileName);
  if (!safe || safe !== fileName || safe.includes('..')) {
    throw new Error(`Invalid context file name: ${fileName}`);
  }
  return path.join(DATA_DIR, 'context', safe);
}

// ── Design Docs 路径函数 ──
// 索引 + Markdown 文件分离：
//   _index.json  → 按项目分组的元数据
//   {docId}.md   → 文档正文
// getDesignDocFilePath 的 path.basename 安全检查不可移除 — 防路径穿越

export function getDesignDocsDir(): string {
  return path.join(DATA_DIR, 'design-docs');
}

export function getDesignDocsIndexPath(): string {
  return path.join(DATA_DIR, 'design-docs', '_index.json');
}

export function getDesignDocFilePath(fileName: string): string {
  const safe = path.basename(fileName);
  if (!safe || safe !== fileName || safe.includes('..')) {
    throw new Error(`Invalid doc file name: ${fileName}`);
  }
  return path.join(DATA_DIR, 'design-docs', safe);
}

// 🔒 Security: Maximum JSON file size to prevent DoS attacks
const MAX_JSON_SIZE = 50 * 1024 * 1024; // 50MB

/**
 * 读取 JSON 文件，文件不存在时返回 defaultValue
 *
 * 🔒 安全特性：
 * - 文件大小限制（50MB）防止内存耗尽攻击
 * - 自动处理文件不存在和 JSON 解析错误
 */
export async function readJsonFile<T>(filePath: string, defaultValue: T): Promise<T> {
  try {
    // 🔒 Security: check file size before reading to prevent DoS
    const stats = await fs.stat(filePath);
    if (stats.size > MAX_JSON_SIZE) {
      throw new Error(`File too large: ${stats.size} bytes (max ${MAX_JSON_SIZE})`);
    }

    const content = await fs.readFile(filePath, 'utf-8');
    return parseJsonSafe<T>(content);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // File not found or empty/corrupt JSON → return default
    if (code === 'ENOENT' || error instanceof SyntaxError) {
      return defaultValue;
    }
    throw error;
  }
}

// ── 写入前自动快照 ──
// 关键数据文件在每次写入前自动保存旧版本到 _snapshots/，保留最近 MAX_SNAPSHOTS 份

const SNAPSHOT_DIR = path.join(DATA_DIR, '_snapshots');
const MAX_SNAPSHOTS = 10;

/** 需要做写入前快照的文件（basename） */
const SNAPSHOT_TARGETS = new Set(['agents.json', 'agent-chat-sessions.json']);

function snapshotBeforeWrite(filePath: string): void {
  const baseName = path.basename(filePath);
  if (!SNAPSHOT_TARGETS.has(baseName)) return;

  // Fire-and-forget：快照在后台执行，不阻塞写入路径
  void (async () => {
    try {
      await fs.stat(filePath); // 文件不存在则跳过
    } catch {
      return;
    }

    try {
      await fs.mkdir(SNAPSHOT_DIR, { recursive: true });
      const stem = baseName.replace('.json', '');
      const dest = path.join(SNAPSHOT_DIR, `${stem}_${Date.now()}.json`);
      await fs.copyFile(filePath, dest);

      // 清理超出上限的旧快照
      const files = (await fs.readdir(SNAPSHOT_DIR))
        .filter(f => f.startsWith(`${stem}_`) && f.endsWith('.json'))
        .sort(); // 时间戳排序，最旧在前
      if (files.length > MAX_SNAPSHOTS) {
        for (const old of files.slice(0, files.length - MAX_SNAPSHOTS)) {
          await fs.unlink(path.join(SNAPSHOT_DIR, old)).catch(() => {});
        }
      }
    } catch {
      // 快照失败不阻塞正常写入
    }
  })();
}

/**
 * Windows 兼容的 rename：EPERM/EACCES 时自动重试（线性退避）。
 * Unix 上 rename 是原子操作不受影响；Windows 上目标文件被占用（读取/杀毒扫描）时
 * rename 会失败，短暂等待后重试即可成功。
 */
async function renameWithRetry(src: string, dest: string, retries = 5): Promise<void> {
  for (let i = 0; i < retries; i++) {
    try {
      await fs.rename(src, dest);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if ((code === 'EPERM' || code === 'EACCES') && i < retries - 1) {
        await new Promise(r => setTimeout(r, 20 * (i + 1)));
        continue;
      }
      throw err;
    }
  }
}

/**
 * 写入 JSON 文件，自动创建目录
 * 对关键文件（agents.json）会在写入前自动保存快照
 *
 * 使用原子写入（write-to-tmp + rename）防止进程中断导致文件损坏。
 */
export async function writeJsonFile(filePath: string, data: unknown): Promise<void> {
  snapshotBeforeWrite(filePath);
  const dirPath = path.dirname(filePath);
  await fs.mkdir(dirPath, { recursive: true });
  const content = JSON.stringify(data, null, 2);
  const tmpPath = filePath + `.tmp_${Date.now()}`;
  await fs.writeFile(tmpPath, content, 'utf-8');
  await renameWithRetry(tmpPath, filePath);
}

// ── 进程内写队列 ──
// 同一文件的 modifyJsonFile 调用在进程内串行化，防止并发 async 操作竞态丢数据
const writeQueues = new Map<string, Promise<unknown>>();

/**
 * 原子读-改-写操作（进程内串行化）
 *
 * 🔒 安全特性：
 * - 进程内同一文件写操作自动排队，防止并发竞态
 * - 读取时检查文件大小限制（50MB）
 * - 写入前验证序列化后的大小
 * - 写入前自动快照关键文件（agents.json、agent-chat-sessions.json）
 * - 使用原子写入（write-to-tmp + rename）防止进程中断导致文件损坏
 */
export async function modifyJsonFile<T>(
  filePath: string,
  defaultValue: T,
  modifier: (data: T) => T,
): Promise<T> {
  const prev = writeQueues.get(filePath) ?? Promise.resolve();
  const next = prev.then(
    () => _modifyJsonFileImpl(filePath, defaultValue, modifier),
    () => _modifyJsonFileImpl(filePath, defaultValue, modifier),
  );
  writeQueues.set(filePath, next.catch(() => {}));
  return next;
}

async function _modifyJsonFileImpl<T>(
  filePath: string,
  defaultValue: T,
  modifier: (data: T) => T,
): Promise<T> {
  const dirPath = path.dirname(filePath);
  await fs.mkdir(dirPath, { recursive: true });

  let data: T;
  try {
    // 🔒 Security: check file size before reading
    const stats = await fs.stat(filePath);
    if (stats.size > MAX_JSON_SIZE) {
      throw new Error(`File too large: ${stats.size} bytes (max ${MAX_JSON_SIZE})`);
    }

    const content = await fs.readFile(filePath, 'utf-8');
    data = parseJsonSafe<T>(content);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // File not found → use default, but re-throw size errors
    if (code === 'ENOENT') {
      data = defaultValue;
    } else if (error instanceof Error && error.message.includes('too large')) {
      throw error;
    } else {
      data = defaultValue;
    }
  }

  const modified = modifier(data);

  // 🔒 Security: check serialized size before writing
  const serialized = JSON.stringify(modified, null, 2);
  if (Buffer.byteLength(serialized, 'utf-8') > MAX_JSON_SIZE) {
    throw new Error(`Output JSON too large (max ${MAX_JSON_SIZE} bytes)`);
  }

  // 写入前快照（fire-and-forget）+ 原子写入
  snapshotBeforeWrite(filePath);
  const tmpPath = filePath + `.tmp_${Date.now()}`;
  await fs.writeFile(tmpPath, serialized, 'utf-8');
  await renameWithRetry(tmpPath, filePath);
  return modified;
}

// ── Inbox 路径函数 ──

export function getInboxPath(projectKey: string): string {
  const safe = projectKey.replace(/[^a-zA-Z0-9_-]/g, '');

  // 🔒 Security: prevent empty filename or invalid project keys
  if (!safe || safe.length < 1 || safe.length > 100) {
    throw new Error(`Invalid project key: ${projectKey}`);
  }

  return path.join(DATA_DIR, 'flows', `${safe}_inbox.json`);
}

/** 读取项目收件箱数据，不存在时返回空列表 */
export async function readInbox(projectKey: string): Promise<import('@/types').ProjectInbox> {
  return readJsonFile<import('@/types').ProjectInbox>(getInboxPath(projectKey), { items: [] });
}

/** 写入项目收件箱数据（原子写入） */
export async function writeInbox(projectKey: string, data: import('@/types').ProjectInbox): Promise<void> {
  await writeJsonFile(getInboxPath(projectKey), data);
}

/**
 * 通知数据已变更（供 MCP Server 写入后触发 UI 刷新）
 */
export async function notifyDataChanged(): Promise<void> {
  const notifyPath = path.join(DATA_DIR, '.notify');
  await fs.writeFile(notifyPath, Date.now().toString(), 'utf-8');
}
