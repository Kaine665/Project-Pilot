import { Hono } from 'hono';
import { modifyTodosMerged, readTodosMerged } from '@/lib/todo-file-store';
import { HttpError } from '@/lib/http-error';
import { dispatchTodoToAgent } from '@/lib/todo-dispatch';
import { changeEmitter } from '@/lib/change-emitter';
import type { TodosData, TodoItem, TodoLifecycle, TodoSubTask } from '@/types';

const app = new Hono();

const DEFAULT: TodosData = { todos: [] };

// ─── Error handling middleware ───────────────────────────────────

app.onError((err, c) => {
  if (err instanceof HttpError) {
    return c.json(
      { error: err.message, ...(err.code ? { code: err.code } : {}) },
      err.statusCode as 400,
    );
  }

  const message = err instanceof Error ? err.message : 'Internal server error';
  console.error('[todos] Unhandled error:', err);
  return c.json({ error: message }, 500);
});

// ─── GET / — list todos ─────────────────────────────────────────

app.get('/', async (c) => {
  const project = c.req.query('project');
  const data = await readTodosMerged();

  let todos = data.todos;
  if (project === '_global') {
    todos = todos.filter((t) => !t.projectKey);
  } else if (project) {
    // 未写 projectKey 的历史待办在「选中项目」时也应可见，否则修复/绑定项目后列表会突然变空
    todos = todos.filter((t) => !t.projectKey || t.projectKey === project);
  }

  return c.json({ todos });
});

// ─── POST / — create a new todo ─────────────────────────────────

app.post('/', async (c) => {
  const body = await c.req.json();
  const { title, description, priority, status, agentId, projectKey, dueAt, lifecycle, subjectFiles, contextRefs } = body;

  if (!title || typeof title !== 'string') throw new HttpError('title is required', 400);
  if (title.length > 500) throw new HttpError('title too long', 400);
  if (description !== undefined && typeof description !== 'string') throw new HttpError('description must be a string', 400);
  if (description && description.length > 5000) throw new HttpError('description too long', 400);
  if (agentId !== undefined && agentId !== null && typeof agentId !== 'string') throw new HttpError('agentId must be a string', 400);
  if (dueAt !== undefined && dueAt !== null && typeof dueAt !== 'string') throw new HttpError('dueAt must be a string', 400);

  const validPriorities = ['high', 'medium', 'low'];
  const validStatuses = ['pending', 'in_progress', 'done'];
  const validLifecycles: TodoLifecycle[] = ['draft', 'pending', 'active', 'stale', 'done', 'archived'];
  const todoPriority = validPriorities.includes(priority) ? priority : 'medium';
  const todoStatus = validStatuses.includes(status) ? status : 'pending';
  const todoDueAt = typeof dueAt === 'string' && dueAt.trim() ? dueAt.trim() : undefined;
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

  await modifyTodosMerged((data) => ({
    ...data,
    todos: [...data.todos, newTodo],
  }));

  changeEmitter.emit({
    type: 'todo_changed',
    sourceId: newTodo.id,
    summary: `新待办「${newTodo.title}」已创建`,
    timestamp: now,
    projectKey: newTodo.projectKey,
    agentId: newTodo.agentId,
  });

  return c.json(newTodo, 201);
});

// ─── POST /batch — batch operations ─────────────────────────────

