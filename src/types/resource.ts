/**
 * Unified Resource Reference types.
 *
 * ResourceRef is the single format for referencing any "document" that can be
 * injected into an AI prompt.  Each ResourceType has a matching ResourceLoader
 * registered in the global ResourceRegistry.
 */

// ── Resource Types ──

export type ResourceType =
  | 'design-docs-index'           // Design docs index table (AI cats on demand)
  | 'active-tasks'                // 并行执行看板 agents/active-tasks.json（非用户 Todo）
  | 'available-agents'            // Callable PP agents + call-agent CLI（全体 Agent 注入）
  | 'system-prompt'               // Agent system prompt text
  | 'todo-list'                   // Pending todo items
  | 'inline-text'                 // Inline text snippet (content stored in ref)
  | 'doc-save-instructions'       // Static: design doc save instructions
  | 'session-title-instructions'  // Static: session title generation instructions
  | 'flow-context'                // Project flow context (for flow-bound chats)
  | 'context'                     // 遗留：旧版 Todo/会话 resourceRefs；无 loader 时会刷屏告警
  | 'reference-turns'             // Imported conversation turns (guest agent)
  | 'shared-memory'                // Agent shared memory (blackboard)
  | 'global-prompt'                // Global prompt injected into every agent
  | 'project-prompt'               // Project-level prompt injected when projectKey is set
  | 'skill'                        // Skill bound to agent (name + description summary)
  | 'agent-data-info'              // Agent private data store directory listing
  | 'prompt-block'                  // Reusable prompt fragment (from prompts/blocks/)
  | 'inbox-digest';                 // Agent inbox — recent changes since last session

// ── ResourceRef ──

export interface ResourceRef {
  /** Determines which loader handles this ref */
  type: ResourceType;
  /**
   * Resource identifier — semantics depend on type:
   * - system-prompt: agentId (or '_fallback' for auto-generated prompt)
   * - todo-list: 'pending' | 'all'
   * - inline-text: arbitrary key
   * - doc-save-instructions / session-title-instructions: '_static'
   * - design-docs-index: '_all'
   * - active-tasks: '_running'（并行执行看板）
   * - available-agents: '_callable'
   * - shared-memory: '_shared'
   * - flow-context: '_snapshot'
   * - context: 遗留类型；若有 inlineContent/content 字段则注入正文
   * - reference-turns: '_imported'
   * - global-prompt: '_global'
   * - project-prompt: '_project'
   * - prompt-block: blockId (maps to prompts/blocks/{blockId}.md)
   * - inbox-digest: '_inbox'
   */
  id: string;
  /** Sort priority — lower values appear earlier in prompt. Default: 50 */
  priority?: number;
  /** Human-readable label for UI display */
  label?: string;
}

// ── Specialised Refs ──

/** Inline text ref — content is stored directly in the ref object */
export interface InlineTextRef extends ResourceRef {
  type: 'inline-text';
  inlineContent: string;
}

/** Flow context ref — carries serialised flow context data */
export interface FlowContextRef extends ResourceRef {
  type: 'flow-context';
  projectKey: string;
  projectName: string;
  /** @deprecated 已无 per-project flow JSON；保留字段以兼容旧会话元数据 */
  flowDataPath?: string;
}

/** Reference turns ref — carries imported conversation turns */
export interface ReferenceTurnsRef extends ResourceRef {
  type: 'reference-turns';
  turns: Array<{ role: 'user' | 'assistant'; content: string }>;
}

// ── Resolved Resource ──

export interface ResolvedResource {
  ref: ResourceRef;
  /** Rendered text to inject into the prompt */
  content: string;
  /** Optional section heading (rendered as ## in prompt) */
  sectionTitle?: string;
  /** Optional preamble text inserted after the ## heading, before the first entry content */
  sectionPreamble?: string;
  /** Whether resolution succeeded */
  ok: boolean;
}
