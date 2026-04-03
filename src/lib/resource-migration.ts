/**
 * Resource migration — converts legacy Agent fields (contextIds, etc.)
 * into ResourceRef[] at runtime without modifying disk data.
 */

import type { Agent } from '@/types';
import type { ResourceRef } from '@/types/resource';

/**
 * Build a default ResourceRef[] from an Agent that has no `defaultResources`.
 *
 * Maps the legacy fields:
 *   agent.systemPrompt / fallback  → system-prompt ref (priority 0)
 *   design-docs-index              → always included (priority 25)
 *   subAgent capability             → available-agents ref (priority 18)
 *   todoRead capability            → todo-list ref (priority 40)
 *   doc-save-instructions          → always included (priority 85)
 */
export function migrateAgentToResources(agent: Agent): ResourceRef[] {
  const refs: ResourceRef[] = [];

  // System prompt — always present
  refs.push({
    type: 'system-prompt',
    id: agent.id,
    priority: 0,
    label: '系统提示词',
  });

  // Design docs index table — always present
  refs.push({
    type: 'design-docs-index',
    id: '_all',
    priority: 25,
    label: '设计文档索引',
  });

  // 并行执行看板（agents/active-tasks.json）— always present
  refs.push({
    type: 'active-tasks',
    id: '_running',
    priority: 22,
    label: '并行执行看板',
  });

  // Shared memory (blackboard) — always present
  refs.push({
    type: 'shared-memory',
    id: '_shared',
    priority: 23,
    label: 'Agent 共享记忆',
  });

  // Available agents list (only when agent has subAgent capability)
  if (agent.capabilities?.subAgent) {
    refs.push({
      type: 'available-agents',
      id: '_callable',
      priority: 18,
      label: '可调用 Agent',
    });
  }

  // Agent private data store (if agent has dataStore capability)
  if (agent.capabilities?.dataStore) {
    refs.push({
      type: 'agent-data-info',
      id: agent.id,
      priority: 28,
      label: 'Agent 私有数据',
    });
  }

  // Todo list (if agent has todoRead capability)
  if (agent.capabilities?.todoRead) {
    refs.push({
      type: 'todo-list',
      id: 'pending',
      priority: 40,
      label: '待办事项',
    });
  }

  // Design doc save instructions — always present
  refs.push({
    type: 'doc-save-instructions',
    id: '_static',
    priority: 85,
    label: '设计文档保存指令',
  });

  // session-title-instructions 已移除：标题由 session-title-generator 异步生成

  return refs;
}
