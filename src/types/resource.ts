/**
 * Unified Resource Reference types.
 *
 * ResourceRef is the single format for referencing any "document" that can be
 * injected into an AI prompt.  Each ResourceType has a matching ResourceLoader
 * registered in the global ResourceRegistry.
 */

// ── Resource Types ──

export type ResourceType =
  | 'context'                     // ContextEntry — expand content inline
  | 'context-index'               // Global context index table (AI cats on demand)
  | 'design-docs-index'           // Design docs index table (AI cats on demand)
  | 'active-tasks'                // Shared active tasks board (parallel awareness)
  | 'available-agents'            // Callable agents list (sub-agent invocation)
  | 'system-prompt'               // Agent system prompt text
  | 'todo-list'                   // Pending todo items
  | 'inline-text'                 // Inline text snippet (content stored in ref)
  | 'knowledge-instructions'      // Static: knowledge save instructions
  | 'doc-save-instructions'       // Static: design doc save instructions
  | 'session-title-instructions'  // Static: session title generation instructions
  | 'flow-context'                // Project flow context (for flow-bound chats)
  | 'reference-turns'             // Imported conversation turns (guest agent)
  | 'suspended-tasks'             // Cross-session suspended tasks board
  | 'suspend-task-instructions'   // Static: suspend task action instructions
  | 'complete-suspended-task-instructions' // Static: complete suspended task (tag-only, no instructions)
  | 'shared-memory'                // Agent shared memory (blackboard)
  | 'global-prompt'                // Global prompt injected into every agent
  | 'project-prompt';              // Project-level prompt injected when projectKey is set

// ── ResourceRef ──

export interface ResourceRef {
  /** Determines which loader handles this ref */
  type: ResourceType;
  /**
   * Resource identifier — semantics depend on type:
   * - context: ContextEntry.id
   * - system-prompt: agentId (or '_fallback' for auto-generated prompt)
   * - todo-list: 'pending' | 'all'
   * - inline-text: arbitrary key
   * - knowledge-instructions / doc-save-instructions / session-title-instructions: '_static'
   * - context-index: '_all'
   * - design-docs-index: '_all'
   * - active-tasks: '_running'
   * - available-agents: '_callable'
   * - shared-memory: '_shared'
   * - flow-context: '_snapshot'
   * - reference-turns: '_imported'
   * - suspended-tasks: '_suspended'
   * - global-prompt: '_global'
   * - project-prompt: '_project'
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
  flowDataPath: string;
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
