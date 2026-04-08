/**
 * Skill 文件 I/O + 版本管理 + 作用域。
 *
 * 根目录：`{DATA_DIR}/skills/`
 *   skills/_global/{name}/SKILL.md
 *   skills/_projects/{projectKey}/{name}/SKILL.md
 *   skills/_agents/{agentId}/{name}/SKILL.md
 *   skills/_vendor/{repo}/（第三方完整仓库，见 file-store getSkillsVendorDir）
 *
 * 根下平铺（无 _ 前缀子目录）：`skills/{name}/SKILL.md` 仍支持列表与读取，可通过 API 迁到 _global。
 *
 * 版本历史：{skillDir}/.history/v_YYMMDD_HHmmss.md（最多 20 份）
 */

import { promises as fs } from 'fs';
import { assertDocumentTextWritable } from './document-text-write-guard';
import path from 'path';
import {
  getSkillsDir,
  getSkillFilePath,
  getSkillHistoryDir,
  getSkillDir,
  getScopedSkillsDir,
  SKILL_SUBDIRS,
  type SkillSubdir,
  type SkillScope,
  DEFAULT_SKILL_SCOPE,
} from './file-store';

const yaml = require('js-yaml') as {
  load(input: string): unknown;
};

/** 最大 skill 文件大小：10MB */
const MAX_SKILL_SIZE = 10 * 1024 * 1024;

/** 版本历史最大保留数 */
const MAX_SKILL_VERSIONS = 20;

// ── 前言解析 ──

export interface SkillMeta {
  name: string;
  description: string;
  /**
   * OpenClaw / AgentSkills：`disable-model-invocation: true` 时不把该 skill 注入模型提示词
   *（仍可通过用户侧 slash 等入口使用，与 OpenClaw 语义一致）。
   */
  disableModelInvocation?: boolean;
}

function parseYamlBoolean(value: unknown): boolean | undefined {
  if (value === true) return true;
  if (value === false) return false;
  if (typeof value === 'string') {
    const s = value.trim().toLowerCase();
    if (s === 'true') return true;
    if (s === 'false') return false;
  }
  return undefined;
}

/**
 * 去掉首个 YAML frontmatter 块，返回正文（与 OpenClaw「SKILL.md = frontmatter + 说明」一致）。
 * 无合法起始 `---`…`---` 时返回全文 trim。
 */
export function stripSkillFrontmatter(content: string): string {
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return content.trim();
  return match[1].replace(/^\n+/, '').trimEnd();
}

/**
 * 解析 SKILL.md 顶部的 YAML frontmatter（AgentSkills 必填：name、description）。
 * 同时识别 OpenClaw 可选键 `disable-model-invocation`。
 */
export function parseSkillFrontmatter(content: string): SkillMeta | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  const frontmatter = parseFrontmatterBlock(match[1]);
  if (!frontmatter || typeof frontmatter !== 'object' || Array.isArray(frontmatter)) {
    return null;
  }

  const name = typeof frontmatter.name === 'string' ? frontmatter.name.trim() : '';
  const description = typeof frontmatter.description === 'string'
    ? frontmatter.description.trim()
    : '';
  if (!name) return null;
  const disableModelInvocation = parseYamlBoolean(frontmatter['disable-model-invocation']);
  const out: SkillMeta = { name, description };
  if (disableModelInvocation === true) {
    out.disableModelInvocation = true;
  }
  return out;
}

// ── 基础读写（scope-aware）──

/**
 * 读取 skill 的 SKILL.md 内容。
 * 文件不存在返回 undefined。
 */
