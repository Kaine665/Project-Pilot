/**
 * Builtin Defaults — 读取仓库内置的默认 Agent 定义和 Prompt。
 *
 * - JSON（agents）：静态 import，编译时嵌入
 * - 内置提示词：种子在 `src/data/defaults/prompts/builtin/`（含 `manifest.json` version），启动时按版本同步到
 *   `{DATA_DIR}/prompts/builtin/`（升级前备份到 `.backups/`）；运行时只读数据目录（生产包见 `dist/server/builtin-prompt-seeds/`）
 */

import { readFile } from 'fs/promises';
import type { Agent } from '@/types';
import builtinAgentsData from '@/data/defaults/agents.json';
import {
  BUILTIN_AGENT_PROMPT_IDS,
  ensureBuiltinAgentPromptOnDisk,
  ensureBuiltinGlobalPromptOnDisk,
} from '@/lib/builtin-prompt-materialize';
import { getBuiltinAgentPromptPath, getBuiltinGlobalPromptPath } from '@/lib/file-store';

const MAX_BUILTIN_READ = 10 * 1024 * 1024;

/**
 * 读取仓库内置的 builtin agent 定义列表。
 * 现在是同步的（数据编译时已嵌入），但保持 async 签名以兼容现有调用方。
 */
export async function readBuiltinAgents(): Promise<Agent[]> {
  return (builtinAgentsData as { agents: Agent[] }).agents ?? [];
}

/**
 * 同步版本，供不能 await 的场景使用。
 */
export function readBuiltinAgentsSync(): Agent[] {
  return (builtinAgentsData as { agents: Agent[] }).agents ?? [];
}

/**
 * 读取数据目录中的内置 Agent 默认提示词（`prompts/builtin/agents/<id>.md`）。
 * 文件缺失时会从安装种子复制后再读。
 */
export async function readBuiltinPrompt(agentId: string): Promise<string | undefined> {
  if (!(BUILTIN_AGENT_PROMPT_IDS as readonly string[]).includes(agentId)) {
    return undefined;
  }
  await ensureBuiltinAgentPromptOnDisk(agentId);
  const filePath = getBuiltinAgentPromptPath(agentId);
  try {
    const buf = await readFile(filePath);
    if (buf.length > MAX_BUILTIN_READ) {
      throw new Error(`Builtin prompt file too large: ${filePath}`);
    }
    return buf.toString('utf-8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw e;
  }
}

/**
 * 读取数据目录中的内置全局提示词模板（`prompts/builtin/global.md`）。
 */
export async function readBuiltinGlobalPrompt(): Promise<string | undefined> {
  await ensureBuiltinGlobalPromptOnDisk();
  const filePath = getBuiltinGlobalPromptPath();
  try {
    const buf = await readFile(filePath);
    if (buf.length > MAX_BUILTIN_READ) {
      throw new Error(`Builtin global prompt too large: ${filePath}`);
    }
    return buf.toString('utf-8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw e;
  }
}

/** 清除缓存（保留接口兼容；现每次从磁盘读取，无进程内缓存） */
export function invalidateBuiltinCache(): void {
  // no-op
}
