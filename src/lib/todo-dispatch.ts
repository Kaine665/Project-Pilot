import { agentChatManager, generateSessionId, type FlowContext } from '@/lib/agent-chat-manager';
import {
  ensureDataDirV2Migrated,
  getFlowDataPath,
  getFlowIndexPath,
  getTodosPath,
  modifyJsonFile,
  readJsonFile,
} from '@/lib/file-store';
import type { TodoItem, TodosData } from '@/types';
import type { SessionSourceType } from '@/types/agent-chat';

const TODO_DEFAULT: TodosData = { todos: [] };

interface ProjectIndex {
  projects: Array<{ key: string; name: string }>;
}

export interface DispatchTodoOptions {
  projectKeyOverride?: string;
  initialTitle?: string;
  allowRelaunch?: boolean;
  sourceType?: SessionSourceType;
  sourceId?: string;
}

export interface DispatchTodoResult {
  sessionId: string;
  todo: TodoItem;
}

export async function buildFlowContext(projectKey?: string): Promise<FlowContext | undefined> {
  if (!projectKey) return undefined;

  await ensureDataDirV2Migrated();

  let projectName = projectKey;
  try {
    const projectIndex = await readJsonFile<ProjectIndex>(getFlowIndexPath(), { projects: [] });
    const found = projectIndex.projects.find((project) => project.key === projectKey);
    if (found) projectName = found.name;
  } catch {
    // Fall back to projectKey.
  }

  return {
    projectKey,
    projectName,
    flowDataPath: getFlowDataPath(projectKey),
  };
}

export async function readTodoById(todoId: string): Promise<TodoItem | null> {
  const data = await readJsonFile<TodosData>(getTodosPath(), TODO_DEFAULT);
  return data.todos.find((todo) => todo.id === todoId) ?? null;
}

export async function dispatchTodoToAgent(
  todoId: string,
  options: DispatchTodoOptions = {},
): Promise<DispatchTodoResult> {
  const todo = await readTodoById(todoId);
  if (!todo) {
    throw new Error(`Todo ${todoId} does not exist`);
  }
  if (!todo.agentId) {
    throw new Error(`Todo ${todoId} has no assigned agent`);
  }
  if (todo.lifecycle === 'archived') {
    throw new Error(`Todo ${todoId} is archived`);
  }
  if (!options.allowRelaunch) {
    if (todo.sessionId) {
      throw new Error(`Todo ${todoId} already has a linked session`);
    }
    if (todo.status === 'done' || todo.lifecycle === 'done') {
      throw new Error(`Todo ${todoId} is already done`);
    }
  }

  const message = [todo.title, todo.description].filter(Boolean).join('\n\n');
  const sessionId = generateSessionId();
  const flowContext = await buildFlowContext(options.projectKeyOverride ?? todo.projectKey);

  await agentChatManager.start(
    sessionId,
    todo.agentId,
    message,
    flowContext,
    undefined,
    options.initialTitle ?? (todo.title.slice(0, 40) || undefined),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    options.sourceType ?? 'todo',
    options.sourceId ?? todoId,
    todoId,
  );

  const now = new Date().toISOString();
  let updatedTodo: TodoItem | null = null;

  await modifyJsonFile<TodosData>(getTodosPath(), TODO_DEFAULT, (data) => ({
    ...data,
    todos: data.todos.map((item) => {
      if (item.id !== todoId) return item;
      updatedTodo = {
        ...item,
        sessionId,
        status: 'in_progress',
        lifecycle: 'active',
        updatedAt: now,
      };
      return updatedTodo;
    }),
  }));

  if (!updatedTodo) {
    throw new Error(`Todo ${todoId} disappeared during update`);
  }

  return { sessionId, todo: updatedTodo };
}
