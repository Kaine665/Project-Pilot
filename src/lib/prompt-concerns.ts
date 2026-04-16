/**
 * 系统自动注入内容的 concern 键（声明层）。
 * 唯一事实来源：`docs/design/prompt-system-architecture.md` §3。
 * Phase 1：`buildSystemLevelPrompt()` → SDK `systemPrompt`。
 * Phase 2：各 Loader 只保留本表对应职责，不跨区重复叙述。
 * Phase 3：`PROMPT_PRIORITY` 集中排序；`prompts/**/rules/*.md` 条件注入（globs）。
 */

export const SYSTEM_CONCERN_KEYS = [
  'constraint.safety',
  'strategy.tool-usage',
  'env.data-root',
  'env.api-base',
  'env.runtime-model',
  'env.resource-permissions',
  'runtime.sdk-notice',
  'constraint.ask-user-question',
  /** user prompt：`global-prompt` — 协作原则，不含 call-agent 细节 */
  'strategy.collaboration-principles',
  /** user prompt：`available-agents` — 列表与 CLI，不含协作原则 */
  'catalog.callable-agents',
] as const;

export type SystemConcernKey = (typeof SYSTEM_CONCERN_KEYS)[number];
