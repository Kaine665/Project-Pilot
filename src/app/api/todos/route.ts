import { NextRequest, NextResponse } from 'next/server';
import { getTodosPath, readJsonFile, modifyJsonFile } from '@/lib/file-store';
import { apiHandler } from '@/lib/api-handler';
import { badRequest } from '@/lib/http-error';
import type { TodosData, TodoItem, TodoLifecycle } from '@/types';

const DEFAULT: TodosData = { todos: [] };

/**
 * GET /api/todos?project=xxx
 * Return todo items, optionally filtered by project.
 * - project=xxx → only todos with that projectKey
 * - project=_global → only todos without projectKey
 * - no project param → all todos
 */
export const GET = apiHandler(async (request: NextRequest) => {
  const project = request.nextUrl.searchParams.get('project');
  const data = await readJsonFile<TodosData>(getTodosPath(), DEFAULT);

  let todos = data.todos;
  if (project === '_global') {
    todos = todos.filter((t) => !t.projectKey);
  } else if (project) {
    todos = todos.filter((t) => t.projectKey === project);
  }

  return NextResponse.json({ todos });
});

/**
 * POST /api/todos
 * Create a new todo item.
 * Body: { title, description?, priority?, status?, agentId?, projectKey?, dueAt? }
 */
export const POST = apiHandler(async (request: NextRequest) => {
  const body = await request.json();
  const { title, description, priority, status, agentId, projectKey, dueAt, lifecycle, subjectFiles, contextRefs } = body;

  if (!title || typeof title !== 'string') throw badRequest('title is required');
  if (title.length > 500) throw badRequest('title too long');
  if (description !== undefined && typeof description !== 'string') throw badRequest('description must be a string');
  if (description && description.length > 5000) throw badRequest('description too long');
  if (agentId !== undefined && agentId !== null && typeof agentId !== 'string') throw badRequest('agentId must be a string');
  if (dueAt !== undefined && dueAt !== null && typeof dueAt !== 'string') throw badRequest('dueAt must be a string');

  const validPriorities = ['high', 'medium', 'low'];
  const validStatuses = ['pending', 'in_progress', 'done'];
  const validLifecycles: TodoLifecycle[] = ['draft', 'pending', 'active', 'stale', 'done', 'archived'];
  const todoPriority = validPriorities.includes(priority) ? priority : 'medium';
  const todoStatus = validStatuses.includes(status) ? status : 'pending';
  const todoDueAt = typeof dueAt === 'string' && dueAt.trim() ? dueAt.trim() : undefined;
  // lifecycle 默认从 status 推导
  const defaultLifecycle: TodoLifecycle = todoStatus === 'in_progress' ? 'active' : todoStatus === 'done' ? 'done' : 'pending';
  const todoLifecycle: TodoLifecycle = validLifecycles.includes(lifecycle) ? lifecycle : defaultLifecycle;

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
    lifecycle: todoLifecycle,
    subjectFiles: Array.isArray(subjectFiles) ? subjectFiles.filter((s: unknown) => typeof s === 'string') : undefined,
    contextRefs: Array.isArray(contextRefs) && contextRefs.length > 0 ? contextRefs : undefined,
    createdAt: now,
    updatedAt: now,
  };

  await modifyJsonFile<TodosData>(getTodosPath(), DEFAULT, (data) => ({
    ...data,
    todos: [...data.todos, newTodo],
  }));

  return NextResponse.json(newTodo, { status: 201 });
});
