/**
 * ChangeEmitter — process-level event bus for data mutations.
 *
 * Any module that writes persistent data (docs, todos, shared-memory, prompts, sessions)
 * calls `changeEmitter.emit(...)` after the write succeeds.
 *
 * Subscribers (currently: InboxManager) decide which agents care about each event
 * and route notifications to their inboxes.
 */

export type ChangeEventType =
  | 'doc_updated'
  | 'todo_changed'
  | 'memory_written'
  | 'prompt_updated'
  | 'session_completed';

export interface ChangeEvent {
  type: ChangeEventType;
  /** ID of the changed resource (docId, todoId, memory key, agentId, sessionId) */
  sourceId: string;
  /** Human-readable one-line summary */
  summary: string;
  /** ISO timestamp */
  timestamp: string;
  /** Optional: which project this change belongs to */
  projectKey?: string;
  /** Optional: which agent triggered this change */
  agentId?: string;
}

type ChangeHandler = (event: ChangeEvent) => void;

class ChangeEmitter {
  private handlers: ChangeHandler[] = [];

  subscribe(handler: ChangeHandler): () => void {
    this.handlers.push(handler);
    return () => {
      this.handlers = this.handlers.filter(h => h !== handler);
    };
  }

  emit(event: ChangeEvent): void {
    for (const handler of this.handlers) {
      try {
        handler(event);
      } catch (err) {
        console.error('[ChangeEmitter] handler error:', err);
      }
    }
  }
}

/** Singleton — import and use directly */
export const changeEmitter = new ChangeEmitter();
