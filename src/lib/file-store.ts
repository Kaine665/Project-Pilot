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
  return path.join(DATA_DIR, 'workflows', 'flows');
}

export function getFlowIndexPath(): string {
  return path.join(DATA_DIR, 'workflows', 'flows', '_index.json');
}

export function getFlowDataPath(projectKey: string): string {
  const safe = projectKey.replace(/[^a-zA-Z0-9_-]/g, '');

  // 🔒 Security: prevent empty filename or invalid project keys
  if (!safe || safe.length < 1 || safe.length > 100) {
    throw new Error(`Invalid project key: ${projectKey}`);
  }

  return path.join(DATA_DIR, 'workflows', 'flows', `${safe}.json`);
}

/** 旧版 flow 数据目录（源码内） */
const LEGACY_FLOWS_DIR = path.join(process.cwd(), 'src', 'data', 'flows');

let _flowsMigrated = false;

/**
 * 首次启动时创建所有数据子目录。
 * 幂等操作，仅在 ensureFlowsMigrated() 首次调用时执行。
 */
async function ensureDataDirInitialized(): Promise<void> {
  const dirs = [
    // agents/
    path.join(DATA_DIR, 'agents'),
    getAgentDataDir(),
    // chat/
    path.join(DATA_DIR, 'chat'),
    getAgentChatMessagesDir(),
    getAgentChatSessionAdjunctsDir(),
    // tasks/
    path.join(DATA_DIR, 'tasks'),
    // prompts/
    path.join(DATA_DIR, 'prompts', 'agents'),
    path.join(DATA_DIR, 'prompts', 'history'),
    path.join(DATA_DIR, 'prompts', 'runtime'),
    path.join(DATA_DIR, 'prompts', 'blocks'),
    getProjectPromptsDir(),
    // knowledge/
    getContextDir(),
    getDesignDocsDir(),
    // dialogues/
    getDialoguesDir(),
    // workflows/
    getFlowsDir(),
    // storage/
    getSkillsDir(),
    // usage/
    path.join(DATA_DIR, 'usage'),
    // top-level
    path.join(DATA_DIR, '_snapshots'),
  ];
  await Promise.all(dirs.map(d => fs.mkdir(d, { recursive: true })));
}

/**
 * 懒迁移：如果用户目录没有 flows 数据但源码目录有，自动复制过去。
 * 仅在首次调用时执行，后续调用直接返回。
 * 同时确保所有数据子目录已创建。
 */
