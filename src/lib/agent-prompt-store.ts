/**
 * Agent systemPrompt 外置文件 I/O + 版本管理 + 会话级 prompt override。
 *
 * 每个 agent 的 systemPrompt 存储在 prompts/{agentId}.md，
 * agents.json 只保留元数据，不再内联 systemPrompt。
 *
 * 版本历史：prompts/{agentId}.history/v_YYMMDD_HHmmss.md（最多 20 份）
 * 会话级 prompt override 兼容路径：prompts/runtime/{agentId}/{sessionId}.md
 */

import { promises as fs } from 'fs';
import path from 'path';
import {
  getLegacySessionPromptOverridePath,
  getPromptsDir,
  getPromptFilePath,
  getPromptHistoryDir,
  getSessionPromptOverrideDir,
  getSessionPromptOverridePath,
} from './file-store';
import { readBuiltinPrompt } from './builtin-defaults';
import { assertDocumentTextWritable } from './document-text-write-guard';

/** 最大 prompt 文件大小：10MB */
const MAX_PROMPT_SIZE = 10 * 1024 * 1024;

/** 版本历史最大保留数 */
const MAX_PROMPT_VERSIONS = 20;

// ── 基础读写 ──

/**
 * 读取 agent 的 systemPrompt 文件。
 * 文件不存在返回 undefined。
 */
