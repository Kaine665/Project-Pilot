/**
 * Todo Auto-Complete satellite task.
 *
 * After a session completes successfully, checks whether any TodoItem has
 * `sessionId` pointing to this session. If found and still `in_progress`,
 * marks it as `done` automatically — closing the dispatch → run → complete loop.
 *
 * requiresAI = false — purely mechanical file mutation, no AI call needed.
 * priority   = 25   — runs after title generation (10) and before health guard (20)…
 *                      actually priority 25 means it runs after health guard.
 *                      Fine: we only fire on `completed`, health guard only on failed/stopped.
 */

import { getTodosPath, readJsonFile, modifyJsonFile } from '@/lib/file-store';
import type { TodosData } from '@/types';
import type { SatelliteTask, SatelliteContext } from '../types';

const LOG_PREFIX = '[Satellite:todo-auto-complete]';
const DEFAULT: TodosData = { todos: [] };

export const todoAutoCompleteTask: SatelliteTask<void> = {
  id: 'todo-auto-complete',
  description: 'Session 完成后自动将关联的 todo 标记为已完成',
  priority: 25,
  requiresAI: false,

  shouldRun(ctx: SatelliteContext): boolean {
    // Only run when session completed successfully and has a sessionId
    return ctx.runStatus === 'completed' && !!ctx.sessionId;
  },

  // Not called for non-AI tasks — stub required by interface
  buildPrompt(): string {
    return '';
  },

  // Not called for non-AI tasks — stub required by interface
  parseResult(): void {
    return;
  },

  async execute(_result: void, ctx: SatelliteContext): Promise<void> {
    if (!ctx.sessionId) return;

    // Check if any todo links to this session before mutating
    const data = await readJsonFile<TodosData>(getTodosPath(), DEFAULT);
    const linked = data.todos.find(
      (t) => t.sessionId === ctx.sessionId && t.status === 'in_progress',
    );
    if (!linked) return;

    // Mark it done (sync both status and lifecycle)
    await modifyJsonFile<TodosData>(getTodosPath(), DEFAULT, (d) => ({
      ...d,
      todos: d.todos.map((t) => {
        if (t.sessionId === ctx.sessionId && t.status === 'in_progress') {
          return {
            ...t,
            status: 'done' as const,
            lifecycle: 'done' as const,
            activeTaskId: undefined,
            updatedAt: new Date().toISOString(),
          };
        }
        return t;
      }),
    }));

    console.log(
      `${LOG_PREFIX} Auto-completed todo "${linked.id}" ("${linked.title}") for session ${ctx.sessionId}`,
    );
  },
};