export async function ensureFlowsMigrated(): Promise<void> {
  if (_flowsMigrated) return;
  _flowsMigrated = true;

  // 确保所有数据子目录存在
  await ensureDataDirInitialized();

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


// ── projects.json → _index.json 迁移 ──
// 将旧版 projects.json 的字段合并到 flows/_index.json 中

let _projectsMigrated = false;

/**
 * 将 projects.json 中的 ProjectConfig 数据合并到 flows/_index.json 的 ProjectEntry 中。
 * 仅执行一次：检查 _index.json 中是否已有 `_migrated_projects_v2` 标记。
 */
export async function ensureProjectsMigrated(): Promise<void> {
  if (_projectsMigrated) return;
  _projectsMigrated = true;

  // 确保 flows 迁移先执行
  await ensureFlowsMigrated();

  const indexPath = getFlowIndexPath();
  const projectsPath = getProjectsPath();

  // 读取当前索引
  const index = await readJsonFile<import('@/types').ProjectIndex>(indexPath, { projects: [] });

  // 检查是否已迁移过（用 _migrated 标记字段）
  if ((index as unknown as Record<string, unknown>)._migrated_projects_v2) return;

  // 读取旧版 projects.json
  let oldProjects: Record<string, import('@/types').ProjectConfig> = {};
  try {
    const data = await readJsonFile<import('@/types').ProjectsData>(projectsPath, { projects: {} });
    oldProjects = data.projects;
  } catch {
    // 旧文件不存在或读取失败，跳过
  }

  if (Object.keys(oldProjects).length === 0) {
    // 没有旧数据，仅标记已迁移
    await writeJsonFile(indexPath, { ...index, _migrated_projects_v2: true });
    return;
  }

  for (const [key, config] of Object.entries(oldProjects)) {
    const existing = index.projects.find(p => p.key === key);
    if (existing) {
      // 已存在的项目：补充缺失字段
      if (!existing.path && config.path) existing.path = config.path;
      if (!existing.techStack && config.type) existing.techStack = config.type as import('@/types').ProjectTechStack;
      if (!existing.description && config.description) existing.description = config.description;
      if (!existing.location) existing.location = 'local';
      if (config.defaultBranch && !existing.repository?.defaultBranch) {
        existing.repository = { ...existing.repository, defaultBranch: config.defaultBranch };
      }
      if ((config.webCommand || config.webUrl) && !existing.devServer) {
        existing.devServer = {
          ...(config.webCommand && { command: config.webCommand }),
          ...(config.webUrl && { url: config.webUrl }),
        };
      }
    } else {
      // 新项目：从旧系统迁移过来
      const entry: import('@/types').ProjectEntry = {
        key,
        name: config.name,
        path: config.path,
        location: 'local',
        techStack: config.type as import('@/types').ProjectTechStack,
        ...(config.description && { description: config.description }),
        ...(config.defaultBranch && { repository: { defaultBranch: config.defaultBranch } }),
        ...((config.webCommand || config.webUrl) && {
          devServer: {
            ...(config.webCommand && { command: config.webCommand }),
            ...(config.webUrl && { url: config.webUrl }),
          },
        }),
        createdAt: new Date().toISOString(),
      };
      index.projects.push(entry);
    }
  }

  // 标记已迁移并写入
  await writeJsonFile(indexPath, { ...index, _migrated_projects_v2: true });
}

// ── V2 目录结构迁移 ──
// 将扁平的 data/ 目录结构重组为按领域分组的层级结构。
// 使用两阶段提交：先复制到新位置，写标记，再删旧文件。

const V2_MIGRATION_MARKER = path.join(DATA_DIR, '_migration_v2_complete');
let _v2Migrated = false;

/**
 * V2 目录结构迁移。
 *
 * 策略：
 * 1. 检查标记文件 → 已迁移则跳过
 * 2. Phase A：复制所有旧路径文件/目录到新路径（幂等）
 * 3. Phase B：写标记文件
 * 4. Phase C：删除旧文件（best-effort）
 *
 * 对 prompts/.runtime/ 目录，旧结构是 prompts/{agentId}.runtime/，
 * 新结构是 prompts/runtime/{agentId}/。
 */
export async function ensureDataDirV2Migrated(): Promise<void> {
  if (_v2Migrated) return;
  _v2Migrated = true;

  // 先确保 V1 迁移完成
  await ensureProjectsMigrated();

  // 检查是否已迁移
  try {
    await fs.stat(V2_MIGRATION_MARKER);
    return; // 已迁移
  } catch {
    // 未迁移，继续
  }

  // 检查是否存在旧结构（用 agents.json 作为标志）
  const oldAgentsJson = path.join(DATA_DIR, 'agents.json');
  try {
    await fs.stat(oldAgentsJson);
  } catch {
    // 旧结构也不存在 → 全新安装，直接标记完成
    await fs.writeFile(V2_MIGRATION_MARKER, new Date().toISOString(), 'utf-8');
    return;
  }

  console.log('[migration-v2] 开始数据目录 V2 迁移...');

  // ── Phase A：复制到新位置 ──

  // JSON 文件映射：旧路径 → 新路径
  const jsonMoves: [string, string][] = [
    // agents/
    [path.join(DATA_DIR, 'agents.json'), getAgentsPath()],
    [path.join(DATA_DIR, 'agent-schedules.json'), getSchedulesPath()],
    [path.join(DATA_DIR, 'agent-schedule-runs.json'), getScheduleRunsPath()],
    // chat/
    [path.join(DATA_DIR, 'agent-chat-sessions.json'), getAgentChatSessionsPath()],
    // tasks/
    [path.join(DATA_DIR, 'active-tasks.json'), getActiveTasksPath()],
    [path.join(DATA_DIR, 'suspended-tasks.json'), getSuspendedTasksPath()],
    [path.join(DATA_DIR, 'todos.json'), getTodosPath()],
    [path.join(DATA_DIR, 'satellite-tasks-config.json'), path.join(DATA_DIR, 'tasks', 'satellite-config.json')],
    // workflows/
    [path.join(DATA_DIR, 'worktree-ports.json'), getWorktreePortsPath()],
    // prompts/
    [path.join(DATA_DIR, 'prompts', '_global.md'), getGlobalPromptPath()],
  ];

  // 目录映射：旧目录 → 新目录（整体搬移）
  const dirMoves: [string, string][] = [
    // agents/
    [path.join(DATA_DIR, 'agent-data'), getAgentDataDir()],
    [path.join(DATA_DIR, 'agent-library'), path.join(DATA_DIR, 'agents', 'library')],
    // chat/
    [path.join(DATA_DIR, 'agent-chat-messages'), getAgentChatMessagesDir()],
    // tasks/
    [path.join(DATA_DIR, 'task-artifacts'), path.join(DATA_DIR, 'tasks', 'artifacts')],
    [path.join(DATA_DIR, 'satellite-task-runs'), path.join(DATA_DIR, 'tasks', 'satellite-runs')],
    // knowledge/
    [path.join(DATA_DIR, 'context'), getContextDir()],
    [path.join(DATA_DIR, 'design-docs'), getDesignDocsDir()],
    [path.join(DATA_DIR, 'docs'), path.join(DATA_DIR, 'knowledge', 'docs')],
    [path.join(DATA_DIR, 'fundraising'), path.join(DATA_DIR, 'knowledge', 'fundraising')],
    // workflows/
    [path.join(DATA_DIR, 'flows'), getFlowsDir()],
    // storage/
    [path.join(DATA_DIR, 'artifacts'), path.join(DATA_DIR, 'storage', 'artifacts')],
    [path.join(DATA_DIR, 'skills'), getSkillsDir()],
    // project-prompts → prompts/projects
    [path.join(DATA_DIR, 'project-prompts'), getProjectPromptsDir()],
  ];

  // 复制 JSON 文件
  for (const [src, dest] of jsonMoves) {
    await _migrateCopyFile(src, dest);
  }

  // 复制目录
  for (const [src, dest] of dirMoves) {
    await _migrateCopyDir(src, dest);
  }

  // 特殊处理：prompt 模板文件（prompts/{agentId}.md → prompts/agents/{agentId}.md）
  try {
    const promptsRoot = path.join(DATA_DIR, 'prompts');
    const entries = await fs.readdir(promptsRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.md') && entry.name !== '_global.md' && entry.name !== 'global.md') {
        const src = path.join(promptsRoot, entry.name);
        const dest = path.join(DATA_DIR, 'prompts', 'agents', entry.name);
        await _migrateCopyFile(src, dest);
      }
    }
  } catch { /* prompts dir may not exist */ }

  // 特殊处理：prompt history（prompts/{agentId}.history/ → prompts/history/{agentId}/）
  try {
    const promptsRoot = path.join(DATA_DIR, 'prompts');
    const entries = await fs.readdir(promptsRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.endsWith('.history')) {
        const agentId = entry.name.replace(/\.history$/, '');
        const src = path.join(promptsRoot, entry.name);
        const dest = path.join(DATA_DIR, 'prompts', 'history', agentId);
        await _migrateCopyDir(src, dest);
      }
    }
  } catch { /* ok */ }

  // 特殊处理：prompt runtime（prompts/{agentId}.runtime/ → prompts/runtime/{agentId}/）
  try {
    const promptsRoot = path.join(DATA_DIR, 'prompts');
    const entries = await fs.readdir(promptsRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.endsWith('.runtime')) {
        const agentId = entry.name.replace(/\.runtime$/, '');
        const src = path.join(promptsRoot, entry.name);
        const dest = path.join(DATA_DIR, 'prompts', 'runtime', agentId);
        await _migrateCopyDir(src, dest);
      }
    }
  } catch { /* ok */ }

  // ── Phase B：写标记文件 ──
  await fs.writeFile(V2_MIGRATION_MARKER, new Date().toISOString(), 'utf-8');
  console.log('[migration-v2] 标记文件已写入');

  // ── Phase C：删除旧文件（best-effort）──
  for (const [src] of jsonMoves) {
    await fs.unlink(src).catch(() => {});
  }
  for (const [src, dest] of dirMoves) {
    // 只删除旧目录和新目录不同的情况
    if (src !== dest) {
      await fs.rm(src, { recursive: true, force: true }).catch(() => {});
    }
  }
  // 删除旧的 prompt 模板文件（已搬到 prompts/agents/）
  try {
    const promptsRoot = path.join(DATA_DIR, 'prompts');
    const entries = await fs.readdir(promptsRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'global.md') {
        // 只删除根级的，不删子目录里的
        await fs.unlink(path.join(promptsRoot, entry.name)).catch(() => {});
      }
      if (entry.isDirectory() && (entry.name.endsWith('.history') || entry.name.endsWith('.runtime'))) {
        await fs.rm(path.join(promptsRoot, entry.name), { recursive: true, force: true }).catch(() => {});
      }
    }
  } catch { /* ok */ }

  console.log('[migration-v2] 数据目录 V2 迁移完成');
}

