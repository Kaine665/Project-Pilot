import { NextRequest, NextResponse } from 'next/server';
import { getTodosPath, readJsonFile, modifyJsonFile } from '@/lib/file-store';
import type { TodosData, TodoItem } from '@/types';

const DEFAULT: TodosData = { todos: [] };

/**
 * GET /api/todos?project=xxx
 * Return todo items, optionally filtered by project.
 * - project=xxx → only todos with that projectKey
 * - project=_global → only todos without projectKey
 * - no project param → all todos
 */
export async function GET(request: NextRequest) {
  const project = request.nextUrl.searchParams.get('project');
  const data = await readJsonFile<TodosData>(getTodosPath(), DEFAULT);

  let todos = data.todos;
  if (project === '_global') {
    todos = todos.filter((t) => !t.projectKey);
  } else if (project) {
    todos = todos.filter((t) => t.projectKey === project);
  }

  return NextResponse.json({ todos });
}

/**
 * POST /api/todos
 * Create a new todo item.
 * Body: { title, description?, priority?, status?, agentId?, projectKey?, dueAt? }
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { title, description, priority, status, agentId, projectKey, dueAt } = body;

  if (!title || typeof title !== 'string') {
    return NextResponse.json({ error: 'title is required' }, { status: 400 });
  }
  if (title.length > 500) {
    return NextResponse.json({ error: 'title too long' }, { status: 400 });
  }
  if (description !== undefined && typeof description !== 'string') {
    return NextResponse.json({ error: 'description must be a string' }, { status: 400 });
  }
  if (description && description.length > 5000) {
    return NextResponse.json({ error: 'description too long' }, { status: 400 });
  }
  if (agentId !== undefined && agentId !== null && typeof agentId !== 'string') {
    return NextResponse.json({ error: 'agentId must be a string' }, { status: 400 });
  }
  if (dueAt !== undefined && dueAt !== null && typeof dueAt !== 'string') {
    return NextResponse.json({ error: 'dueAt must be a string' }, { status: 400 });
  }

  const validPriorities = ['high', 'medium', 'low'];
  const validStatuses = ['pending', 'in_progress', 'done'];
  const todoPriority = validPriorities.includes(priority) ? priority : 'medium';
  const todoStatus = validStatuses.includes(status) ? status : 'pending';
  const todoDueAt = typeof dueAt === 'string' && dueAt.trim() ? dueAt.trim() : undefined;

  const now = new Date().toISOString();
  const newTodo: TodoItem = {
    id: `todo-${Date.now()}`,
    title: title.trim(),
    description: description?.trim() || undefined,
    status: todoStatus,
    priority: todoPriority,
    agentId: (typeof agentId === 'string' && agentId) ? agentId : undefined,
    projectKey: (typeof projectKey === 'string' && projectKey) ? projectKey : undefined,
    dueAt: todoDueAt,
    createdAt: now,
    updatedAt: now,
  };

  await modifyJsonFile<TodosData>(getTodosPath(), DEFAULT, (data) => ({
    ...data,
    todos: [...data.todos, newTodo],
  }));

  return NextResponse.json(newTodo, { status: 201 });
}
