/**
 * Skill 文件 I/O + 版本管理。
 *
 * 每个 skill 存储在 skills/{skillName}/SKILL.md（OpenClaw 兼容格式）。
 * 版本历史：skills/{skillName}/.history/v_YYMMDD_HHmmss.md（最多 20 份）
 */

import { promises as fs } from 'fs';
import path from 'path';
import { getSkillsDir, getSkillFilePath, getSkillHistoryDir } from './file-store';

/** 最大 skill 文件大小：10MB */
const MAX_SKILL_SIZE = 10 * 1024 * 1024;

/** 版本历史最大保留数 */
const MAX_SKILL_VERSIONS = 20;

// ── 前言解析 ──

export interface SkillMeta {
  name: string;
  description: string;
}

/**
 * 解析 SKILL.md 顶部的 YAML frontmatter（仅提取 name 和 description）。
 * 格式：
 * ---
 * name: xxx
 * description: yyy
 * ---
 */
export function parseSkillFrontmatter(content: string): SkillMeta | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  const fm = match[1];
  const name = fm.match(/^name:\s*(.+)$/m)?.[1]?.trim() ?? '';
  const description = fm.match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? '';
  if (!name) return null;
  return { name, description };
}

// ── 基础读写 ──

/**
 * 读取 skill 的 SKILL.md 内容。
 * 文件不存在返回 undefined。
 */
export async function readSkillFile(skillName: string): Promise<string | undefined> {
  try {
    const filePath = getSkillFilePath(skillName);
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
 * 写入 skill 到 skills/{skillName}/SKILL.md。
 * 写入前自动快照当前版本到 .history/。
 */
export async function writeSkillFile(skillName: string, content: string): Promise<void> {
  await snapshotSkillVersion(skillName);
  const filePath = getSkillFilePath(skillName);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf-8');
}

/**
 * 删除 skill 的目录（含 SKILL.md 和 .history/）。
 * 不存在时静默成功。
 */
export async function deleteSkillFile(skillName: string): Promise<void> {
  const filePath = getSkillFilePath(skillName);
  const skillDir = path.dirname(filePath);
  try {
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
}

/**
 * 列出所有 skill（从 skills/ 目录扫描）。
 */
export async function listSkills(): Promise<SkillListItem[]> {
  const skillsDir = getSkillsDir();
  let entries: string[];
  try {
    entries = await fs.readdir(skillsDir);
  } catch {
    return [];
  }

  const results: SkillListItem[] = [];
  for (const entry of entries) {
    const filePath = path.join(skillsDir, entry, 'SKILL.md');
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
      });
    } catch {
      // 跳过无法读取的条目
    }
  }
  return results.sort((a, b) => a.name.localeCompare(b.name));
}

// ── 版本管理 ──

/**
 * 快照当前正式版到 .history/ 目录。
 * 文件不存在时静默跳过。快照失败不阻塞调用方。
 */
export async function snapshotSkillVersion(skillName: string): Promise<void> {
  const filePath = getSkillFilePath(skillName);
  try {
    await fs.stat(filePath);
  } catch {
    return; // 文件不存在，无需快照
  }

  try {
    const historyDir = getSkillHistoryDir(skillName);
    await fs.mkdir(historyDir, { recursive: true });

    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const timestamp = `${String(now.getFullYear()).slice(2)}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const destPath = path.join(historyDir, `v_${timestamp}.md`);

    await fs.copyFile(filePath, destPath);

    // 清理旧版本：只保留最新 MAX_SKILL_VERSIONS 份
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

/**
 * 列出版本历史（新→旧）。
 * 返回版本名数组（如 ['v_260305_091500', 'v_260301_143022']）。
 */
export async function listSkillVersions(skillName: string): Promise<string[]> {
  try {
    const historyDir = getSkillHistoryDir(skillName);
    const files = (await fs.readdir(historyDir))
      .filter(f => f.startsWith('v_') && f.endsWith('.md'))
      .sort()
      .reverse();
    return files.map(f => f.replace('.md', ''));
  } catch {
    return [];
  }
}

/**
 * 读取特定版本的 skill 内容。
 * versionName 做 sanitize 防路径穿越。
 */
export async function readSkillVersion(
  skillName: string,
  versionName: string,
): Promise<string | undefined> {
  try {
    const safe = versionName.replace(/[^a-zA-Z0-9_]/g, '');
    const filePath = path.join(getSkillHistoryDir(skillName), `${safe}.md`);
    return await fs.readFile(filePath, 'utf-8');
  } catch {
    return undefined;
  }
}

/**
 * 回滚到指定版本。
 * 调用 writeSkillFile，自动快照当前版本后再覆盖。
 */
export async function revertSkillToVersion(
  skillName: string,
  versionName: string,
): Promise<boolean> {
  const content = await readSkillVersion(skillName, versionName);
  if (content === undefined) return false;
  await writeSkillFile(skillName, content);
  return true;
}