/**
 * 复制单个文件（幂等 + 竞态安全）。
 *
 * 当目标已存在时，比较源和目标文件大小：
 * - 如果源文件更大，说明目标可能是 store 自动生成的默认文件（竞态产物），用源文件覆盖
 * - 如果目标文件 >= 源文件，说明目标已包含完整数据，跳过
 *
 * 这解决了「store 初始化创建默认文件 → 迁移跳过复制 → 旧数据丢失」的竞态条件。
 */
async function _migrateCopyFile(src: string, dest: string): Promise<void> {
  let srcStat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    srcStat = await fs.stat(src);
  } catch {
    return; // 源不存在，跳过
  }

  try {
    const destStat = await fs.stat(dest);
    // 目标已存在 — 比较大小决定是否覆盖
    if (srcStat.size > destStat.size) {
      console.warn(
        `[migration-v2] 目标文件已存在但比源文件小 (src=${srcStat.size}B, dest=${destStat.size}B)，` +
        `可能是竞态产物，用源文件覆盖: ${path.basename(src)}`,
      );
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.copyFile(src, dest);
    }
    return;
  } catch {
    // 目标不存在，继续复制
  }

  try {
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(src, dest);
  } catch (err) {
    console.warn(`[migration-v2] 复制文件失败: ${src} → ${dest}`, (err as Error).message);
  }
}