export async function readPromptFile(agentId: string): Promise<string | undefined> {
  try {
    const filePath = getPromptFilePath(agentId);
    const stats = await fs.stat(filePath);
    if (stats.size > MAX_PROMPT_SIZE) {
      throw new Error(`Prompt file too large: ${stats.size} bytes (max ${MAX_PROMPT_SIZE})`);
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
 * 写入 agent 的 systemPrompt 到 prompts/{agentId}.md。
 * 写入前自动快照当前版本到 .history/。
 */
export async function writePromptFile(agentId: string, content: string): Promise<void> {
  if (content.length > 0) {
    assertDocumentTextWritable(content);
  }
  await snapshotPromptVersion(agentId);
  await fs.mkdir(getPromptsDir(), { recursive: true });
  await fs.writeFile(getPromptFilePath(agentId), content, 'utf-8');

  // Emit change event for inbox routing
  try {
    const { changeEmitter } = await import('./change-emitter');
    changeEmitter.emit({
      type: 'prompt_updated',
      sourceId: agentId,
      summary: `Agent 提示词已更新`,
      timestamp: new Date().toISOString(),
      agentId,
    });
  } catch { /* non-critical */ }
}

/**
 * 删除 agent 的 prompt 文件。
 * 同时清理 .history/ 和 session prompt override 目录。
 * 文件不存在时静默成功。
 */
export async function deletePromptFile(agentId: string): Promise<void> {
  try {
    await fs.unlink(getPromptFilePath(agentId));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
  // 清理 .history/ 和会话级 prompt override 目录
  for (const dir of [getPromptHistoryDir(agentId), getSessionPromptOverrideDir(agentId)]) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch {
      // 目录可能不存在，静默跳过
    }
  }
}

/**
 * 解析 agent 的最终 systemPrompt。
 * 优先级：用户正式版 `prompts/agents/{agentId}.md` > 数据目录 `prompts/builtin/agents/{agentId}.md`（按种子 manifest 版本同步）> 内联 systemPrompt。
 */
export async function resolveSystemPrompt(
  agentId: string,
  inlinePrompt?: string,
): Promise<string | undefined> {
  // 1. 用户数据目录（最高优先级）
  const fromUserFile = await readPromptFile(agentId);
  if (fromUserFile) return fromUserFile;

  // 2. 仓库内置默认（中优先级）
  const fromDefaults = await readBuiltinPrompt(agentId);
  if (fromDefaults) return fromDefaults;

  // 3. 内联 systemPrompt（最低优先级，向后兼容）
  return inlinePrompt;
}

// ── 版本管理 ──

/**
 * 快照当前正式版到 .history/ 目录。
 * 文件不存在时静默跳过。整个函数 try/catch 包裹，快照失败不阻塞调用方。
 */
export async function snapshotPromptVersion(agentId: string): Promise<void> {
  const filePath = getPromptFilePath(agentId);
  try {
    await fs.stat(filePath);
  } catch {
    return; // 文件不存在，无需快照
  }

  try {
    const historyDir = getPromptHistoryDir(agentId);
    await fs.mkdir(historyDir, { recursive: true });

    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const timestamp = `${String(now.getFullYear()).slice(2)}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const destPath = path.join(historyDir, `v_${timestamp}.md`);

    await fs.copyFile(filePath, destPath);

    // 清理旧版本：只保留最新 MAX_PROMPT_VERSIONS 份
    const files = (await fs.readdir(historyDir))
      .filter(f => f.startsWith('v_') && f.endsWith('.md'))
      .sort(); // 字典序 = 时间序
    if (files.length > MAX_PROMPT_VERSIONS) {
      for (const old of files.slice(0, files.length - MAX_PROMPT_VERSIONS)) {
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
export async function listPromptVersions(agentId: string): Promise<string[]> {
  try {
    const historyDir = getPromptHistoryDir(agentId);
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
 * 读取特定版本的 prompt 内容。
 * versionName 做 sanitize 防路径穿越。
 */
export async function readPromptVersion(
  agentId: string,
  versionName: string,
): Promise<string | undefined> {
  try {
    const safe = versionName.replace(/[^a-zA-Z0-9_]/g, '');
    const filePath = path.join(getPromptHistoryDir(agentId), `${safe}.md`);
    return await fs.readFile(filePath, 'utf-8');
  } catch {
    return undefined;
  }
}

/**
 * 回滚到指定版本。
 * 调用 writePromptFile，自动快照当前版本后再覆盖。
 */
export async function revertToVersion(
  agentId: string,
  versionName: string,
): Promise<boolean> {
  const content = await readPromptVersion(agentId, versionName);
  if (content === undefined) return false;
  await writePromptFile(agentId, content);
  return true;
}

// ── 会话级 prompt override ──

/**
 * 创建会话级 prompt override 工作副本。
 * 将正式版复制到兼容路径 prompts/runtime/{agentId}/{sessionId}.md，返回副本路径。
 *
 * 注意：
 * - 这里目前仍沿用历史物理路径，以避免打断现有行为。
 * - 这层语义应理解为 "session prompt override"，而不是独立的 runtime prompt 产品概念。
 * 用户数据目录不存在时 fallback 到仓库 defaults。
 * 都不存在时返回 undefined。
 */
export async function createSessionPromptOverride(
  agentId: string,
  sessionId: string,
): Promise<string | undefined> {
  // 优先用户数据目录，fallback 到 defaults
  const content = await readPromptFile(agentId) ?? await readBuiltinPrompt(agentId);
  if (content === undefined) return undefined;

  const overridePath = getSessionPromptOverridePath(agentId, sessionId);
  await fs.mkdir(path.dirname(overridePath), { recursive: true });
  await fs.writeFile(overridePath, content, 'utf-8');
  return overridePath;
}

/**
 * 删除会话级 prompt override 工作副本。
 * 文件不存在时静默成功。
 */
export async function deleteSessionPromptOverride(
  agentId: string,
  sessionId: string,
): Promise<void> {
  const paths = [
    getSessionPromptOverridePath(agentId, sessionId),
    getLegacySessionPromptOverridePath(agentId, sessionId),
  ];
  for (const p of paths) {
    try {
      await fs.unlink(p);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }
}

/**
 * @deprecated Prefer createSessionPromptOverride().
 */
export const createRuntimePromptCopy = createSessionPromptOverride;

/**
 * @deprecated Prefer deleteSessionPromptOverride().
 */
export const deleteRuntimePromptCopy = deleteSessionPromptOverride;
