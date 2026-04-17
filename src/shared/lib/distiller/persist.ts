/**
 * Distiller v0 — 将提炼结果写入 documents/ 与 todos/。
 */

import { changeEmitter } from '@/lib/change-emitter';
import { createDocumentEntry } from '@/lib/documents-crud';
import { modifyTodosMerged } from '@/lib/todo-file-store';
import type { TodoItem } from '@/types';
import type { DistillerInput, DistillerOutput } from './types';

const LOG_PREFIX = '[Distiller]';

function makeTodoId(): string {
  return `todo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 持久化提炼结果；单条失败不中断其余条目 */
export async function persistDistillerOutput(
  input: DistillerInput,
  output: DistillerOutput,
): Promise<void> {
  const projectKey = input.projectKey?.trim() || '_global';
  let knowledgeOk = 0;
  let todosOk = 0;

  for (const item of output.knowledge) {
    try {
      await createDocumentEntry({
        projectKey,
        title: item.title,
        content: `<!-- distiller:${input.sessionId} -->\n\n${item.content}`,
        documentKind: 'knowledge',
        tags: ['distiller', item.type],
        status: 'draft',
      });
      knowledgeOk++;
    } catch (e) {
      console.warn(`${LOG_PREFIX} createDocumentEntry failed:`, e);
    }
  }

  for (const item of output.todos) {
    try {
      const now = new Date().toISOString();
      const newTodo: TodoItem = {
        id: makeTodoId(),
        title: item.title,
        description: item.description?.trim() || undefined,
        status: 'pending',
        priority: item.priority ?? 'medium',
        projectKey: input.projectKey?.trim() || undefined,
        sessionId: input.sessionId,
        tags: ['distiller'],
        createdAt: now,
        updatedAt: now,
      };

      await modifyTodosMerged((data) => ({
        ...data,
        todos: [...data.todos, newTodo],
      }));

      changeEmitter.emit({
        type: 'todo_changed',
        sourceId: newTodo.id,
        summary: `产物提炼 · 新待办「${newTodo.title}」`,
        timestamp: now,
        projectKey: newTodo.projectKey,
        agentId: input.agentId,
      });
      todosOk++;
    } catch (e) {
      console.warn(`${LOG_PREFIX} todo persist failed:`, e);
    }
  }

  const totalK = output.knowledge.length;
  const totalT = output.todos.length;
  if (totalK === 0 && totalT === 0) {
    console.log(`${LOG_PREFIX} sessionId=${input.sessionId}: extracted nothing`);
  } else {
    console.log(
      `${LOG_PREFIX} sessionId=${input.sessionId}: ${knowledgeOk}/${totalK} knowledge, ${todosOk}/${totalT} todos written`,
    );
  }
}