/** 递归复制目录（幂等：逐文件复制，已存在的跳过） */
async function _migrateCopyDir(src: string, dest: string): Promise<void> {
  try {
    await fs.stat(src);
  } catch {
    return; // 源不存在，跳过
  }
  // 如果新旧路径相同，跳过
  if (path.resolve(src) === path.resolve(dest)) return;

  try {
    await fs.mkdir(dest, { recursive: true });
    const entries = await fs.readdir(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        await _migrateCopyDir(srcPath, destPath);
      } else {
        // 只在目标不存在时复制
        try {
          await fs.stat(destPath);
        } catch {
          await fs.copyFile(srcPath, destPath);
        }
      }
    }
  } catch (err) {
    console.warn(`[migration-v2] 复制目录失败: ${src} → ${dest}`, (err as Error).message);
  }
}

export function getSettingsPath(): string {
  return path.join(DATA_DIR, 'settings.json');
}

export function getAgentsPath(): string {
  return path.join(DATA_DIR, 'agents', 'registry.json');
}

export function getDimensionsPath(): string {
  return path.join(DATA_DIR, 'dimensions.json');
}

export function getAgentChatSessionsPath(): string {
  return path.join(DATA_DIR, 'chat', 'sessions.json');
}

export function getAgentChatSessionAdjunctsDir(): string {
  return path.join(DATA_DIR, 'chat', 'adjuncts');
}

