/**
 * 从数据目录物理删除与某一 Agent 相关的常见产物（提示词、片段目录、工作区、Agent 级技能等）。
 * 不删除会话/消息（sessions/）；需要时由用户另行清理。
 */

import { promises as fs } from 'fs';
import path from 'path';
import { deletePromptFile } from '@/lib/agent-prompt-store';
import {
  getAgentDataPath,
  getLegacyAgentDataPath,
  getPromptsDir,
  getSkillsDir,
} from '@/lib/file-store';

/** 已从产品移除的内置 Agent；读盘合并时删注册表行并清磁盘 */
export const RETIRED_BUILTIN_AGENT_IDS = new Set([
  // 旧版「ProjectPilot 任务执行者」/ Task Worker（registry id）
  'agent-builtin-task-worker',
  // 旧版「团队管理员」内置 Agent（registry id）
  'agent-builtin-manager',
]);

/**
 * 与 {@link RETIRED_BUILTIN_AGENT_IDS} 对应的稳定 slug；用于 id 被篡改或复制后仍带内置标记的残留行。
 * 仅当 `builtIn === true` 时才按 slug 剔除，避免误删用户自定义 Agent。
 */
export const RETIRED_BUILTIN_SLUGS = new Set(['task-worker', 'manager']);

function safeAgentSeg(agentId: string): string {
  return agentId.replace(/[^a-zA-Z0-9_-]/g, '');
}

export async function physicallyPurgeAgentDiskData(agentId: string): Promise<void> {
  const safe = safeAgentSeg(agentId);
  if (!safe) return;

  await deletePromptFile(agentId).catch(() => {});

  const promptsDir = getPromptsDir();
  const paths = [
    path.join(promptsDir, 'agents', `${safe}.d`),
    path.join(promptsDir, 'agents', `${safe}.runtime`),
    path.join(promptsDir, `${safe}.md`),
    path.join(promptsDir, `${safe}.runtime`),
    getAgentDataPath(agentId),
    getLegacyAgentDataPath(agentId),
    path.join(getSkillsDir(), '_agents', safe),
  ];

  for (const p of paths) {
    try {
      await fs.rm(p, { recursive: true, force: true });
    } catch {
      /* 不存在或已删 */
    }
  }
}
