import { NextRequest, NextResponse } from 'next/server';
import { getTodosPath, readJsonFile, modifyJsonFile } from '@/lib/file-store';
import type { TodosData, TodoItem } from '@/types';

const DEFAULT: TodosData = { todos: [] };

/**
 * GET /api/todos
 * Return all todo items.
 */
export async function GET(request: NextRequest) {
  const data = await readJsonFile<TodosData>(getTodosPath(), DEFAULT);
  const projectKey = request.nextUrl.searchParams.get('project');
  const todos = projectKey
    ? data.todos.filter(t => t.projectKey === projectKey)
    : data.todos;
  return NextResponse.json({ todos });
}

/**
 * POST /api/todos
 * Create a new todo item.
 * Body: { title, description?, priority? }
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { title, description, priority, projectKey } = body;

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

  const validPriorities = ['high', 'medium', 'low'];
  const todoPriority = validPriorities.includes(priority) ? priority : 'medium';

  const now = new Date().toISOString();
  const newTodo: TodoItem = {
    id: `todo-${Date.now()}`,
    title: title.trim(),
    description: description?.trim() || undefined,
    status: 'pending',
    priority: todoPriority,
    projectKey: projectKey || undefined,
    createdAt: now,
    updatedAt: now,
  };

  await modifyJsonFile<TodosData>(getTodosPath(), DEFAULT, (data) => ({
    ...data,
    todos: [...data.todos, newTodo],
  }));

  return NextResponse.json(newTodo, { status: 201 });
}
