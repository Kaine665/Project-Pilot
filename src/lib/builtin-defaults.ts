/**
 * Builtin Defaults — 读取仓库内置的默认 Agent 定义和 Prompt 文件。
 *
 * 文件位置：src/data/defaults/
 *   agents.json        — builtin agent 定义列表
 *   prompts/{agentId}.md — builtin agent 的默认 prompt
 *   prompts/_global.md  — 全局 prompt 默认模板
 *
 * 用户数据目录（~/.project-pilot/data/）的同名文件优先级更高，
 * 会覆盖这里的默认值。合并逻辑在 agents-store.ts 中实现。
 */

import { promises as fs } from 'fs';
import path from 'path';
import type { Agent, AgentsData } from '@/types';

/** src/data/defaults/ 目录的绝对路径 */
const DEFAULTS_DIR = path.join(process.cwd(), 'src', 'data', 'defaults');

/** 缓存：避免每次请求都读文件 */
let cachedBuiltinAgents: Agent[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 60_000; // 1 分钟

/**
 * 读取仓库内置的 builtin agent 定义列表。
 * 从 src/data/defaults/agents.json 加载。
 * 文件不存在时返回空数组（优雅降级）。
 */
export async function readBuiltinAgents(): Promise<Agent[]> {
  const now = Date.now();
  if (cachedBuiltinAgents && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedBuiltinAgents;
  }

  try {
    const filePath = path.join(DEFAULTS_DIR, 'agents.json');
    const raw = await fs.readFile(filePath, 'utf-8');
    const data: AgentsData = JSON.parse(raw);
    cachedBuiltinAgents = data.agents ?? [];
    cacheTimestamp = now;
    return cachedBuiltinAgents;
  } catch {
    // 文件不存在或解析失败 → 优雅降级
    return [];
  }
}

/**
 * 读取仓库内置的 builtin agent prompt 文件。
 * 从 src/data/defaults/prompts/{agentId}.md 加载。
 * 文件不存在时返回 undefined。
 */
export async function readBuiltinPrompt(agentId: string): Promise<string | undefined> {
  try {
    const safe = agentId.replace(/[^a-zA-Z0-9_-]/g, '');
    const filePath = path.join(DEFAULTS_DIR, 'prompts', `${safe}.md`);
    return await fs.readFile(filePath, 'utf-8');
  } catch {
    return undefined;
  }
}

/**
 * 读取仓库内置的全局 prompt 模板。
 * 从 src/data/defaults/prompts/_global.md 加载。
 * 文件不存在时返回 undefined。
 */
export async function readBuiltinGlobalPrompt(): Promise<string | undefined> {
  try {
    const filePath = path.join(DEFAULTS_DIR, 'prompts', '_global.md');
    return await fs.readFile(filePath, 'utf-8');
  } catch {
    return undefined;
  }
}

/** 清除缓存（测试用） */
export function invalidateBuiltinCache(): void {
  cachedBuiltinAgents = null;
  cacheTimestamp = 0;
}