export function getAgentChatSessionAdjunctsPath(): string {
  return path.join(getAgentChatSessionAdjunctsDir(), 'sessions.json');
}

/** 每个会话的消息 JSONL 文件目录 */
export function getAgentChatMessagesDir(): string {
  return path.join(DATA_DIR, 'chat', 'messages');
}

/** 单个会话的消息 JSONL 文件路径 */
export function getAgentChatMessagePath(sessionId: string): string {
  const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safe || safe.length < 1 || safe.length > 200) {
    throw new Error(`Invalid session id: ${sessionId}`);
  }
  return path.join(DATA_DIR, 'chat', 'messages', `${safe}.jsonl`);
}

export function getWorktreePortsPath(): string {
  return path.join(DATA_DIR, 'workflows', 'worktree-ports.json');
}

export function getTodosPath(): string {
  return path.join(DATA_DIR, 'tasks', 'todos.json');
}

export function getActiveTasksPath(): string {
  return path.join(DATA_DIR, 'tasks', 'active.json');
}

export function getSuspendedTasksPath(): string {
  return path.join(DATA_DIR, 'tasks', 'suspended.json');
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
  return path.join(DATA_DIR, 'prompts', 'agents', `${safe}.md`);
}

export function getPromptHistoryDir(agentId: string): string {
  const safe = agentId.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safe || safe.length < 1 || safe.length > 100) {
    throw new Error(`Invalid agent id: ${agentId}`);
  }
  return path.join(DATA_DIR, 'prompts', 'history', safe);
}

export function getPromptRuntimeDir(agentId: string): string {
  const safe = agentId.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safe || safe.length < 1 || safe.length > 100) {
    throw new Error(`Invalid agent id: ${agentId}`);
  }
  return path.join(DATA_DIR, 'prompts', 'runtime', safe);
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
  return path.join(DATA_DIR, 'prompts', 'runtime', safeAgent, `${safeSession}.md`);
}

export function getGlobalPromptPath(): string {
  return path.join(DATA_DIR, 'prompts', 'global.md');
}

export function getProjectPromptsDir(): string {
  return path.join(DATA_DIR, 'prompts', 'projects');
}

export function getProjectPromptPath(projectKey: string): string {
  const safe = projectKey.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safe || safe.length < 1 || safe.length > 100) {
    throw new Error(`Invalid project key: ${projectKey}`);
  }
  return path.join(DATA_DIR, 'prompts', 'projects', `${safe}.md`);
}

// ── Segmented Prompt 路径函数 ──
// 每个 prompt (global / project) 可拆分为 segments 目录：
//   {base}.d/_index.json  → 元数据索引
//   {base}.d/{segmentId}.md  → 各段内容
// 若 .d/ 目录不存在，则 fallback 到单 .md 文件

import type { PromptSegmentScope } from '@/types';

/** 根据 scope 获取 segments 目录路径 */
export function getSegmentedPromptDir(scope: PromptSegmentScope): string {
  switch (scope.type) {
    case 'global':
      return path.join(DATA_DIR, 'prompts', 'global.d');
    case 'project': {
      const safe = scope.projectKey.replace(/[^a-zA-Z0-9_-]/g, '');
      if (!safe || safe.length < 1 || safe.length > 100) {
        throw new Error(`Invalid project key: ${scope.projectKey}`);
      }
      return path.join(DATA_DIR, 'prompts', 'projects', `${safe}.d`);
    }
  }
}

