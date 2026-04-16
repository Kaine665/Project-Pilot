/**
 * Resource migration — converts legacy Agent fields (contextIds, etc.)
 * into ResourceRef[] at runtime without modifying disk data.
 */

import type { Agent } from '@/types';
import type { ResourceRef } from '@/types/resource';
import { PROMPT_PRIORITY } from '@/lib/prompt-priorities';

/** 所有 Agent 提示词均注入：Bash + call-agent 可委派给其他 PP Agent（与 capabilities.subAgent 无关） */
export const CALLABLE_AGENTS_RESOURCE_REF: ResourceRef = {
  type: 'available-agents',
  id: '_callable',
  priority: PROMPT_PRIORITY.CALLABLE_AGENTS,
  label: '可调用 Agent',
};

/**
 * Build a default ResourceRef[] from an Agent that has no `defaultResources`.
 *
 * Maps the legacy fields:
 *   agent.systemPrompt / fallback  → system-prompt ref
 *   design-docs-index              → always included
 *   available-agents               → always included
 *   todoRead capability            → todo-list ref
 *   doc-save-instructions          → always included
 */
export function migrateAgentToResources(agent: Agent): ResourceRef[] {
  const refs: ResourceRef[] = [];

  // System prompt — always present
  refs.push({
    type: 'system-prompt',
    id: agent.id,
    priority: PROMPT_PRIORITY.SYSTEM_PROMPT,
    label: '系统提示词',
  });

  // Design docs index table — always present
  refs.push({
    type: 'design-docs-index',
    id: '_all',
    priority: PROMPT_PRIORITY.DESIGN_DOCS_INDEX,
    label: '设计文档索引',
  });

  // Distiller 提炼知识（有 projectKey 时 loader 才输出内容）
  refs.push({
    type: 'distiller-knowledge',
    id: '_project',
    priority: PROMPT_PRIORITY.DISTILLER_KNOWLEDGE,
    label: '产物 · 提炼知识摘要',
  });

  // 并行执行看板（agents/active-tasks.json）— always present
  refs.push({
    type: 'active-tasks',
    id: '_running',
    priority: PROMPT_PRIORITY.ACTIVE_TASKS,
    label: '并行执行看板',
  });

  // Shared memory (blackboard) — always present
  refs.push({
    type: 'shared-memory',
    id: '_shared',
    priority: PROMPT_PRIORITY.SHARED_MEMORY,
    label: 'Agent 共享记忆',
  });

  refs.push(CALLABLE_AGENTS_RESOURCE_REF);

  // Agent private data store (if agent has dataStore capability)
  if (agent.capabilities?.dataStore) {
    refs.push({
      type: 'agent-data-info',
      id: agent.id,
      priority: PROMPT_PRIORITY.AGENT_DATA_INFO,
      label: 'Agent 私有数据',
    });
  }

  // Todo list (if agent has todoRead capability)
  if (agent.capabilities?.todoRead) {
    refs.push({
      type: 'todo-list',
      id: 'pending',
      priority: PROMPT_PRIORITY.TODO_LIST_OR_CODE_CARD_INDEX,
      label: '待办事项',
    });
  }

  // Design doc save instructions — always present
  refs.push({
    type: 'doc-save-instructions',
    id: '_static',
    priority: PROMPT_PRIORITY.DOC_SAVE_OR_CHECKPOINT,
    label: '设计文档保存指令',
  });

  // session-title-instructions 已移除：标题由 session-title-generator 异步生成

  return refs;
}
