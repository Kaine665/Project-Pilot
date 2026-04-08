/**
 * Agent Chat 专用：通过 Claude Agent SDK 进程内 MCP 暴露待办工具，
 * 避免模型用 Bash/curl 调本地 HTTP（易错、依赖端口与引号转义）。
 */

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { modifyTodosMerged, readTodosMerged } from '@/lib/todo-file-store';
import { changeEmitter } from '@/lib/change-emitter';
import type { TodoItem, TodoLifecycle } from '@/types';

export const AGENT_TODO_MCP_SERVER_KEY = 'projectpilot-todos';

const TOOL_NAMES = ['list_todos', 'create_todo', 'update_todo', 'delete_todo'] as const;

/** 供 buildSdkAllowedTools 在受限工具列表中放行 MCP 工具 */
export function getAgentTodoMcpAllowedToolIds(): string[] {
  return TOOL_NAMES.map((n) => `mcp__${AGENT_TODO_MCP_SERVER_KEY}__${n}`);
}

export interface AgentTodoMcpContext {
  /** 当前会话项目；与 TodoListLoader 一致 */
  projectKey?: string;
  /** 当前 Agent id，用于列表过滤与改删权限 */
  agentId: string;
}

function jsonResult(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function errorResult(message: string) {
  return { content: [{ type: 'text' as const, text: message }], isError: true as const };
}

function canAgentModifyTodo(todo: TodoItem, agentId: string): boolean {
  return !todo.agentId || todo.agentId === agentId;
}

function filterListedTodos(todos: TodoItem[], ctx: AgentTodoMcpContext, includeDone: boolean): TodoItem[] {
  let list = includeDone ? [...todos] : todos.filter((t) => t.status !== 'done');
  if (ctx.projectKey) {
    list = list.filter((t) => !t.projectKey || t.projectKey === ctx.projectKey);
  }
  list = list.filter((t) => !t.agentId || t.agentId === ctx.agentId);
  return list;
}

export function createAgentTodoMcpServer(ctx: AgentTodoMcpContext) {
  return createSdkMcpServer({
    name: AGENT_TODO_MCP_SERVER_KEY,
    version: '0.1.0',
    tools: [
      tool(
        'list_todos',
        '列出当前会话可见的待办（已按项目与 Agent 过滤）。默认不含已完成项；需要时设 includeDone。',
        {
          includeDone: z.boolean().optional().describe('为 true 时包含 status=done'),
        },
        async ({ includeDone }) => {
          const data = await readTodosMerged();
          const list = filterListedTodos(data.todos, ctx, !!includeDone);
          return jsonResult({ count: list.length, todos: list });
        },
      ),

      tool(
        'create_todo',
        '新建待办。未指定 agentId 时默认归属当前 Agent；未指定 projectKey 时使用当前会话项目（若有）。',
        {
          title: z.string().min(1).max(500),
          description: z.string().max(5000).optional(),
          priority: z.enum(['high', 'medium', 'low']).optional(),
          status: z.enum(['pending', 'in_progress', 'done']).optional(),
          agentId: z.string().optional(),
          projectKey: z.string().optional(),
        },
        async ({ title, description, priority, status, agentId, projectKey }) => {
          const validPriorities = ['high', 'medium', 'low'] as const;
          const validStatuses = ['pending', 'in_progress', 'done'] as const;
          const todoPriority = priority && validPriorities.includes(priority) ? priority : 'medium';
          const todoStatus = status && validStatuses.includes(status) ? status : 'pending';
          const defaultLifecycle: TodoLifecycle =
            todoStatus === 'in_progress' ? 'active' : todoStatus === 'done' ? 'done' : 'pending';

          const now = new Date().toISOString();
          const newTodo: TodoItem = {
            id: `todo-${Date.now()}`,
            title: title.trim(),
            description: description?.trim() || undefined,
            status: todoStatus,
            priority: todoPriority,
            agentId: (typeof agentId === 'string' && agentId.trim()) ? agentId.trim() : ctx.agentId,
            projectKey:
              (typeof projectKey === 'string' && projectKey.trim())
                ? projectKey.trim()
                : (ctx.projectKey?.trim() || undefined),
            lifecycle: defaultLifecycle,
            createdAt: now,
            updatedAt: now,
          };

          await modifyTodosMerged((d) => ({
            ...d,
            todos: [...d.todos, newTodo],
          }));

          changeEmitter.emit({
            type: 'todo_changed',
            sourceId: newTodo.id,
            summary: `新待办「${newTodo.title}」已创建`,
            timestamp: now,
            projectKey: newTodo.projectKey,
            agentId: newTodo.agentId,
          });

          return jsonResult(newTodo);
        },
      ),

      tool(
        'update_todo',
        '按 id 更新待办。仅可修改分配给当前 Agent 或未分配 agent 的条目。',
        {
          id: z.string().describe('todo-{timestamp}'),
          title: z.string().max(500).optional(),
          description: z.string().max(5000).optional(),
          status: z.enum(['pending', 'in_progress', 'done']).optional(),
          priority: z.enum(['high', 'medium', 'low']).optional(),
          agentId: z.string().optional(),
          sessionId: z.string().optional(),
          projectKey: z.string().optional(),
          dueAt: z.string().optional(),
          lifecycle: z
            .enum(['draft', 'pending', 'active', 'stale', 'done', 'archived'])
            .optional(),
        },
        async (patch) => {
          const { id, ...rest } = patch;
          if (!id || !/^todo-\d+$/.test(id)) {
            return errorResult('Invalid todo id');
          }

          const validLifecycles: TodoLifecycle[] = ['draft', 'pending', 'active', 'stale', 'done', 'archived'];
          let didPatch = false;

          const afterData = await modifyTodosMerged((data) => {
            const idx = data.todos.findIndex((t) => t.id === id);
            if (idx < 0) return data;
            const t = data.todos[idx];
            if (!canAgentModifyTodo(t, ctx.agentId)) {
              return data;
            }

            didPatch = true;
            const next: TodoItem = {
              ...t,
              ...(rest.title !== undefined && { title: rest.title.trim() }),
              ...(rest.description !== undefined && { description: rest.description.trim() || undefined }),
              ...(rest.status !== undefined && { status: rest.status }),
              ...(rest.priority !== undefined && { priority: rest.priority }),
              ...(rest.agentId !== undefined && { agentId: rest.agentId || undefined }),
              ...(rest.sessionId !== undefined && { sessionId: rest.sessionId || undefined }),
              ...(rest.projectKey !== undefined && { projectKey: rest.projectKey || undefined }),
              ...(rest.dueAt !== undefined && { dueAt: rest.dueAt || undefined }),
              ...(rest.lifecycle !== undefined && validLifecycles.includes(rest.lifecycle)
                ? { lifecycle: rest.lifecycle }
                : {}),
              updatedAt: new Date().toISOString(),
            };
            const todos = [...data.todos];
            todos[idx] = next;
            return { ...data, todos };
          });

          if (!didPatch) {
            return errorResult('Todo not found or not allowed for this agent');
          }

          const updated = afterData.todos.find((t) => t.id === id);
          if (!updated) {
            return errorResult('Todo not found or not allowed for this agent');
          }

          const statusLabel = patch.status ? `状态变为 ${patch.status}` : '已更新';
          changeEmitter.emit({
            type: 'todo_changed',
            sourceId: id,
            summary: `待办「${updated.title}」${statusLabel}`,
            timestamp: new Date().toISOString(),
            projectKey: updated.projectKey,
            agentId: updated.agentId,
          });

          return jsonResult(updated);
        },
      ),

      tool(
        'delete_todo',
        '按 id 删除待办。仅可删除分配给当前 Agent 或未分配 agent 的条目。',
        {
          id: z.string().describe('todo-{timestamp}'),
        },
        async ({ id }) => {
          if (!id || !/^todo-\d+$/.test(id)) {
            return errorResult('Invalid todo id');
          }

          let title = '';
          let projectKey: string | undefined;
          let agentId: string | undefined;

          await modifyTodosMerged((data) => {
            const t = data.todos.find((x) => x.id === id);
            if (!t) return data;
            if (!canAgentModifyTodo(t, ctx.agentId)) return data;
            title = t.title;
            projectKey = t.projectKey;
            agentId = t.agentId;
            return { ...data, todos: data.todos.filter((x) => x.id !== id) };
          });

          if (!title) {
            return errorResult('Todo not found or not allowed for this agent');
          }

          changeEmitter.emit({
            type: 'todo_changed',
            sourceId: id,
            summary: `待办「${title}」已删除`,
            timestamp: new Date().toISOString(),
            projectKey,
            agentId,
          });

          return jsonResult({ ok: true, id });
        },
      ),
    ],
  });
}
