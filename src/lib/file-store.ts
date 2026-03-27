/**
 * JSON 文件读写工具（简化版，无文件锁）
 *
 * 默认 DATA_DIR（未设置 PROJECT_PILOT_DATA_DIR 时）：
 *   ~/.project-pilot/（Windows: %USERPROFILE%\.project-pilot\）
 *
 * 目录树的目标形态与迁移进度不在此文件定义；见本机：
 *   ~/.project-pilot/README.md
 *   ~/.project-pilot/数据文件夹现状.md
 * 仓库文档：工作区根 README.md#pp-data-directory
 *
 * 技能相关：
 *   - 生效中的技能：`{DATA_DIR}/skills/_global|_projects|_agents/`
 *   - 第三方完整仓库（git clone 等）：`{DATA_DIR}/skills/_vendor/<name>/`（勿放在仓库内 `tmp/`）
 *
 * 可通过环境变量 PROJECT_PILOT_DATA_DIR 覆盖默认根路径。
 */

import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

/**
 * Strip UTF-8 BOM (byte order mark) and parse JSON.
 * Some editors (Notepad, VS Code in rare cases) prepend BOM to files,
 * causing JSON.parse to fail with "Unexpected token".
 */
function extractFirstJsonDocument(raw: string): string | null {
  const trimmed = raw.trimStart();
  if (!trimmed) return null;

  const firstChar = trimmed[0];
  if (firstChar !== '{' && firstChar !== '[') {
    return null;
  }

  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{' || char === '[') {
      stack.push(char);
      continue;
    }

    if (char === '}' || char === ']') {
      const opening = stack.pop();
      if (!opening) return null;
      if ((opening === '{' && char !== '}') || (opening === '[' && char !== ']')) {
        return null;
      }
      if (stack.length === 0) {
        return trimmed.slice(0, index + 1);
      }
    }
  }

  return null;
}

export function parseJsonSafe<T>(raw: string): T {
  const cleaned = raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw;
  try {
    return JSON.parse(cleaned);
  } catch (error) {
    if (!(error instanceof SyntaxError)) {
      throw error;
    }

    const recovered = extractFirstJsonDocument(cleaned);
    if (recovered && recovered !== cleaned) {
      return JSON.parse(recovered) as T;
    }

    throw error;
  }
}

export function parseJsonSafe<T>(raw: string): T {
  const cleaned = raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw;
  try {
    return JSON.parse(cleaned);
  } catch (error) {
    if (!(error instanceof SyntaxError)) {
      throw error;
    }

    const recovered = extractFirstJsonDocument(cleaned);
    if (recovered && recovered !== cleaned) {
      return JSON.parse(recovered) as T;
    }

    throw error;
  }
}

/** 产品数据根固定为 ~/.project-pilot，不再使用 ~/.project-pilot/data/ 作为默认 DATA_DIR。 */
function resolveDefaultDataDir(): string {
  return path.join(os.homedir(), '.project-pilot');
}

// 未设置 PROJECT_PILOT_DATA_DIR 时即上值。projects/index.json 等在 ensureProjectsMigrated 下创建。
const DEFAULT_DATA_DIR = resolveDefaultDataDir();

// 支持环境变量自定义（用于测试或特殊部署场景）
const DATA_DIR = process.env.PROJECT_PILOT_DATA_DIR || DEFAULT_DATA_DIR;

export function getDataDir(): string {
  return DATA_DIR;
}

/** 旧版扁平 projects.json（仅迁移读取） */
export function getProjectsPath(): string {
  return path.join(DATA_DIR, 'projects.json');
}

/** projects 域目录：projects/index.json、inboxes/ 等 */
export function getProjectsDomainDir(): string {
  return path.join(DATA_DIR, 'projects');
}

export function getProjectsIndexPath(): string {
  return path.join(getProjectsDomainDir(), 'index.json');
}

const PROJECTS_INDEX_VERSION = 1;

/** 已废弃：Flow 看板 per-project JSON 目录（清理/备份时仍可能访问） */
export function getLegacyFlowsDir(): string {
  return path.join(DATA_DIR, 'workflows', 'flows');
}

