/**
 * Agent systemPrompt 外置文件 I/O。
 *
 * 每个 agent 的 systemPrompt 存储在 prompts/{agentId}.md，
 * agents.json 只保留元数据，不再内联 systemPrompt。
 */

import { promises as fs } from 'fs';
import { getPromptsDir, getPromptFilePath } from './file-store';

/** 最大 prompt 文件大小：10MB */
const MAX_PROMPT_SIZE = 10 * 1024 * 1024;

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
 * 自动创建 prompts/ 目录。
 */
export async function writePromptFile(agentId: string, content: string): Promise<void> {
  await fs.mkdir(getPromptsDir(), { recursive: true });
  await fs.writeFile(getPromptFilePath(agentId), content, 'utf-8');
}

/**
 * 删除 agent 的 prompt 文件。
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
}

/**
 * 解析 agent 的最终 systemPrompt。
 * 优先级：prompts/{agentId}.md 文件 > 内联 systemPrompt。
 */
export async function resolveSystemPrompt(
  agentId: string,
  inlinePrompt?: string,
): Promise<string | undefined> {
  const fromFile = await readPromptFile(agentId);
  return fromFile ?? inlinePrompt;
}
