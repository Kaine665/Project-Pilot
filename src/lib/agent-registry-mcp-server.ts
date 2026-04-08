/**
 * Agent Chat：共享记忆、并行执行看板、Agent 注册表的进程内 MCP（结构化工具）。
 * 需 capabilities.registryMcp；待办仍由 projectpilot-todos 负责。
 */

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import {
  listActiveTasks,
  listRunningTasks,
  registerTask,
  completeTask,
  failTask,
  heartbeatTask,
  pruneTasks,
  type ActiveTaskAgentType,
} from '@/lib/active-tasks';
import {
  writeMemory,
  readMemory,
  listMemories,
  deleteMemory,
  pruneExpired,
} from '@/lib/shared-memory';
import { listAgents, getAgentById, updateAgent, type AgentMutationInput } from '@/lib/agents-store';
import type { AgentCapabilities, ProviderId } from '@/types';
import { DEFAULT_AGENT_CAPABILITIES } from '@/types';

export const AGENT_REGISTRY_MCP_SERVER_KEY = 'projectpilot-registry';

const TOOL_NAMES = [
  'memory_list',
  'memory_read',
  'memory_write',
  'memory_delete',
  'memory_prune_expired',
  'at_list_running',
  'at_list_all',
  'at_register',
  'at_complete',
  'at_fail',
  'at_heartbeat',
  'at_prune_finished',
  'reg_list_agents',
  'reg_get_agent',
  'reg_update_my_agent',
] as const;

export function getAgentRegistryMcpAllowedToolIds(): string[] {
  return TOOL_NAMES.map((n) => `mcp__${AGENT_REGISTRY_MCP_SERVER_KEY}__${n}`);
}

export interface AgentRegistryMcpContext {
  agentId: string;
  projectKey?: string;
  /** 登记并行任务时默认绑定 */
  sessionId?: string;
}