/** 获取 segments 目录下的 _index.json 路径 */
export function getSegmentedPromptIndexPath(scope: PromptSegmentScope): string {
  return path.join(getSegmentedPromptDir(scope), '_index.json');
}

/** 获取单个 segment 的 .md 文件路径 */
export function getSegmentFilePath(scope: PromptSegmentScope, segmentId: string): string {
  const safe = segmentId.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safe || safe.length < 1 || safe.length > 100) {
    throw new Error(`Invalid segment id: ${segmentId}`);
  }
  return path.join(getSegmentedPromptDir(scope), `${safe}.md`);
}

// ── Prompt Block 路径函数 ──

export function getPromptBlocksDir(): string {
  return path.join(DATA_DIR, 'prompts', 'blocks');
}

export function getPromptBlockPath(blockId: string): string {
  const safe = blockId.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safe || safe.length < 1 || safe.length > 100) {
    throw new Error(`Invalid prompt block id: ${blockId}`);
  }
  return path.join(DATA_DIR, 'prompts', 'blocks', `${safe}.md`);
}

// ── Context 路径函数 ──
// 索引 + 内容文件分离设计（详见 docs/context-system.md）：
//   index.json  → 元数据，注入 agent prompt（buildContextSection）
//   {fileName}  → 内容，agent 通过 bash cat 按需读取
// getContextFilePath 的 path.basename 安全检查不可移除 — 防路径穿越

export function getContextDir(): string {
  return path.join(DATA_DIR, 'knowledge', 'context');
}

export function getContextIndexPath(): string {
  return path.join(DATA_DIR, 'knowledge', 'context', 'index.json');
}

export function getContextFilePath(fileName: string): string {
  // 🔒 Security: prevent path traversal — fileName must be flat (no directory separators)
  const safe = path.basename(fileName);
  if (!safe || safe !== fileName || safe.includes('..')) {
    throw new Error(`Invalid context file name: ${fileName}`);
  }
  return path.join(DATA_DIR, 'knowledge', 'context', safe);
}

// ── Design Docs 路径函数 ──
// 索引 + Markdown 文件分离：
//   _index.json  → 按项目分组的元数据
//   {docId}.md   → 文档正文
// getDesignDocFilePath 的 path.basename 安全检查不可移除 — 防路径穿越

export function getDesignDocsDir(): string {
  return path.join(DATA_DIR, 'knowledge', 'design-docs');
}

export function getDesignDocsIndexPath(): string {
  return path.join(DATA_DIR, 'knowledge', 'design-docs', '_index.json');
}

