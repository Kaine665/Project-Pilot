/**
 * TodoListLoader — resolves pending todo items into prompt text.
 *
 * Mirrors the original buildTodosSection() logic.
 * ref.id = 'pending' (non-done items) or 'all'.
 */

import type { ResourceLoader, LoaderContext } from '../resource-loader';
import type { ResourceRef, ResolvedResource } from '@/types/resource';
import { getTodosPath, readJsonFile } from '@/lib/file-store';
import type { TodosData } from '@/types';

const PRIORITY_LABELS: Record<string, string> = { high: '高', medium: '中', low: '低' };

export class TodoListLoader implements ResourceLoader {
  readonly type = 'todo-list' as const;

  async resolve(ref: ResourceRef, _ctx: LoaderContext): Promise<ResolvedResource> {
    const data = await readJsonFile<TodosData>(getTodosPath(), { todos: [] });
    const todos = ref.id === 'all'
      ? data.todos
      : data.todos.filter(t => t.status !== 'done');

    if (todos.length === 0) {
      return { ref, content: '', ok: true };
    }

    const lines = todos.map(t => {
      const pri = PRIORITY_LABELS[t.priority] || t.priority;
      const status = t.status === 'in_progress' ? '进行中' : '待处理';
      let line = `- [${status}][${pri}] ${t.title}`;
      if (t.description) line += `\n  ${t.description.replace(/\n/g, '\n  ')}`;
      return line;
    });

    return {
      ref,
      content: `以下是未完成的待办任务（共 ${todos.length} 项）：\n\n${lines.join('\n\n')}`,
      sectionTitle: '当前待办事项',
      ok: true,
    };
  }
}
