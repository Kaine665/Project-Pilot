/**
 * 内置 Agent 定义 — 共享模块。
 *
 * agents API、settings clear/import 等路由都需要引用这里的 DEFAULT_AGENTS，
 * 确保内置 agent 在任何数据操作后都不会丢失。
 *
 * v2: DEFAULT_AGENTS 从 src/data/defaults/agents.json 文件中读取，
 * 不再在代码中硬编码 agent 定义和 prompt 内容。
 * 同步版本 DEFAULT_AGENTS 在模块加载时初始化为空数组，
 * 异步版本 getDefaultAgents() 用于需要完整数据的场景。
 */

import type { Agent } from '@/types';
import { readBuiltinAgents } from './builtin-defaults';

export const BUTLER_AGENT_ID = 'agent-builtin-butler';

/**
 * 同步常量：初始为空数组，由 initDefaultAgents() 填充。
 * 供 writeAgentsData() 的数量守卫使用（只需要 .length）。
 *
 * 注意：需要在应用启动时（或首次使用前）调用 initDefaultAgents()。
 */
export let DEFAULT_AGENTS: Agent[] = [];

/**
 * 异步初始化 DEFAULT_AGENTS。
 * 首次调用后会缓存结果，后续调用直接返回。
 */
let _initPromise: Promise<Agent[]> | null = null;

export function initDefaultAgents(): Promise<Agent[]> {
  if (!_initPromise) {
    _initPromise = readBuiltinAgents().then((agents) => {
      DEFAULT_AGENTS = agents;
      return agents;
    });
  }
  return _initPromise;
}

/**
 * 获取内置 Agent 列表（异步版本）。
 * 如果尚未初始化，会自动触发初始化。
 */
export async function getDefaultAgents(): Promise<Agent[]> {
  if (DEFAULT_AGENTS.length > 0) return DEFAULT_AGENTS;
  return initDefaultAgents();
}
