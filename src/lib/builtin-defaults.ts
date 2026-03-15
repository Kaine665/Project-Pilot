/**
 * Builtin Defaults — 读取仓库内置的默认 Agent 定义和 Prompt。
 *
 * v1: 通过 fs.readFile 读取 src/data/defaults/ 下的文件
 * v2: 静态 import，编译时嵌入，零运行时 IO
 *     - JSON → TypeScript 原生 import
 *     - .md → 通过 builtin-prompts.ts 导出的字符串常量
 *
 * 为什么改为静态 import？
 * 1. Electron 打包后 process.cwd() 不指向源码目录
 * 2. Next.js standalone 构建不自动包含 fs.readFile 动态读取的文件
 * 3. 静态 import 在所有环境（dev、standalone、Electron exe）下都可靠
 */

import type { Agent } from '@/types';
import builtinAgentsData from '@/data/defaults/agents.json';
import { BUILTIN_PROMPTS, PROMPT_GLOBAL } from '@/data/defaults/builtin-prompts';

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
 * 读取仓库内置的 builtin agent prompt。
 * 从编译时嵌入的 BUILTIN_PROMPTS map 查找。
 * 找不到时返回 undefined。
 */
export async function readBuiltinPrompt(agentId: string): Promise<string | undefined> {
  return BUILTIN_PROMPTS[agentId];
}

/**
 * 读取仓库内置的全局 prompt 模板。
 */
export async function readBuiltinGlobalPrompt(): Promise<string | undefined> {
  return PROMPT_GLOBAL;
}

/** 清除缓存（保留接口兼容，但静态 import 不需要缓存） */
export function invalidateBuiltinCache(): void {
  // no-op: 静态 import 不使用缓存
}
