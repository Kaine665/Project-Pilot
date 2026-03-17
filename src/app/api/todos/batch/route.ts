import { NextRequest, NextResponse } from 'next/server';
import { getTodosPath, modifyJsonFile } from '@/lib/file-store';
import { apiHandler } from '@/lib/api-handler';
import { badRequest } from '@/lib/http-error';
import type { TodosData } from '@/types';

const DEFAULT: TodosData = { todos: [] };

/**
 * POST /api/todos/batch
 * Batch operations on todo items.
 * Body: { ids: string[], action: 'delete' | 'update', updates?: { status?, priority?, agentId? } }
 */
export const POST = apiHandler(async (request: NextRequest) => {
  const body = await request.json();
  const { ids, action, updates } = body;

  if (!Array.isArray(ids) || ids.length === 0) throw badRequest('ids must be a non-empty array');

  // Validate all ids
  for (const id of ids) {
    if (typeof id !== 'string' || !/^todo-\d+$/.test(id)) {
      throw badRequest(`Invalid todo id: ${id}`);
    }
  }

  if (action !== 'delete' && action !== 'update') throw badRequest('action must be "delete" or "update"');

  if (action === 'update') {
    if (!updates || typeof updates !== 'object') throw badRequest('updates is required for update action');
    const validStatuses = ['pending', 'in_progress', 'done'];
    const validPriorities = ['high', 'medium', 'low'];
    if (updates.status !== undefined && !validStatuses.includes(updates.status)) throw badRequest('Invalid status');
    if (updates.priority !== undefined && !validPriorities.includes(updates.priority)) throw badRequest('Invalid priority');
    if (updates.agentId !== undefined && updates.agentId !== null && typeof updates.agentId !== 'string') throw badRequest('Invalid agentId');
  }

  const idSet = new Set(ids);
  let affected = 0;

  await modifyJsonFile<TodosData>(getTodosPath(), DEFAULT, (data) => {
    if (action === 'delete') {
      const before = data.todos.length;
      const filtered = data.todos.filter((t) => !idSet.has(t.id));
      affected = before - filtered.length;
      return { ...data, todos: filtered };
    }

    // action === 'update'
    const now = new Date().toISOString();
    return {
      ...data,
      todos: data.todos.map((t) => {
        if (!idSet.has(t.id)) return t;
        affected++;
        return {
          ...t,
          ...(updates.status !== undefined && { status: updates.status }),
          ...(updates.priority !== undefined && { priority: updates.priority }),
          ...(updates.agentId !== undefined && { agentId: updates.agentId || undefined }),
          ...(updates.sessionId !== undefined && { sessionId: updates.sessionId || undefined }),
          ...(updates.projectKey !== undefined && { projectKey: updates.projectKey || undefined }),
          updatedAt: now,
        };
      }),
    };
  });

  return NextResponse.json({ ok: true, affected });
});