/** @deprecated 无 Flow 产品能力，保留别名避免旧代码引用报错 */
export function getFlowsDir(): string {
  return getLegacyFlowsDir();
}

/** @deprecated */
export function getFlowIndexPath(): string {
  return path.join(getLegacyFlowsDir(), '_index.json');
}

/** @deprecated Per-project flow JSON 已移除 */
export function getFlowDataPath(projectKey: string): string {
  const safe = projectKey.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safe || safe.length < 1 || safe.length > 100) {
    throw new Error(`Invalid project key: ${projectKey}`);
  }
  return path.join(getLegacyFlowsDir(), `${safe}.json`);
}

let _flowsMigrated = false;

/**
 * 首次启动时创建所有数据子目录。
 */
async function ensureDataDirInitialized(): Promise<void> {
  const dirs = [
    path.join(DATA_DIR, 'config'),
    getProjectsDomainDir(),
    path.join(getProjectsDomainDir(), 'inboxes'),
    path.join(DATA_DIR, 'agents'),
    path.join(DATA_DIR, 'agents', 'definitions'),
    path.join(DATA_DIR, 'agents', 'bindings'),
    path.join(DATA_DIR, 'agents', 'statuses'),
    path.join(DATA_DIR, 'agents', 'schedules'),
    path.join(DATA_DIR, 'agents', 'schedule-runs'),
    path.join(DATA_DIR, 'agents', 'teams'),
    path.join(DATA_DIR, 'agents', 'catalog'),
    getAgentDataDir(),
    path.join(DATA_DIR, 'documents', 'entries'),
    path.join(DATA_DIR, 'documents', 'content'),
    path.join(DATA_DIR, 'sessions', 'prompt-overrides'),
    path.join(DATA_DIR, 'chat'),
    getAgentChatMessagesDir(),
    getAgentChatSessionAdjunctsDir(),
    path.join(DATA_DIR, 'tasks'),
    path.join(DATA_DIR, 'todos', 'entries'),
    path.join(DATA_DIR, 'prompts', 'agents'),
    path.join(DATA_DIR, 'prompts', 'history'),
    // Compatibility path: session prompt overrides are still stored under prompts/runtime/
    path.join(DATA_DIR, 'prompts', 'runtime'),
    path.join(DATA_DIR, 'prompts', 'blocks'),
    getProjectPromptsDir(),
    getContextDir(),
    getDesignDocsDir(),
    getDialoguesDir(),
    path.join(DATA_DIR, 'workflows'),
    getArtifactsDir(),
    getSkillsDir(),
    getSkillsVendorDir(),
    path.join(DATA_DIR, 'usage'),
    // runs/
    path.join(DATA_DIR, '_next', 'runs', 'by-id'),
    path.join(DATA_DIR, '_next', 'runs', 'latest-by-session'),
    // top-level
    path.join(DATA_DIR, '_snapshots'),
  ];
  await Promise.all(dirs.map(d => fs.mkdir(d, { recursive: true })));
  await migrateLegacyAgentsDataToWorkspacesOnce();
}

/**
 * 旧版曾使用 agents/data/<id>/，规范为 agents/workspaces/<agentId>/（见 ~/.project-pilot/agents/README.md）。
 * 仅执行一次：将 agents/data/* 迁入 agents/workspaces/*（目标已存在则跳过该项）。
 */
async function migrateLegacyAgentsDataToWorkspacesOnce(): Promise<void> {
  const marker = path.join(DATA_DIR, 'agents', '.migrated-agents-data-to-workspaces');
  try {
    await fs.access(marker);
    return;
  } catch {
    /* proceed */
  }

  const legacyRoot = path.join(DATA_DIR, 'agents', 'data');
  const targetRoot = path.join(DATA_DIR, 'agents', 'workspaces');
  await fs.mkdir(targetRoot, { recursive: true });

  try {
    const names = await fs.readdir(legacyRoot);
    for (const name of names) {
      const from = path.join(legacyRoot, name);
      const to = path.join(targetRoot, name);
      try {
        await fs.access(to);
        continue;
      } catch {
        /* target 不存在，可迁入 */
      }
      try {
        await fs.rename(from, to);
      } catch {
        /* 单项失败不阻塞整体 */
      }
    }
  } catch {
    /* legacyRoot 不存在 */
  }

  await fs.writeFile(marker, new Date().toISOString(), 'utf-8');
}

