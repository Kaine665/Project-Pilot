import { NextRequest, NextResponse } from 'next/server';
import { getTodosPath, modifyJsonFile } from '@/lib/file-store';
import type { TodosData } from '@/types';

const DEFAULT: TodosData = { todos: [] };

/**
 * POST /api/todos/batch
 * Batch operations on todo items.
 * Body: { ids: string[], action: 'delete' | 'update', updates?: { status?, priority?, agentId? } }
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { ids, action, updates } = body;

  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: 'ids must be a non-empty array' }, { status: 400 });
  }

  // Validate all ids
  for (const id of ids) {
    if (typeof id !== 'string' || !/^todo-\d+$/.test(id)) {
      return NextResponse.json({ error: `Invalid todo id: ${id}` }, { status: 400 });
    }
  }

  if (action !== 'delete' && action !== 'update') {
    return NextResponse.json({ error: 'action must be "delete" or "update"' }, { status: 400 });
  }

  if (action === 'update') {
    if (!updates || typeof updates !== 'object') {
      return NextResponse.json({ error: 'updates is required for update action' }, { status: 400 });
    }
    const validStatuses = ['pending', 'in_progress', 'done'];
    const validPriorities = ['high', 'medium', 'low'];
    if (updates.status !== undefined && !validStatuses.includes(updates.status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }
    if (updates.priority !== undefined && !validPriorities.includes(updates.priority)) {
      return NextResponse.json({ error: 'Invalid priority' }, { status: 400 });
    }
    if (updates.agentId !== undefined && updates.agentId !== null && typeof updates.agentId !== 'string') {
      return NextResponse.json({ error: 'Invalid agentId' }, { status: 400 });
    }
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
          updatedAt: now,
        };
      }),
    };
  });

  return NextResponse.json({ ok: true, affected });
}