function parseFrontmatterBlock(frontmatterBlock: string): Record<string, unknown> | null {
  try {
    const parsed = yaml.load(frontmatterBlock);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function readSkillFile(
  skillName: string,
  scope: SkillScope = DEFAULT_SKILL_SCOPE,
): Promise<string | undefined> {
  if (scope.level === 'global') {
    const root = await resolveGlobalSkillRoot(skillName);
    if (root) {
      const filePath = path.join(root, 'SKILL.md');
      try {
        const stats = await fs.stat(filePath);
        if (stats.size > MAX_SKILL_SIZE) {
          throw new Error(`Skill file too large: ${stats.size} bytes (max ${MAX_SKILL_SIZE})`);
        }
        return await fs.readFile(filePath, 'utf-8');
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw e;
      }
    }
    return undefined;
  }

  try {
    const filePath = getSkillFilePath(skillName, scope);
    const stats = await fs.stat(filePath);
    if (stats.size > MAX_SKILL_SIZE) {
      throw new Error(`Skill file too large: ${stats.size} bytes (max ${MAX_SKILL_SIZE})`);
    }
    return await fs.readFile(filePath, 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

/**
 * 写入 skill。写入前自动快照当前版本到 .history/。
 */
export async function writeSkillFile(
  skillName: string,
  content: string,
  scope: SkillScope = DEFAULT_SKILL_SCOPE,
): Promise<void> {
  assertDocumentTextWritable(content);
  await snapshotSkillVersion(skillName, scope);
  let filePath: string;
  if (scope.level === 'global') {
    const root = await resolveGlobalSkillRoot(skillName);
    filePath = root ? path.join(root, 'SKILL.md') : getSkillFilePath(skillName, scope);
  } else {
    filePath = getSkillFilePath(skillName, scope);
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf-8');
}

/**
 * 删除 skill 的目录（含 SKILL.md 和 .history/）。
 */
export async function deleteSkillFile(
  skillName: string,
  scope: SkillScope = DEFAULT_SKILL_SCOPE,
): Promise<void> {
  try {
    if (scope.level === 'global') {
      const root = await resolveGlobalSkillRoot(skillName);
      if (root) {
        await fs.rm(root, { recursive: true, force: true });
        return;
      }
    }
    const skillDir = getSkillDir(skillName, scope);
    await fs.rm(skillDir, { recursive: true, force: true });
  } catch {
    // 静默跳过
  }
}

// ── 列表 ──

export interface SkillListItem {
  name: string;
  description: string;
  updatedAt: string; // ISO 8601
  scope: SkillScope;
  /** 磁盘目录名（与 front matter 的 name 可不同）；API 与读盘优先用此字段 */
  dirName?: string;
}

/** global：优先 `skills/_global/<dir>/`，否则根下平铺 `skills/<dir>/` */
async function resolveGlobalSkillRoot(skillName: string): Promise<string | null> {
  const safe = skillName.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safe || safe.length > 100) return null;
  const candidates = [
    path.join(getScopedSkillsDir({ level: 'global' }), safe),
    path.join(getSkillsDir(), safe),
  ];
  for (const dir of candidates) {
    try {
      const st = await fs.stat(path.join(dir, 'SKILL.md'));
      if (st.isFile()) {
        if (st.size > MAX_SKILL_SIZE) continue;
        return dir;
      }
    } catch {
      /* skip */
    }
  }
  return null;
}

/** 读写子文件、历史等：global 优先已存在目录，否则落到规范路径 getSkillDir */
async function skillRootDir(skillName: string, scope: SkillScope): Promise<string> {
  if (scope.level === 'global') {
    const r = await resolveGlobalSkillRoot(skillName);
    if (r) return r;
  }
  return getSkillDir(skillName, scope);
}

/**
 * 列出指定 scope 下的所有 skill。
 * global：合并 `skills/_global/*` 与根下平铺 `skills/<dir>/`（后者与前者同名时以前者为准）。
 */
export async function listSkills(scope: SkillScope = DEFAULT_SKILL_SCOPE): Promise<SkillListItem[]> {
  if (scope.level === 'global') {
    const scopedDir = getScopedSkillsDir(scope);
    const fromScoped = await scanSkillsInDir(scopedDir, scope);
    const byDir = new Map<string, SkillListItem>();
    for (const item of fromScoped) {
      byDir.set(item.dirName ?? item.name, item);
    }
    for (const leg of await detectLegacySkills()) {
      if (byDir.has(leg.dirName)) continue;
      byDir.set(leg.dirName, {
        name: leg.name,
        description: leg.description,
        updatedAt: leg.updatedAt,
        scope: { level: 'global' },
        dirName: leg.dirName,
      });
    }
    return Array.from(byDir.values()).sort((a, b) => a.name.localeCompare(b.name));
  }
  const scopedDir = getScopedSkillsDir(scope);
  return scanSkillsInDir(scopedDir, scope);
}

/**
 * 列出所有 scope 下的所有 skill。
 */
export async function listAllSkills(): Promise<SkillListItem[]> {
  const results: SkillListItem[] = [];

  // 1. 全局
  results.push(...await listSkills({ level: 'global' }));

  // 2. 所有项目级
  const projectsDir = path.join(getSkillsDir(), '_projects');
  for (const pk of await safeDirEntries(projectsDir)) {
    results.push(...await listSkills({ level: 'project', projectKey: pk }));
  }

  // 3. 所有 Agent 级
  const agentsDir = path.join(getSkillsDir(), '_agents');
  for (const aid of await safeDirEntries(agentsDir)) {
    results.push(...await listSkills({ level: 'agent', agentId: aid }));
  }

  return results.sort((a, b) => a.name.localeCompare(b.name));
}

// ── 旧格式检测 ──

/** 旧格式 skill 信息 */
export interface LegacySkillInfo {
  name: string;
  dirName: string;
  description: string;
  updatedAt: string;
}

/**
 * 检测旧格式 skill（直接在 skills/ 根目录下，不在 _global/_projects/_agents 中）。
 * 返回需要迁移的 skill 列表。
 */
export async function detectLegacySkills(): Promise<LegacySkillInfo[]> {
  const results: LegacySkillInfo[] = [];
  const skillsDir = getSkillsDir();

  for (const entry of await safeDirEntries(skillsDir)) {
    if (entry.startsWith('_')) continue;

    const filePath = path.join(skillsDir, entry, 'SKILL.md');
    try {
      const stats = await fs.stat(filePath);
      if (!stats.isFile()) continue;
      const content = await fs.readFile(filePath, 'utf-8');
      const meta = parseSkillFrontmatter(content);
      if (!meta) continue;
      results.push({
        name: meta.name,
        dirName: entry,
        description: meta.description,
        updatedAt: stats.mtime.toISOString(),
      });
    } catch {
      // skip
    }
  }

  return results;
}

/**
 * 将旧格式 skill 迁移到指定 scope。
 * 物理移动整个目录（含 .history/ 和子文件）。
 */
export async function migrateLegacySkill(
  dirName: string,
  targetScope: SkillScope,
): Promise<void> {
  const srcDir = path.join(getSkillsDir(), dirName);
  try {
    const st = await fs.stat(srcDir);
    if (!st.isDirectory()) {
      throw new Error(`Legacy skill directory not found: ${dirName}`);
    }
  } catch {
    throw new Error(`Legacy skill directory not found: ${dirName}`);
  }

  const destDir = getSkillDir(dirName, targetScope);

  await fs.mkdir(path.dirname(destDir), { recursive: true });

  await fs.rename(srcDir, destDir);
}

// ── 瀑布合并（resolve for session）──

export interface ResolvedSkill {
  name: string;
  description: string;
  scope: SkillScope;
  /** 用于 ResourceRef.id 的限定 ID */
  qualifiedId: string;
}

/**
 * 为一个会话解析最终可见的 skill 集合。
 * 合并顺序：全局 → 项目级 → Agent 级
 * 同名 skill：窄范围覆盖宽范围。
 */
export async function resolveSkillsForSession(opts: {
  agentId: string;
  projectKey?: string;
}): Promise<ResolvedSkill[]> {
  const map = new Map<string, ResolvedSkill>();

  // 1. 全局（最低优先级）；读盘以目录名为准，避免 front matter name 与文件夹不一致时加载失败
  for (const s of await listSkills({ level: 'global' })) {
    const diskKey = s.dirName ?? s.name;
    map.set(diskKey, {
      name: s.name,
      description: s.description,
      scope: s.scope,
      qualifiedId: diskKey,
    });
  }

  // 2. 项目级（覆盖全局）
  if (opts.projectKey) {
    const scope: SkillScope = { level: 'project', projectKey: opts.projectKey };
    for (const s of await listSkills(scope)) {
      const diskKey = s.dirName ?? s.name;
      map.set(diskKey, {
        name: s.name,
        description: s.description,
        scope: s.scope,
        qualifiedId: `project:${opts.projectKey}:${diskKey}`,
      });
    }
  }

  // 3. Agent 级（覆盖项目级和全局）
  const agentScope: SkillScope = { level: 'agent', agentId: opts.agentId };
  for (const s of await listSkills(agentScope)) {
    const diskKey = s.dirName ?? s.name;
    map.set(diskKey, {
      name: s.name,
      description: s.description,
      scope: s.scope,
      qualifiedId: `agent:${opts.agentId}:${diskKey}`,
    });
  }

  return Array.from(map.values());
}

/**
 * 从 qualifiedId 解析出 scope 和 skillName。
 * 格式：
 *   "git-commit"                → global, "git-commit"
 *   "project:elapp:rn-perf"     → project(elapp), "rn-perf"
 *   "agent:xxx:safe-merge"      → agent(xxx), "safe-merge"
 */
export function parseQualifiedId(qualifiedId: string): { scope: SkillScope; skillName: string } {
  if (qualifiedId.startsWith('project:')) {
    const parts = qualifiedId.split(':');
    // project:projectKey:skillName (skillName may contain colons, unlikely but safe)
    const projectKey = parts[1];
    const skillName = parts.slice(2).join(':');
    return { scope: { level: 'project', projectKey }, skillName };
  }
  if (qualifiedId.startsWith('agent:')) {
    const parts = qualifiedId.split(':');
    const agentId = parts[1];
    const skillName = parts.slice(2).join(':');
    return { scope: { level: 'agent', agentId }, skillName };
  }
  return { scope: { level: 'global' }, skillName: qualifiedId };
}

// ── 版本管理（scope-aware）──

export async function snapshotSkillVersion(
  skillName: string,
  scope: SkillScope = DEFAULT_SKILL_SCOPE,
): Promise<void> {
  let filePath: string;
  let historyDir: string;
  if (scope.level === 'global') {
    const root = await resolveGlobalSkillRoot(skillName);
    if (!root) return;
    filePath = path.join(root, 'SKILL.md');
    historyDir = path.join(root, '.history');
  } else {
    filePath = getSkillFilePath(skillName, scope);
    historyDir = getSkillHistoryDir(skillName, scope);
  }
  try {
    await fs.stat(filePath);
  } catch {
    return;
  }

  try {
    await fs.mkdir(historyDir, { recursive: true });

    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const timestamp = `${String(now.getFullYear()).slice(2)}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const destPath = path.join(historyDir, `v_${timestamp}.md`);

    await fs.copyFile(filePath, destPath);

    const files = (await fs.readdir(historyDir))
      .filter(f => f.startsWith('v_') && f.endsWith('.md'))
      .sort();
    if (files.length > MAX_SKILL_VERSIONS) {
      for (const old of files.slice(0, files.length - MAX_SKILL_VERSIONS)) {
        await fs.unlink(path.join(historyDir, old)).catch(() => {});
      }
    }
  } catch {
    // 快照失败不阻塞写入
  }
}

export async function listSkillVersions(
  skillName: string,
  scope: SkillScope = DEFAULT_SKILL_SCOPE,
): Promise<string[]> {
  try {
    const skillRoot = await skillRootDir(skillName, scope);
    const historyDir = path.join(skillRoot, '.history');
    const files = (await fs.readdir(historyDir))
      .filter(f => f.startsWith('v_') && f.endsWith('.md'))
      .sort()
      .reverse();
    return files.map(f => f.replace('.md', ''));
  } catch {
    return [];
  }
}

export async function readSkillVersion(
  skillName: string,
  versionName: string,
  scope: SkillScope = DEFAULT_SKILL_SCOPE,
): Promise<string | undefined> {
  try {
    const safe = versionName.replace(/[^a-zA-Z0-9_]/g, '');
    const skillRoot = await skillRootDir(skillName, scope);
    const filePath = path.join(skillRoot, '.history', `${safe}.md`);
    return await fs.readFile(filePath, 'utf-8');
  } catch {
    return undefined;
  }
}

export async function revertSkillToVersion(
  skillName: string,
  versionName: string,
  scope: SkillScope = DEFAULT_SKILL_SCOPE,
): Promise<boolean> {
  const content = await readSkillVersion(skillName, versionName, scope);
  if (content === undefined) return false;
  await writeSkillFile(skillName, content, scope);
  return true;
}

// ── 文件夹级操作（scope-aware）──

export interface SkillFileItem {
  name: string;
  subdir: SkillSubdir;
  size: number;
  updatedAt: string;
}

export async function listSkillFiles(
  skillName: string,
  scope: SkillScope = DEFAULT_SKILL_SCOPE,
): Promise<SkillFileItem[]> {
  const skillDir = await skillRootDir(skillName, scope);
  const results: SkillFileItem[] = [];

  for (const subdir of SKILL_SUBDIRS) {
    const dirPath = path.join(skillDir, subdir);
    try {
      const entries = await fs.readdir(dirPath);
      for (const entry of entries) {
        const filePath = path.join(dirPath, entry);
        try {
          const stats = await fs.stat(filePath);
          if (!stats.isFile()) continue;
          results.push({
            name: entry,
            subdir,
            size: stats.size,
            updatedAt: stats.mtime.toISOString(),
          });
        } catch {
          // skip
        }
      }
    } catch {
      // subdir doesn't exist, skip
    }
  }

  return results;
}

function validateSubPath(subdir: string, fileName: string): { safeSubdir: SkillSubdir; safeName: string } {
  if (!SKILL_SUBDIRS.includes(subdir as SkillSubdir)) {
    throw new Error(`Invalid subdir: ${subdir}. Must be one of: ${SKILL_SUBDIRS.join(', ')}`);
  }
  const safeName = path.basename(fileName);
  if (!safeName || safeName !== fileName || safeName.includes('..')) {
    throw new Error(`Invalid file name: ${fileName}`);
  }
  return { safeSubdir: subdir as SkillSubdir, safeName };
}

export async function readSkillSubFile(
  skillName: string,
  subdir: string,
  fileName: string,
  scope: SkillScope = DEFAULT_SKILL_SCOPE,
): Promise<{ content: string; size: number } | undefined> {
  const { safeSubdir, safeName } = validateSubPath(subdir, fileName);
  const root = await skillRootDir(skillName, scope);
  const filePath = path.join(root, safeSubdir, safeName);
  try {
    const stats = await fs.stat(filePath);
    if (stats.size > MAX_SKILL_SIZE) {
      throw new Error(`File too large: ${stats.size} bytes (max ${MAX_SKILL_SIZE})`);
    }
    const content = await fs.readFile(filePath, 'utf-8');
    return { content, size: stats.size };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

export async function writeSkillSubFile(
  skillName: string,
  subdir: string,
  fileName: string,
  content: string,
  scope: SkillScope = DEFAULT_SKILL_SCOPE,
): Promise<void> {
  assertDocumentTextWritable(content);
  const { safeSubdir, safeName } = validateSubPath(subdir, fileName);
  const root = await skillRootDir(skillName, scope);
  const dirPath = path.join(root, safeSubdir);
  await fs.mkdir(dirPath, { recursive: true });
  await fs.writeFile(path.join(dirPath, safeName), content, 'utf-8');
}

export async function deleteSkillSubFile(
  skillName: string,
  subdir: string,
  fileName: string,
  scope: SkillScope = DEFAULT_SKILL_SCOPE,
): Promise<void> {
  const { safeSubdir, safeName } = validateSubPath(subdir, fileName);
  const root = await skillRootDir(skillName, scope);
  const filePath = path.join(root, safeSubdir, safeName);
  try {
    await fs.unlink(filePath);
  } catch {
    // 静默跳过
  }
}

// ── 内部工具 ──

async function safeDirEntries(dirPath: string): Promise<string[]> {
  try {
    return await fs.readdir(dirPath);
  } catch {
    return [];
  }
}

async function scanSkillsInDir(dir: string, scope: SkillScope): Promise<SkillListItem[]> {
  const results: SkillListItem[] = [];
  for (const entry of await safeDirEntries(dir)) {
    // 跳过隐藏目录和 scope 前缀目录
    if (entry.startsWith('.') || entry.startsWith('_')) continue;
    const filePath = path.join(dir, entry, 'SKILL.md');
    try {
      const stats = await fs.stat(filePath);
      if (!stats.isFile()) continue;
      const content = await fs.readFile(filePath, 'utf-8');
      const meta = parseSkillFrontmatter(content);
      if (!meta) continue;
      results.push({
        name: meta.name,
        description: meta.description,
        updatedAt: stats.mtime.toISOString(),
        scope,
        dirName: entry,
      });
    } catch {
      // skip
    }
  }
  return results.sort((a, b) => a.name.localeCompare(b.name));
}
