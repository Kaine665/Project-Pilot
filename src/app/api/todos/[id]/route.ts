import { NextRequest, NextResponse } from 'next/server';
import { getTodosPath, modifyJsonFile } from '@/lib/file-store';
import type { TodosData } from '@/types';

const DEFAULT: TodosData = { todos: [] };

/**
 * PATCH /api/todos/:id
 * Update a todo item (title, description, status, priority).
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  if (!id || !/^todo-\d+$/.test(id)) {
    return NextResponse.json({ error: 'Invalid todo id' }, { status: 400 });
  }

  const body = await request.json();
  const { title, description, status, priority, agentId, projectKey } = body;

  const validStatuses = ['pending', 'in_progress', 'done'];
  const validPriorities = ['high', 'medium', 'low'];

  if (title !== undefined && (typeof title !== 'string' || title.length > 500)) {
    return NextResponse.json({ error: 'Invalid title' }, { status: 400 });
  }
  if (description !== undefined && typeof description !== 'string') {
    return NextResponse.json({ error: 'Invalid description' }, { status: 400 });
  }
  if (status !== undefined && !validStatuses.includes(status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
  }
  if (priority !== undefined && !validPriorities.includes(priority)) {
    return NextResponse.json({ error: 'Invalid priority' }, { status: 400 });
  }
  if (agentId !== undefined && agentId !== null && typeof agentId !== 'string') {
    return NextResponse.json({ error: 'Invalid agentId' }, { status: 400 });
  }

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
        ...(projectKey !== undefined && { projectKey: projectKey || undefined }),
        updatedAt: new Date().toISOString(),
      };
      updated = patched;
      return patched;
    }),
  }));

  if (!updated) {
    return NextResponse.json({ error: 'Todo not found' }, { status: 404 });
  }

  return NextResponse.json(updated);
}

/**
 * DELETE /api/todos/:id
 * Delete a todo item.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  if (!id || !/^todo-\d+$/.test(id)) {
    return NextResponse.json({ error: 'Invalid todo id' }, { status: 400 });
  }

  let found = false;

  await modifyJsonFile<TodosData>(getTodosPath(), DEFAULT, (data) => ({
    ...data,
    todos: data.todos.filter((t) => {
      if (t.id === id) { found = true; return false; }
      return true;
    }),
  }));

  if (!found) {
    return NextResponse.json({ error: 'Todo not found' }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
