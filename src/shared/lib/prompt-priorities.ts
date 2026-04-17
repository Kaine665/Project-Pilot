/**
 * ResourceRef 合并时的 priority（升序 = 越早出现在最终 prompt）。
 * Phase 3：集中管理，避免魔法数字散落。
 *
 * 约定：同数值表示并列优先级，依赖 `resolveAll` 的稳定排序与合并顺序。
 */

/** 默认：与 ResourceRegistry 一致 */
export const PROMPT_PRIORITY_DEFAULT = 50;

export const PROMPT_PRIORITY = {
  SYSTEM_PROMPT: 0,

  GLOBAL_PROMPT: 1,
  PROJECT_PROMPT: 2,
  PROMPT_BLOCK: 3,
  INBOX_DIGEST: 4,
  SESSION_SUPPLEMENTARY: 5,

  AWAIT_SUB_AGENTS_INSTRUCTIONS: 10,

  CODE_CARD_MATCHED: 15,

  CALLABLE_AGENTS: 18,
  ACTIVE_TASKS: 22,
  SHARED_MEMORY: 23,
  DESIGN_DOCS_INDEX: 25,
  DISTILLER_KNOWLEDGE: 26,
  AGENT_DATA_INFO: 28,

  /** Todo contextRefs 未写 priority 时的默认 */
  TODO_CONTEXT_REF: 33,

  /** 与待办列表、Code Card 索引同档（历史兼容） */
  TODO_LIST_OR_CODE_CARD_INDEX: 40,

  SKILL_AUTO: 50,
  SKILL_SESSION: 52,

  REFERENCE_TURNS: 60,
  FLOW_CONTEXT: 70,

  DOC_SAVE_OR_CHECKPOINT: 85,
  CODE_CARD_REMINDER: 90,
  SESSION_TITLE_INSTRUCTIONS: 90,
} as const;