app.post('/batch', async (c) => {
  const body = await c.req.json();
  const { ids, action, updates } = body;

  if (!Array.isArray(ids) || ids.length === 0) throw new HttpError('ids must be a non-empty array', 400);

  for (const id of ids) {
    if (typeof id !== 'string' || !/^todo-\d+$/.test(id)) {
      throw new HttpError(`Invalid todo id: ${id}`, 400);
    }
  }

  if (action !== 'delete' && action !== 'update') throw new HttpError('action must be "delete" or "update"', 400);

  if (action === 'update') {
    if (!updates || typeof updates !== 'object') throw new HttpError('updates is required for update action', 400);
    const validStatuses = ['pending', 'in_progress', 'done'];
    const validPriorities = ['high', 'medium', 'low'];
    if (updates.status !== undefined && !validStatuses.includes(updates.status)) throw new HttpError('Invalid status', 400);
    if (updates.priority !== undefined && !validPriorities.includes(updates.priority)) throw new HttpError('Invalid priority', 400);
    if (updates.agentId !== undefined && updates.agentId !== null && typeof updates.agentId !== 'string') throw new HttpError('Invalid agentId', 400);
  }

  const idSet = new Set(ids);
  let affected = 0;

  await modifyTodosMerged((data) => {
    if (action === 'delete') {
      const before = data.todos.length;
      const filtered = data.todos.filter((t) => !idSet.has(t.id));
      affected = before - filtered.length;
      return { ...data, todos: filtered };
    }

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

  return c.json({ ok: true, affected });
});

// ─── PATCH /:id — update a todo ─────────────────────────────────

app.patch('/:id', async (c) => {
  const id = c.req.param('id');

  if (!id || !/^todo-\d+$/.test(id)) throw new HttpError('Invalid todo id', 400);

  const body = await c.req.json();
  const { title, description, status, priority, agentId, sessionId, projectKey, dueAt, tags, subTasks, lifecycle, subjectFiles, contextRefs } = body;

  const validStatuses = ['pending', 'in_progress', 'done'];
  const validPriorities = ['high', 'medium', 'low'];
  const validLifecycles: TodoLifecycle[] = ['draft', 'pending', 'active', 'stale', 'done', 'archived'];

  if (title !== undefined && (typeof title !== 'string' || title.length > 500)) throw new HttpError('Invalid title', 400);
  if (description !== undefined && typeof description !== 'string') throw new HttpError('Invalid description', 400);
  if (status !== undefined && !validStatuses.includes(status)) throw new HttpError('Invalid status', 400);
  if (priority !== undefined && !validPriorities.includes(priority)) throw new HttpError('Invalid priority', 400);
  if (agentId !== undefined && agentId !== null && typeof agentId !== 'string') throw new HttpError('Invalid agentId', 400);
  if (dueAt !== undefined && dueAt !== null && typeof dueAt !== 'string') throw new HttpError('Invalid dueAt', 400);
  if (tags !== undefined && !Array.isArray(tags)) throw new HttpError('tags must be an array', 400);
  if (subTasks !== undefined && !Array.isArray(subTasks)) throw new HttpError('subTasks must be an array', 400);

  let updated: TodosData['todos'][number] | null = null;

  await modifyTodosMerged((data) => ({
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
        ...(contextRefs !== undefined && { contextRefs: Array.isArray(contextRefs) && contextRefs.length > 0 ? contextRefs : undefined }),
        updatedAt: new Date().toISOString(),
      };
      updated = patched;
      return patched;
    }),
  }));

  if (!updated) throw new HttpError('Todo not found', 404);

  const statusLabel = status ? `状态变为 ${status}` : '已更新';
  changeEmitter.emit({
    type: 'todo_changed',
    sourceId: id,
    summary: `待办「${(updated as TodoItem).title}」${statusLabel}`,
    timestamp: new Date().toISOString(),
    projectKey: (updated as TodoItem).projectKey,
    agentId: (updated as TodoItem).agentId,
  });

  return c.json(updated);
});

// ─── DELETE /:id — delete a todo ────────────────────────────────

app.delete('/:id', async (c) => {
  const id = c.req.param('id');

  if (!id || !/^todo-\d+$/.test(id)) throw new HttpError('Invalid todo id', 400);

  let found = false;

  await modifyTodosMerged((data) => ({
    ...data,
    todos: data.todos.filter((t) => {
      if (t.id === id) { found = true; return false; }
      return true;
    }),
  }));

  if (!found) throw new HttpError('Todo not found', 404);

  return c.json({ ok: true });
});

// ─── POST /:id/dispatch — dispatch todo to agent ──────────────

app.post('/:id/dispatch', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({})) as {
    projectKeyOverride?: string;
    initialTitle?: string;
    allowRelaunch?: boolean;
    sourceType?: 'manual' | 'schedule' | 'todo' | 'event';
    sourceId?: string;
  };

  try {
    const result = await dispatchTodoToAgent(id, {
      projectKeyOverride: body.projectKeyOverride,
      initialTitle: body.initialTitle,
      allowRelaunch: body.allowRelaunch,
      sourceType: body.sourceType,
      sourceId: body.sourceId,
    });
    return c.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = msg.includes('does not exist') ? 404 : 400;
    return c.json({ error: msg }, status);
  }
});

export default app;