/**
 * @deprecated Flow 域已下线；仅保证目录存在。
 */
export async function ensureFlowsMigrated(): Promise<void> {
  if (_flowsMigrated) return;
  _flowsMigrated = true;
  await ensureDataDirInitialized();
}

type DiskProjectRow = Record<string, unknown>;

function normalizeDiskProjectRow(row: DiskProjectRow): import('@/types').ProjectEntry | null {
  const idRaw = (typeof row.id === 'string' && row.id) || (typeof row.key === 'string' && row.key) || '';
  const safe = idRaw.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safe) return null;
  const name = typeof row.name === 'string' && row.name.trim() ? row.name : safe;
  const {
    id: _i,
    key: _k,
    techStack: _t,
    ...rest
  } = row as unknown as import('@/types').ProjectEntry & { id?: string };
  return {
    ...(rest as Omit<import('@/types').ProjectEntry, 'key' | 'name'>),
    key: safe,
    name,
  };
}

function projectEntryToDisk(p: import('@/types').ProjectEntry): DiskProjectRow {
  const id = p.key.replace(/[^a-zA-Z0-9_-]/g, '') || p.key;
  const {
    key: _key,
    techStack: _tech,
    ...rest
  } = p;
  return { id, ...rest };
}

interface ProjectsIndexOnDisk {
  version?: number;
  projects?: DiskProjectRow[];
  _migrated_to_projects_domain?: boolean;
}

let _projectsMigrated = false;

/**
 * 合并 legacy：projects/index.json ← 旧 workflows/flows/_index.json + 扁平 projects.json。
 */