export function getDesignDocFilePath(fileName: string): string {
  const safe = path.basename(fileName);
  if (!safe || safe !== fileName || safe.includes('..')) {
    throw new Error(`Invalid doc file name: ${fileName}`);
  }
  return path.join(DATA_DIR, 'knowledge', 'design-docs', safe);
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

/**
 * 需要做写入前快照的文件 → 语义名映射。
 * key = 完整路径（运行时计算），value = 快照前缀名。
 * 使用语义名而非 basename，避免嵌套路径改名后命名冲突。
 */
function getSnapshotTargets(): Map<string, string> {
  return new Map([
    [getAgentsPath(), 'agents-registry'],
    [getAgentChatSessionsPath(), 'chat-sessions'],
    [getAgentChatSessionAdjunctsPath(), 'chat-session-adjuncts'],
  ]);
}

function snapshotBeforeWrite(filePath: string): void {
  const targets = getSnapshotTargets();
  const stem = targets.get(filePath);
  if (!stem) return;

  // Fire-and-forget：快照在后台执行，不阻塞写入路径
  void (async () => {
    try {
      await fs.stat(filePath); // 文件不存在则跳过
    } catch {
      return;
    }

    try {
      await fs.mkdir(SNAPSHOT_DIR, { recursive: true });
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
async function renameWithRetry(src: string, dest: string, retries = 8): Promise<void> {
  for (let i = 0; i < retries; i++) {
    try {
      await fs.rename(src, dest);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if ((code === 'EPERM' || code === 'EACCES') && i < retries - 1) {
        // Exponential backoff: 50, 100, 200, 400, 800, 1600, 3200ms
        await new Promise(r => setTimeout(r, 50 * Math.pow(2, i)));
        continue;
      }
      // All rename retries exhausted — fallback to copyFile + unlink.
      // Non-atomic but preserves data (better than losing writes entirely).
      if (code === 'EPERM' || code === 'EACCES') {
        try {
          await fs.copyFile(src, dest);
          await fs.unlink(src).catch(() => {}); // best-effort cleanup
          return;
        } catch {
          // copyFile also failed — re-throw original rename error
        }
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
  // Read with retry — transient EPERM/EACCES on Windows (antivirus, other process writing)
  const READ_RETRIES = 4;
  for (let attempt = 0; ; attempt++) {
    try {
      // 🔒 Security: check file size before reading
      const stats = await fs.stat(filePath);
      if (stats.size > MAX_JSON_SIZE) {
        throw new Error(`File too large: ${stats.size} bytes (max ${MAX_JSON_SIZE})`);
      }

      const content = await fs.readFile(filePath, 'utf-8');
      data = parseJsonSafe<T>(content);
      break;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      // File not found → use default
      if (code === 'ENOENT') {
        data = defaultValue;
        break;
      }
      // Transient file lock errors → retry with backoff
      if ((code === 'EPERM' || code === 'EACCES') && attempt < READ_RETRIES - 1) {
        await new Promise(r => setTimeout(r, 50 * Math.pow(2, attempt)));
        continue;
      }
      // All other errors or retries exhausted → throw to prevent data loss.
      // Previously, these errors silently used defaultValue and then wrote it
      // back, wiping all existing data.
      throw error;
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

// ── Skills 路径函数 ──

/** Skill 作用域级别 */
export type SkillScopeLevel = 'global' | 'project' | 'agent';

/** Skill 作用域定义 */
export type SkillScope =
  | { level: 'global' }
  | { level: 'project'; projectKey: string }
  | { level: 'agent'; agentId: string };

/** 默认作用域（向后兼容） */
export const DEFAULT_SKILL_SCOPE: SkillScope = { level: 'global' };

function sanitizeSkillName(name: string): string {
  const safe = name.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safe || safe.length < 1 || safe.length > 100) {
    throw new Error(`Invalid skill name: ${name}`);
  }
  return safe;
}

function sanitizeId(id: string): string {
  const safe = id.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safe || safe.length < 1 || safe.length > 200) {
    throw new Error(`Invalid id: ${id}`);
  }
  return safe;
}

/** skills 根目录 */
export function getSkillsDir(): string {
  return path.join(DATA_DIR, 'storage', 'skills');
}

/** 根据 scope 获取 skills 所在目录 */
export function getScopedSkillsDir(scope: SkillScope): string {
  const base = getSkillsDir();
  switch (scope.level) {
    case 'global':
      return path.join(base, '_global');
    case 'project':
      return path.join(base, '_projects', sanitizeId(scope.projectKey));
    case 'agent':
      return path.join(base, '_agents', sanitizeId(scope.agentId));
  }
}

export function getSkillFilePath(skillName: string, scope: SkillScope = DEFAULT_SKILL_SCOPE): string {
  return path.join(getScopedSkillsDir(scope), sanitizeSkillName(skillName), 'SKILL.md');
}

export function getSkillHistoryDir(skillName: string, scope: SkillScope = DEFAULT_SKILL_SCOPE): string {
  return path.join(getScopedSkillsDir(scope), sanitizeSkillName(skillName), '.history');
}

/** Skill 目录根路径 */
export function getSkillDir(skillName: string, scope: SkillScope = DEFAULT_SKILL_SCOPE): string {
  return path.join(getScopedSkillsDir(scope), sanitizeSkillName(skillName));
}

/** Skill 子目录中允许的文件夹名 */
export const SKILL_SUBDIRS = ['scripts', 'references', 'assets'] as const;
export type SkillSubdir = (typeof SKILL_SUBDIRS)[number];

// ── Agent Data Store 路径函数 ──
// 每个 Agent 的私有数据目录：agents/data/{agentId}/
// Agent 通过 bash 自由读写，danger-detector 对此目录白名单放行

export function getAgentDataDir(): string {
  return path.join(DATA_DIR, 'agents', 'data');
}

export function getAgentDataPath(agentId: string): string {
  const safe = agentId.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safe || safe.length < 1 || safe.length > 100) {
    throw new Error(`Invalid agent id: ${agentId}`);
  }
  return path.join(DATA_DIR, 'agents', 'data', safe);
}

export function getAgentDataFilePath(agentId: string, fileName: string): string {
  const safe = agentId.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safe || safe.length < 1 || safe.length > 100) {
    throw new Error(`Invalid agent id: ${agentId}`);
  }
  // 🔒 Security: prevent path traversal
  const safeFile = path.basename(fileName);
  if (!safeFile || safeFile !== fileName || safeFile.includes('..')) {
    throw new Error(`Invalid file name: ${fileName}`);
  }
  return path.join(DATA_DIR, 'agents', 'data', safe, safeFile);
}

// ── Inbox 路径函数 ──

export function getInboxPath(projectKey: string): string {
  const safe = projectKey.replace(/[^a-zA-Z0-9_-]/g, '');

  // 🔒 Security: prevent empty filename or invalid project keys
  if (!safe || safe.length < 1 || safe.length > 100) {
    throw new Error(`Invalid project key: ${projectKey}`);
  }

  return path.join(DATA_DIR, 'workflows', 'flows', `${safe}_inbox.json`);
}

/** 读取项目收件箱数据，不存在时返回空列表 */
export async function readInbox(projectKey: string): Promise<import('@/types').ProjectInbox> {
  return readJsonFile<import('@/types').ProjectInbox>(getInboxPath(projectKey), { items: [] });
}

/** 写入项目收件箱数据（原子写入） */
export async function writeInbox(projectKey: string, data: import('@/types').ProjectInbox): Promise<void> {
  await writeJsonFile(getInboxPath(projectKey), data);
}

// ── Agent Dialogues 路径函数 ──

export function getDialoguesDir(): string {
  return path.join(DATA_DIR, 'dialogues');
}

export function getDialoguesIndexPath(): string {
  return path.join(DATA_DIR, 'dialogues', '_index.json');
}

export function getDialoguePath(dialogueId: string): string {
  const safe = dialogueId.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safe || safe.length > 100) {
    throw new Error(`Invalid dialogue ID: ${dialogueId}`);
  }
  return path.join(DATA_DIR, 'dialogues', `${safe}.json`);
}

// ── Agent Schedules 路径函数 ──

export function getSchedulesPath(): string {
  return path.join(DATA_DIR, 'agents', 'schedules.json');
}

export function getScheduleRunsPath(): string {
  return path.join(DATA_DIR, 'agents', 'schedule-runs.json');
}

export function getEventTriggersPath(): string {
  return path.join(DATA_DIR, 'agents', 'event-triggers.json');
}

export function getEventTriggerRunsPath(): string {
  return path.join(DATA_DIR, 'agents', 'event-trigger-runs.json');
}

export function getEventTriggerStatesPath(): string {
  return path.join(DATA_DIR, 'agents', 'event-trigger-states.json');
}

/**
 * 通知数据已变更（供 MCP Server 写入后触发 UI 刷新）
 */
export async function notifyDataChanged(): Promise<void> {
  const notifyPath = path.join(DATA_DIR, '.notify');
  await fs.writeFile(notifyPath, Date.now().toString(), 'utf-8');
}