function jsonResult(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function errorResult(message: string) {
  return { content: [{ type: 'text' as const, text: message }], isError: true as const };
}

const memoryScopeSchema = z.enum(['project', 'global']);

function resolveMemoryProjectKey(
  ctx: AgentRegistryMcpContext,
  scope: 'project' | 'global',
): string | undefined {
  if (scope === 'global') return undefined;
  if (!ctx.projectKey?.trim()) {
    throw new Error('当前会话无项目上下文，无法在 project 范围操作共享记忆，请使用 scope=global');
  }
  return ctx.projectKey.trim();
}

function canMutateActiveTask(taskAgentId: string | undefined, ctxAgentId: string): boolean {
  return !taskAgentId || taskAgentId === ctxAgentId;
}

const capabilitiesPatchSchema = z
  .object({
    bash: z.boolean().optional(),
    fileAccess: z.boolean().optional(),
    web: z.boolean().optional(),
    subAgent: z.boolean().optional(),
    skipReview: z.boolean().optional(),
    todoRead: z.boolean().optional(),
    exposePromptPath: z.boolean().optional(),
    dataStore: z.boolean().optional(),
    registryMcp: z.boolean().optional(),
    documentsMcp: z.boolean().optional(),
  })
  .optional();

export function createAgentRegistryMcpServer(ctx: AgentRegistryMcpContext) {
  return createSdkMcpServer({
    name: AGENT_REGISTRY_MCP_SERVER_KEY,
    version: '0.1.0',
    tools: [
      tool(
        'memory_list',
        '列出共享记忆。scope=project 需会话有 projectKey；global=仅全局；both=两者（有项目时）。',
        {
          scope: z.enum(['project', 'global', 'both']).optional().describe('默认 both（无项目时等同 global）'),
        },
        async ({ scope: scopeArg }) => {
          const scope = scopeArg ?? 'both';
          try {
            const pk = ctx.projectKey?.trim();
            if (scope === 'global') {
              return jsonResult({ scope: 'global', entries: await listMemories(undefined) });
            }
            if (scope === 'project') {
              const key = resolveMemoryProjectKey(ctx, 'project');
              return jsonResult({ scope: 'project', projectKey: key, entries: await listMemories(key) });
            }
            // both
            const globalEntries = await listMemories(undefined);
            if (!pk) {
              return jsonResult({ global: globalEntries, project: [] as const });
            }
            return jsonResult({
              global: globalEntries,
              project: await listMemories(pk),
              projectKey: pk,
            });
          } catch (e) {
            return errorResult(e instanceof Error ? e.message : String(e));
          }
        },
      ),

      tool(
        'memory_read',
        '读取一条共享记忆（按 key）。',
        {
          key: z.string().min(1),
          scope: memoryScopeSchema,
        },
        async ({ key, scope }) => {
          try {
            const pk = resolveMemoryProjectKey(ctx, scope);
            const entry = await readMemory(key, pk);
            if (!entry) return errorResult('未找到或已过期');
            return jsonResult(entry);
          } catch (e) {
            return errorResult(e instanceof Error ? e.message : String(e));
          }
        },
      ),

      tool(
        'memory_write',
        '写入或覆盖共享记忆。author 默认当前 Agent ID。',
        {
          key: z.string().min(1).max(200),
          value: z.string().max(50_000),
          scope: memoryScopeSchema,
          ttlHours: z.number().min(1).max(8760).optional(),
        },
        async ({ key, value, scope, ttlHours }) => {
          try {
            const pk = resolveMemoryProjectKey(ctx, scope);
            const entry = await writeMemory({
              key,
              value,
              author: ctx.agentId,
              projectKey: pk,
              ...(ttlHours !== undefined ? { ttlHours } : {}),
            });
            return jsonResult(entry);
          } catch (e) {
            return errorResult(e instanceof Error ? e.message : String(e));
          }
        },
      ),

      tool(
        'memory_delete',
        '删除一条共享记忆。',
        {
          key: z.string().min(1),
          scope: memoryScopeSchema,
        },
        async ({ key, scope }) => {
          try {
            const pk = resolveMemoryProjectKey(ctx, scope);
            const ok = await deleteMemory(key, pk);
            return jsonResult({ ok });
          } catch (e) {
            return errorResult(e instanceof Error ? e.message : String(e));
          }
        },
      ),

      tool(
        'memory_prune_expired',
        '清理所有共享记忆文件中已过期的条目。',
        {},
        async () => {
          const n = await pruneExpired();
          return jsonResult({ pruned: n });
        },
      ),

      tool(
        'at_list_running',
        '列出当前并行看板上「运行中且未心跳过期」的任务。',
        {},
        async () => {
          const tasks = await listRunningTasks();
          return jsonResult({ count: tasks.length, tasks });
        },
      ),

      tool(
        'at_list_all',
        '列出看板文件中的全部任务记录（含已完成/失败，可能较长）。',
        {},
        async () => {
          const tasks = await listActiveTasks();
          return jsonResult({ count: tasks.length, tasks });
        },
      ),

      tool(
        'at_register',
        '登记并行执行任务。agentId/sessionId/projectKey 默认绑定当前会话。',
        {
          title: z.string().min(1).max(500),
          agentType: z.enum(['self-dev', 'task-worker', 'agent-chat']).optional(),
          scope: z.array(z.string()).optional(),
          branch: z.string().optional(),
          todoId: z.string().optional(),
          sessionId: z.string().optional().describe('默认当前会话；可覆盖'),
        },
        async ({ title, agentType, scope, branch, todoId, sessionId }) => {
          const entry = await registerTask({
            agentType: (agentType ?? 'agent-chat') as ActiveTaskAgentType,
            agentId: ctx.agentId,
            projectKey: ctx.projectKey?.trim() || undefined,
            title,
            scope,
            branch,
            sessionId: sessionId?.trim() || ctx.sessionId,
            todoId: todoId?.trim() || undefined,
          });
          return jsonResult(entry);
        },
      ),

      tool(
        'at_complete',
        '将运行中的并行任务标记为完成（仅可操作 agentId 与当前 Agent 一致或未填 agentId 的条目）。',
        { taskId: z.string().min(1) },
        async ({ taskId }) => {
          const tasks = await listActiveTasks();
          const t = tasks.find((x) => x.id === taskId);
          if (!t) return errorResult('任务不存在');
          if (!canMutateActiveTask(t.agentId, ctx.agentId)) {
            return errorResult('无权操作其他 Agent 登记的任务');
          }
          const ok = await completeTask(taskId);
          return jsonResult({ ok });
        },
      ),

      tool(
        'at_fail',
        '将运行中的并行任务标记为失败。',
        { taskId: z.string().min(1) },
        async ({ taskId }) => {
          const tasks = await listActiveTasks();
          const t = tasks.find((x) => x.id === taskId);
          if (!t) return errorResult('任务不存在');
          if (!canMutateActiveTask(t.agentId, ctx.agentId)) {
            return errorResult('无权操作其他 Agent 登记的任务');
          }
          const ok = await failTask(taskId);
          return jsonResult({ ok });
        },
      ),

      tool(
        'at_heartbeat',
        '更新并行任务心跳时间。',
        { taskId: z.string().min(1) },
        async ({ taskId }) => {
          const tasks = await listActiveTasks();
          const t = tasks.find((x) => x.id === taskId);
          if (!t) return errorResult('任务不存在');
          if (!canMutateActiveTask(t.agentId, ctx.agentId)) {
            return errorResult('无权操作其他 Agent 登记的任务');
          }
          const ok = await heartbeatTask(taskId);
          return jsonResult({ ok });
        },
      ),

      tool(
        'at_prune_finished',
        '清理看板中已完成/失败/过期的记录（与 CLI prune 行为一致）。',
        {},
        async () => {
          const removed = await pruneTasks();
          return jsonResult({ removed });
        },
      ),

      tool(
        'reg_list_agents',
        '列出 Agent 注册表（默认不含归档、不含 systemPrompt）。',
        {
          includeArchived: z.boolean().optional(),
          projectKey: z.string().optional().describe('按项目过滤；不传则不过滤'),
        },
        async ({ includeArchived, projectKey }) => {
          const agents = await listAgents({
            includeArchived: !!includeArchived,
            includePrompts: false,
            projectKey: projectKey?.trim() || undefined,
          });
          const slim = agents.map((a) => ({
            id: a.id,
            name: a.name,
            slug: a.slug,
            description: a.description,
            builtIn: a.builtIn,
            archived: a.archived,
            projectKey: a.projectKey,
            capabilities: a.capabilities,
            defaultProvider: a.defaultProvider,
            defaultModel: a.defaultModel,
            triggerHints: a.triggerHints,
          }));
          return jsonResult({ count: slim.length, agents: slim });
        },
      ),

      tool(
        'reg_get_agent',
        '按 id 获取单个 Agent；includePrompt 为 true 时附带解析后的 systemPrompt（可能较长）。',
        {
          id: z.string().min(1),
          includePrompt: z.boolean().optional(),
        },
        async ({ id, includePrompt }) => {
          const agent = await getAgentById(id, {
            includeArchived: true,
            includePrompt: !!includePrompt,
          });
          if (!agent) return errorResult('Agent 不存在');
          return jsonResult(agent);
        },
      ),

      tool(
        'reg_update_my_agent',
        '仅允许更新「当前会话 Agent」（与 ctx.agentId 一致）。capabilities 为部分字段时会与现有能力合并。',
        {
          name: z.string().max(200).optional(),
          description: z.string().max(2000).optional(),
          systemPrompt: z.string().max(200_000).optional(),
          icon: z.string().max(80).optional(),
          capabilities: capabilitiesPatchSchema,
          defaultModel: z.string().max(200).optional(),
          defaultProvider: z.string().max(64).optional(),
          contextStrategy: z.enum(['additive', 'exclusive']).optional(),
          triggerHints: z.array(z.string()).optional(),
          promptRefs: z.array(z.string()).optional(),
        },
        async (patch) => {
          const id = ctx.agentId;
          const existing = await getAgentById(id, { includeArchived: true, includePrompt: false });
          if (!existing) return errorResult('当前 Agent 在注册表中不存在');

          const input: AgentMutationInput = {};

          if (patch.name !== undefined) {
            const n = patch.name.trim();
            if (!n) return errorResult('name 不能为空');
            input.name = n;
          }
          if (patch.description !== undefined) input.description = patch.description;
          if (patch.systemPrompt !== undefined) input.systemPrompt = patch.systemPrompt;
          if (patch.icon !== undefined) input.icon = patch.icon;
          if (patch.defaultModel !== undefined) input.defaultModel = patch.defaultModel;
          if (patch.defaultProvider !== undefined) {
            input.defaultProvider = (patch.defaultProvider.trim() || undefined) as ProviderId | undefined;
          }
          if (patch.contextStrategy !== undefined) input.contextStrategy = patch.contextStrategy;
          if (patch.triggerHints !== undefined) input.triggerHints = patch.triggerHints;
          if (patch.promptRefs !== undefined) input.promptRefs = patch.promptRefs;

          if (patch.capabilities) {
            const merged: AgentCapabilities = {
              ...DEFAULT_AGENT_CAPABILITIES,
              ...(existing.capabilities ?? {}),
              ...patch.capabilities,
            };
            input.capabilities = merged;
          }

          if (Object.keys(input).length === 0) {
            return errorResult('未提供任何可更新字段');
          }

          const updated = await updateAgent(id, input);
          if (!updated) return errorResult('更新失败');
          const { systemPrompt: _sp, ...rest } = updated;
          return jsonResult(rest);
        },
      ),
    ],
  });
}
