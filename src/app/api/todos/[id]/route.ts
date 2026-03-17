import { NextRequest, NextResponse } from 'next/server';
import { getTodosPath, modifyJsonFile } from '@/lib/file-store';
import { apiHandler } from '@/lib/api-handler';
import { badRequest, notFound } from '@/lib/http-error';
import type { TodoSubTask, TodosData, TodoLifecycle } from '@/types';

const DEFAULT: TodosData = { todos: [] };

/**
 * PATCH /api/todos/:id
 * Update a todo item.
 */
export const PATCH = apiHandler(async (
  request: NextRequest,
  { params },
) => {
  const { id } = await params;

  if (!id || !/^todo-\d+$/.test(id)) throw badRequest('Invalid todo id');

  const body = await request.json();
  const { title, description, status, priority, agentId, sessionId, projectKey, dueAt, tags, subTasks, lifecycle, subjectFiles } = body;

  const validStatuses = ['pending', 'in_progress', 'done'];
  const validPriorities = ['high', 'medium', 'low'];
  const validLifecycles: TodoLifecycle[] = ['draft', 'pending', 'active', 'stale', 'done', 'archived'];

  if (title !== undefined && (typeof title !== 'string' || title.length > 500)) throw badRequest('Invalid title');
  if (description !== undefined && typeof description !== 'string') throw badRequest('Invalid description');
  if (status !== undefined && !validStatuses.includes(status)) throw badRequest('Invalid status');
  if (priority !== undefined && !validPriorities.includes(priority)) throw badRequest('Invalid priority');
  if (agentId !== undefined && agentId !== null && typeof agentId !== 'string') throw badRequest('Invalid agentId');
  if (dueAt !== undefined && dueAt !== null && typeof dueAt !== 'string') throw badRequest('Invalid dueAt');
  if (tags !== undefined && !Array.isArray(tags)) throw badRequest('tags must be an array');
  if (subTasks !== undefined && !Array.isArray(subTasks)) throw badRequest('subTasks must be an array');

  let updated: TodosData['todos'][number] | null = null;

  await modifyJsonFile<TodosData>(getTodosPath(), DEFAULT, (data) => ({
    ...data,
    todos: data.todos.map((t) => {
      if (t.id !== id) return t;
      const patched = {
        ...t,
        ...(title !== undefined && { title: title.trim() }),
        ...(description !== undefined && { description: description.trim() || undefined }),
        ...(status !== undefined && { status }),
        ...(priority !== undefined && { priority }),
        ...(agentId !== undefined && { agentId: agentId || undefined }),
        ...(sessionId !== undefined && { sessionId: sessionId || undefined }),
        ...(projectKey !== undefined && { projectKey: projectKey || undefined }),
        ...(dueAt !== undefined && { dueAt: dueAt || undefined }),
        ...(tags !== undefined && { tags: (tags as string[]).filter(Boolean) }),
        ...(subTasks !== undefined && { subTasks: subTasks as TodoSubTask[] }),
        ...(lifecycle !== undefined && validLifecycles.includes(lifecycle) && { lifecycle }),
        ...(subjectFiles !== undefined && { subjectFiles: Array.isArray(subjectFiles) ? subjectFiles.filter((s: unknown) => typeof s === 'string') : undefined }),
        updatedAt: new Date().toISOString(),
      };
      updated = patched;
      return patched;
    }),
  }));

  if (!updated) throw notFound('Todo not found');

  return NextResponse.json(updated);
});

/**
 * DELETE /api/todos/:id
 * Delete a todo item.
 */
export const DELETE = apiHandler(async (
  _request: NextRequest,
  { params },
) => {
  const { id } = await params;

  if (!id || !/^todo-\d+$/.test(id)) throw badRequest('Invalid todo id');

  let found = false;

  await modifyJsonFile<TodosData>(getTodosPath(), DEFAULT, (data) => ({
    ...data,
    todos: data.todos.filter((t) => {
      if (t.id === id) { found = true; return false; }
      return true;
    }),
  }));

  if (!found) throw notFound('Todo not found');

  return NextResponse.json({ ok: true });
});
