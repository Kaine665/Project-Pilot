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
 *   context-index                  → always included (priority 20)
 *   agent.contextIds               → context refs (priority 30 each)
 *   todoRead capability            → todo-list ref (priority 40)
 *   knowledge-instructions         → always included (priority 80)
 *   session-title-instructions     → always included (priority 90)
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

  // Global context index table — always present
  refs.push({
    type: 'context-index',
    id: '_all',
    priority: 20,
    label: '上下文索引',
  });

  // Preloaded context entries
  if (agent.contextIds && agent.contextIds.length > 0) {
    for (const cid of agent.contextIds) {
      refs.push({
        type: 'context',
        id: cid,
        priority: 30,
      });
    }
  }

  // Todo list (if agent has todoRead capability — may not exist on all builds)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((agent.capabilities as any)?.todoRead) {
    refs.push({
      type: 'todo-list',
      id: 'pending',
      priority: 40,
      label: '待办事项',
    });
  }

  // Knowledge save instructions — always present
  refs.push({
    type: 'knowledge-instructions',
    id: '_static',
    priority: 80,
    label: '知识保存指令',
  });

  // Design doc save instructions — always present
  refs.push({
    type: 'doc-save-instructions',
    id: '_static',
    priority: 85,
    label: '设计文档保存指令',
  });

  // Session title instructions — always present
  refs.push({
    type: 'session-title-instructions',
    id: '_static',
    priority: 90,
    label: '会话标题指令',
  });

  return refs;
}