export async function ensureProjectsMigrated(): Promise<void> {
  if (_projectsMigrated) return;
  _projectsMigrated = true;

  await ensureDataDirInitialized();

  const destPath = getProjectsIndexPath();
  const legacyFlowIndex = getFlowIndexPath();
  const projectsPath = getProjectsPath();

  // 文件不存在则写入占位（version 0、无 _migrated_to_projects_domain），避免「靠是否存在猜目录」且保证后续必落盘
  try {
    await fs.access(destPath);
  } catch {
    await writeJsonFile(destPath, { version: 0, projects: [] });
  }

  let disk = await readJsonFile<ProjectsIndexOnDisk>(destPath, {
    version: 0,
    projects: [],
  });

  if (disk._migrated_to_projects_domain && (disk.version ?? 0) >= PROJECTS_INDEX_VERSION) {
    return;
  }

  const merged: import('@/types').ProjectEntry[] = [];
  const seen = new Set<string>();

  const pushUnique = (e: import('@/types').ProjectEntry | null) => {
    if (!e) return;
    if (seen.has(e.key)) return;
    seen.add(e.key);
    merged.push(e);
  };

  for (const row of disk.projects ?? []) {
    pushUnique(normalizeDiskProjectRow(row));
  }

  const fromFlow = await readJsonFile<import('@/types').ProjectIndex>(legacyFlowIndex, { projects: [] });
  for (const p of fromFlow.projects) {
    pushUnique(normalizeDiskProjectRow(p as unknown as DiskProjectRow));
  }

  let oldProjects: Record<string, import('@/types').ProjectConfig> = {};
  try {
    const pdata = await readJsonFile<import('@/types').ProjectsData>(projectsPath, { projects: {} });
    oldProjects = pdata.projects;
  } catch {
    /* ok */
  }

  for (const [key, config] of Object.entries(oldProjects)) {
    const safe = key.replace(/[^a-zA-Z0-9_-]/g, '');
    if (!safe) continue;
    if (seen.has(safe)) {
      const existing = merged.find(m => m.key === safe);
      if (existing) {
        if (!existing.path && config.path) existing.path = config.path;
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
      }
      continue;
    }
    const entry: import('@/types').ProjectEntry = {
      key: safe,
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
    pushUnique(entry);
  }

  await writeJsonFile(destPath, {
    version: PROJECTS_INDEX_VERSION,
    projects: merged.map(projectEntryToDisk),
    _migrated_to_projects_domain: true,
  });
}

let _legacyDataSubdirProjectsMerged = false;

/**
 * 默认数据根从 `~/.project-pilot/data` 迁到 `~/.project-pilot` 后，若主 `projects/index.json`
 * 仍为空，尝试从遗留子目录合并一次（幂等），避免项目管理中心读不到旧注册表。
 */
async function ensureLegacyDataSubdirProjectsMerged(): Promise<void> {
  if (_legacyDataSubdirProjectsMerged) return;

  const currentPath = getProjectsIndexPath();
  let current: ProjectsIndexOnDisk;
  try {
    current = await readJsonFile<ProjectsIndexOnDisk>(currentPath, { projects: [] });
  } catch {
    _legacyDataSubdirProjectsMerged = true;
    return;
  }

  const existingCount = (current.projects ?? []).filter((row) => normalizeDiskProjectRow(row) !== null).length;
  if (existingCount > 0) {
    _legacyDataSubdirProjectsMerged = true;
    return;
  }

  const merged: import('@/types').ProjectEntry[] = [];
  const seen = new Set<string>();
  const pushUnique = (e: import('@/types').ProjectEntry | null) => {
    if (!e) return;
    if (seen.has(e.key)) return;
    seen.add(e.key);
    merged.push(e);
  };

  const nestedIndex = path.join(DATA_DIR, 'data', 'projects', 'index.json');
  try {
    const alt = await readJsonFile<ProjectsIndexOnDisk>(nestedIndex, { projects: [] });
    for (const row of alt.projects ?? []) {
      pushUnique(normalizeDiskProjectRow(row));
    }
  } catch {
    /* ok */
  }

  const nestedFlat = path.join(DATA_DIR, 'data', 'projects.json');
  try {
    const pdata = await readJsonFile<import('@/types').ProjectsData>(nestedFlat, { projects: {} });
    for (const [key, config] of Object.entries(pdata.projects)) {
      const safe = key.replace(/[^a-zA-Z0-9_-]/g, '');
      if (!safe) continue;
      if (seen.has(safe)) {
        const existing = merged.find((m) => m.key === safe);
        if (existing) {
          if (!existing.path && config.path) existing.path = config.path;
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
        }
        continue;
      }
      const entry: import('@/types').ProjectEntry = {
        key: safe,
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
      pushUnique(entry);
    }
  } catch {
    /* ok */
  }

  if (merged.length === 0) {
    _legacyDataSubdirProjectsMerged = true;
    return;
  }

  await writeJsonFile(currentPath, {
    version: PROJECTS_INDEX_VERSION,
    projects: merged.map(projectEntryToDisk),
    _migrated_to_projects_domain: true,
  });
  _legacyDataSubdirProjectsMerged = true;
}

export async function readProjectIndex(): Promise<import('@/types').ProjectIndex> {
  await ensureDataDirV2Migrated();
  await ensureLegacyDataSubdirProjectsMerged();
  const raw = await readJsonFile<ProjectsIndexOnDisk>(getProjectsIndexPath(), { projects: [] });
  const projects = (raw.projects ?? [])
    .map((row) => normalizeDiskProjectRow(row))
    .filter((e): e is import('@/types').ProjectEntry => e !== null);
  return { projects };
}

export async function writeProjectIndex(index: import('@/types').ProjectIndex): Promise<void> {
  await ensureDataDirV2Migrated();
  await writeJsonFile(getProjectsIndexPath(), {
    version: PROJECTS_INDEX_VERSION,
    projects: index.projects.map(projectEntryToDisk),
    _migrated_to_projects_domain: true,
  });
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
 * 对 session prompt override 目录，兼容旧结构 prompts/{agentId}.runtime/，
 * 当前兼容路径仍是 prompts/runtime/{agentId}/。
 */
export async function ensureDataDirV2Migrated(): Promise<void> {
  if (_v2Migrated) {
    await ensureLegacyNestedDataHoisted();
    return;
  }
  _v2Migrated = true;

  // 先确保 V1 迁移完成
  await ensureProjectsMigrated();

  // 检查是否已迁移
  try {
    await fs.stat(V2_MIGRATION_MARKER);
    await ensureLegacyNestedDataHoisted();
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
    await ensureLegacyNestedDataHoisted();
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
    [path.join(DATA_DIR, 'todos.json'), getTodosPath()],
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
    // knowledge/
    [path.join(DATA_DIR, 'context'), getContextDir()],
    [path.join(DATA_DIR, 'design-docs'), getDesignDocsDir()],
    [path.join(DATA_DIR, 'docs'), path.join(DATA_DIR, 'knowledge', 'docs')],
    [path.join(DATA_DIR, 'fundraising'), path.join(DATA_DIR, 'knowledge', 'fundraising')],
    // 产物目录保持 `{DATA_DIR}/artifacts/`，不再迁入历史嵌套目录下的 artifacts（见 ensureLegacyNestedDataHoisted）
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

  // 特殊处理：session prompt override（prompts/{agentId}.runtime/ → prompts/runtime/{agentId}/）
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
  await ensureLegacyNestedDataHoisted();
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

/** 文件名保留历史，避免已迁移用户重复执行合并逻辑 */
const LEGACY_NESTED_DATA_HOIST_MARKER = path.join(DATA_DIR, '.pp-hoisted-legacy-storage');
let _legacyNestedDataHoistChecked = false;

/** 旧版曾把部分数据放在 `{DATA_DIR}/storage/` 下；当前规范为根下 `artifacts/`、`skills/`。 */
const LEGACY_DATA_NEST_DIR = 'storage' as const;

/**
 * 将历史嵌套目录下的 `artifacts`、`skills` 合并到规范路径 `{DATA_DIR}/artifacts`、`{DATA_DIR}/skills`，
 * 并在为空时移除该嵌套目录（若仍有未识别子项则打日志，由用户手动处理）。
 * 幂等；写标记文件避免每次启动重复扫描。
 */
export async function ensureLegacyNestedDataHoisted(): Promise<void> {
  if (_legacyNestedDataHoistChecked) return;
  _legacyNestedDataHoistChecked = true;

  try {
    await fs.access(LEGACY_NESTED_DATA_HOIST_MARKER);
    return;
  } catch {
    /* proceed */
  }

  const nestedRoot = path.join(DATA_DIR, LEGACY_DATA_NEST_DIR);

  try {
    await fs.access(nestedRoot);
  } catch {
    await fs.writeFile(LEGACY_NESTED_DATA_HOIST_MARKER, new Date().toISOString(), 'utf-8').catch(() => {});
    return;
  }

  const hoists: { src: string; dest: string; label: string }[] = [
    { src: path.join(nestedRoot, 'artifacts'), dest: getArtifactsDir(), label: 'artifacts' },
    { src: path.join(nestedRoot, 'skills'), dest: getSkillsDir(), label: 'skills' },
  ];

  for (const { src, dest, label } of hoists) {
    try {
      await fs.stat(src);
    } catch {
      continue;
    }
    if (path.resolve(src) === path.resolve(dest)) continue;

    await fs.mkdir(dest, { recursive: true });
    await _migrateCopyDir(src, dest);
    await fs.rm(src, { recursive: true, force: true }).catch(() => {});
    console.log(`[migration] 已合并历史嵌套目录中的 ${label}/ → ${label}/`);
  }

  try {
    const left = await fs.readdir(nestedRoot);
    if (left.length === 0) {
      await fs.rm(nestedRoot, { recursive: false });
    } else if (left.length > 0) {
      console.warn(
        `[migration] ${nestedRoot} 仍有未识别子项 (${left.join(', ')}); 请手动检查后删除该目录`,
      );
    }
  } catch {
    /* 嵌套目录已不存在 */
  }

  await fs.writeFile(LEGACY_NESTED_DATA_HOIST_MARKER, new Date().toISOString(), 'utf-8').catch(() => {});
}

/** @deprecated 请使用 ensureLegacyNestedDataHoisted */
export const ensureLegacyStorageHoisted = ensureLegacyNestedDataHoisted;

export function getSettingsPath(): string {
  return path.join(DATA_DIR, 'config', 'settings.json');
}

export function getAgentsPath(): string {
  return path.join(DATA_DIR, 'agents', 'registry.json');
}

export function getDimensionsPath(): string {
  return path.join(DATA_DIR, 'config', 'dimensions.json');
}

export function getAgentsDefinitionsDir(): string {
  return path.join(DATA_DIR, 'agents', 'definitions');
}

export function getAgentsBindingsDir(): string {
  return path.join(DATA_DIR, 'agents', 'bindings');
}

export function getAgentsStatusesDir(): string {
  return path.join(DATA_DIR, 'agents', 'statuses');
}

export function getDocumentsEntriesDir(): string {
  return path.join(DATA_DIR, 'documents', 'entries');
}

export function getDocumentsContentDir(): string {
  return path.join(DATA_DIR, 'documents', 'content');
}

export function getDocumentsIndexPath(): string {
  return path.join(DATA_DIR, 'documents', 'index.json');
}

export function getSchedulesDir(): string {
  return path.join(DATA_DIR, 'agents', 'schedules');
}

export function getScheduleRunsDir(): string {
  return path.join(DATA_DIR, 'agents', 'schedule-runs');
}

/**
 * 新布局：会话级 prompt 覆盖位于 sessions/prompt-overrides/
 * 与 prompts/runtime/ 并存时，读写逻辑应同时尝试两者（见 agent-prompt-store）。
 */
export function getLegacySessionPromptOverridePath(agentId: string, sessionId: string): string {
  const safeAgent = agentId.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safeAgent || safeAgent.length < 1 || safeAgent.length > 100) {
    throw new Error(`Invalid agent id: ${agentId}`);
  }
  const safeSession = sessionId.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safeSession || safeSession.length < 1 || safeSession.length > 200) {
    throw new Error(`Invalid session id: ${sessionId}`);
  }
  return path.join(DATA_DIR, 'sessions', 'prompt-overrides', safeAgent, `${safeSession}.md`);
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

export function getRunsByIdDir(): string {
  return path.join(DATA_DIR, '_next', 'runs', 'by-id');
}

export function getRunByIdPath(runId: string): string {
  const safe = runId.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safe || safe.length < 1 || safe.length > 200) {
    throw new Error(`Invalid run id: ${runId}`);
  }
  return path.join(getRunsByIdDir(), `${safe}.json`);
}

export function getLatestRunsBySessionDir(): string {
  return path.join(DATA_DIR, '_next', 'runs', 'latest-by-session');
}

export function getLatestRunBySessionPath(sessionId: string): string {
  const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safe || safe.length < 1 || safe.length > 200) {
    throw new Error(`Invalid session id: ${sessionId}`);
  }
  return path.join(getLatestRunsBySessionDir(), `${safe}.json`);
}

export function getWorktreePortsPath(): string {
  return path.join(DATA_DIR, 'workflows', 'worktree-ports.json');
}

export function getTodosPath(): string {
  return path.join(DATA_DIR, 'tasks', 'todos.json');
}

/** 单条待办 JSON：`todos/entries/<todoId>.json`（与聚合文件 `tasks/todos.json` 并存，读取时合并，分文件优先） */
export function getTodosEntriesDir(): string {
  return path.join(DATA_DIR, 'todos', 'entries');
}

export function getActiveTasksPath(): string {
  return path.join(DATA_DIR, 'tasks', 'active.json');
}

/** 通用执行产物目录：`{DATA_DIR}/artifacts/`（不再使用 `storage/artifacts`） */
export function getArtifactsDir(): string {
  return path.join(DATA_DIR, 'artifacts');
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

/**
 * Session prompt override compatibility directory.
 * Note: the current physical path still lives under prompts/runtime/ for backward compatibility,
 * but the product meaning is "session prompt override", not a standalone runtime-prompt domain.
 */
export function getSessionPromptOverrideDir(agentId: string): string {
  const safe = agentId.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safe || safe.length < 1 || safe.length > 100) {
    throw new Error(`Invalid agent id: ${agentId}`);
  }
  return path.join(DATA_DIR, 'prompts', 'runtime', safe);
}

/**
 * Session prompt override compatibility file path.
 * Physical path currently remains under prompts/runtime/{agentId}/{sessionId}.md.
 */
export function getSessionPromptOverridePath(agentId: string, sessionId: string): string {
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

/**
 * @deprecated Prefer getSessionPromptOverrideDir().
 * Kept for compatibility while the codebase migrates away from the old "runtime prompt" wording.
 */
export function getPromptRuntimeDir(agentId: string): string {
  return getSessionPromptOverrideDir(agentId);
}

/**
 * @deprecated Prefer getSessionPromptOverridePath().
 * Kept for compatibility while the codebase migrates away from the old "runtime prompt" wording.
 */
export function getPromptRuntimePath(agentId: string, sessionId: string): string {
  return getSessionPromptOverridePath(agentId, sessionId);
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

/** Skills 根目录：`{DATA_DIR}/skills/`（其下有 `_global`、`_projects`、`_agents`、`_vendor`） */
export function getSkillsDir(): string {
  return path.join(DATA_DIR, 'skills');
}

/**
 * 第三方 / 上游完整技能仓库目录（例如 `git clone` 的整树）。
 * 与 `_global` 下单技能目录区分：此处仅作源码/参考，不自动参与 Agent 技能解析；需要时复制或迁移到 `_global/<name>/`。
 */
export function getSkillsVendorDir(): string {
  return path.join(getSkillsDir(), '_vendor');
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

// ── Agent 私有工作空间路径（规范：~/.project-pilot/agents/README.md → agents/workspaces/<agentId>/）──
// getAgentDataPath 等名称沿用旧 API，实际路径已对齐 workspaces。

function safeAgentIdSegment(agentId: string): string {
  const safe = agentId.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safe || safe.length < 1 || safe.length > 100) {
    throw new Error(`Invalid agent id: ${agentId}`);
  }
  return safe;
}

/** 各 Agent 工作区父目录：agents/workspaces/ */
export function getAgentDataDir(): string {
  return path.join(DATA_DIR, 'agents', 'workspaces');
}

/** 旧版错误路径 agents/data/<id>/，仅用于解析已存在目录 */
export function getLegacyAgentDataPath(agentId: string): string {
  return path.join(DATA_DIR, 'agents', 'data', safeAgentIdSegment(agentId));
}

/** 某一 Agent 的私有工作区根目录 */
export function getAgentDataPath(agentId: string): string {
  return path.join(getAgentDataDir(), safeAgentIdSegment(agentId));
}

export function getAgentDataFilePath(agentId: string, fileName: string): string {
  // 🔒 Security: prevent path traversal
  const safeFile = path.basename(fileName);
  if (!safeFile || safeFile !== fileName || safeFile.includes('..')) {
    throw new Error(`Invalid file name: ${fileName}`);
  }
  return path.join(getAgentDataPath(agentId), safeFile);
}

// ── Inbox 路径函数 ──

export function getInboxPath(projectKey: string): string {
  const safe = projectKey.replace(/[^a-zA-Z0-9_-]/g, '');

  // 🔒 Security: prevent empty filename or invalid project keys
  if (!safe || safe.length < 1 || safe.length > 100) {
    throw new Error(`Invalid project key: ${projectKey}`);
  }

  return path.join(getProjectsDomainDir(), 'inboxes', `${safe}.json`);
}

function getLegacyInboxPath(projectKey: string): string {
  const safe = projectKey.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safe || safe.length < 1 || safe.length > 100) {
    throw new Error(`Invalid project key: ${projectKey}`);
  }
  return path.join(getLegacyFlowsDir(), `${safe}_inbox.json`);
}

/** 读取项目收件箱数据，不存在时返回空列表（自动从旧 workflows/flows/*_inbox.json 迁一次） */
export async function readInbox(projectKey: string): Promise<import('@/types').ProjectInbox> {
  const nextPath = getInboxPath(projectKey);
  const data = await readJsonFile<import('@/types').ProjectInbox>(nextPath, { items: [] });
  if (data.items.length > 0) return data;
  const legacyPath = getLegacyInboxPath(projectKey);
  const legacy = await readJsonFile<import('@/types').ProjectInbox>(legacyPath, { items: [] });
  if (legacy.items.length > 0) {
    await writeJsonFile(nextPath, legacy);
    await fs.unlink(legacyPath).catch(() => {});
  }
  return legacy;
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
