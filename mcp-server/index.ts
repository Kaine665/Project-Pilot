/**
 * ProjectPilot MCP Server
 *
 * 通过 stdio 协议为 Claude Code 等 MCP 客户端
 * 提供项目注册、Session/Task、Flow 看板管理能力。
 *
 * 启动方式: npx tsx mcp-server/index.ts
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  readJsonFile,
  modifyJsonFile,
  writeJsonFile,
  getProjectsPath,
  getTasksPath,
  getAiPlansPath,
  getFlowDataPath,
  getTaskArtifactsPath,
  notifyDataChanged,
} from '../src/lib/file-store.js';
import type {
  ProjectsData,
  Task,
  TasksData,
  TaskArtifacts,
  PlansData,
} from '../src/types/index.js';
import type { FlowData } from '../src/types/flow.js';

// ==================== 辅助函数 ====================

function textResult(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

function jsonResult(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function nowISO(): string {
  return new Date().toISOString();
}

// ==================== 默认数据 ====================

const DEFAULT_PROJECTS: ProjectsData = { projects: {} };
const DEFAULT_TASKS: TasksData = { tasks: [] };
const DEFAULT_PLANS: PlansData = { plans: [] };
const DEFAULT_FLOW: FlowData = { sections: [] };

// ==================== 创建 MCP Server ====================

const server = new McpServer({
  name: 'projct-pilot',
  version: '0.1.0',
});

// ==================== Project Tools ====================

server.tool(
  'list_projects',
  '列出所有已注册项目',
  {},
  async () => {
    const data = await readJsonFile<ProjectsData>(getProjectsPath(), DEFAULT_PROJECTS);
    const entries = Object.entries(data.projects).map(([key, config]) => ({
      key,
      name: config.name,
      path: config.path,
      type: config.type,
      description: config.description,
      defaultBranch: config.defaultBranch,
      webUrl: config.webUrl,
    }));
    return jsonResult({ count: entries.length, projects: entries });
  },
);

server.tool(
  'get_project',
  '获取单个项目详情',
  {
    key: z.string().describe('项目 key（如 "projct-pilot"、"elapp"）'),
  },
  async ({ key }) => {
    const data = await readJsonFile<ProjectsData>(getProjectsPath(), DEFAULT_PROJECTS);
    const project = data.projects[key];
    if (!project) return textResult(`项目不存在: ${key}`);
    return jsonResult({ key, ...project });
  },
);

server.tool(
  'create_project',
  '注册新项目或更新已有项目',
  {
    key: z.string().describe('唯一项目标识（字母、数字、连字符）'),
    name: z.string().describe('项目显示名'),
    path: z.string().describe('项目根目录的绝对路径'),
    type: z.enum(['react-native', 'nextjs', 'node', 'python', 'other']).describe('项目类型'),
    description: z.string().optional().describe('项目简要描述'),
    defaultBranch: z.string().optional().describe('默认 git 分支（如 main、master）'),
    webCommand: z.string().optional().describe('开发服务器启动命令'),
    webUrl: z.string().optional().describe('开发服务器 URL'),
  },
  async ({ key, name, path: projectPath, type, description, defaultBranch, webCommand, webUrl }) => {
    await modifyJsonFile<ProjectsData>(getProjectsPath(), DEFAULT_PROJECTS, (data) => ({
      ...data,
      projects: {
        ...data.projects,
        [key]: {
          ...data.projects[key],
          name,
          path: projectPath,
          type,
          ...(description !== undefined && { description }),
          ...(defaultBranch !== undefined && { defaultBranch }),
          ...(webCommand !== undefined && { webCommand }),
          ...(webUrl !== undefined && { webUrl }),
        },
      },
    }));
    await notifyDataChanged();
    return textResult(`已注册项目「${name}」(${key})`);
  },
);

server.tool(
  'delete_project',
  '从注册表中删除项目',
  {
    key: z.string().describe('要删除的项目 key'),
  },
  async ({ key }) => {
    let found = false;
    await modifyJsonFile<ProjectsData>(getProjectsPath(), DEFAULT_PROJECTS, (data) => {
      if (!(key in data.projects)) return data;
      found = true;
      const { [key]: _, ...rest } = data.projects;
      return { ...data, projects: rest };
    });
    if (!found) return textResult(`项目不存在: ${key}`);
    await notifyDataChanged();
    return textResult(`已删除项目: ${key}`);
  },
);

// ==================== Session/Task Tools ====================

server.tool(
  'list_sessions',
  '列出 Sessions（AI 工作会话），支持按状态、项目过滤',
  {
    status: z.enum(['todo', 'doing', 'done', 'all']).optional()
      .describe('按状态过滤，默认: all'),
    projectKey: z.string().optional()
      .describe('按项目 key 过滤'),
    archived: z.boolean().optional()
      .describe('是否包含已归档。默认: false（仅显示未归档）'),
  },
  async ({ status, projectKey, archived }) => {
    const data = await readJsonFile<TasksData>(getTasksPath(), DEFAULT_TASKS);
    let sessions = data.tasks;

    if (!archived) {
      sessions = sessions.filter(s => !s.archived);
    }
    if (status && status !== 'all') {
      sessions = sessions.filter(s => s.status === status);
    }
    if (projectKey) {
      sessions = sessions.filter(s => s.projectKey === projectKey);
    }

    const summaries = sessions.map(s => ({
      id: s.id,
      title: s.title,
      status: s.status,
      phase: s.phase,
      projectKey: s.projectKey,
      archived: s.archived,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      completedAt: s.completedAt,
      gitBranch: s.gitBranch,
    }));

    return jsonResult({ count: summaries.length, sessions: summaries });
  },
);

server.tool(
  'get_session',
  '获取 Session 详情（含 Artifact 产物）',
  {
    id: z.string().describe('Session ID（如 "task-1234567890"）'),
    includeArtifacts: z.boolean().optional()
      .describe('是否包含产物（understanding、result）。默认: true'),
  },
  async ({ id, includeArtifacts }) => {
    const data = await readJsonFile<TasksData>(getTasksPath(), DEFAULT_TASKS);
    const session = data.tasks.find(t => t.id === id);
    if (!session) return textResult(`Session 不存在: ${id}`);

    if (includeArtifacts === false) {
      return jsonResult(session);
    }

    const artifacts = await readJsonFile<TaskArtifacts>(
      getTaskArtifactsPath(id),
      { taskId: id, updatedAt: '' },
    );

    let plan = null;
    if (artifacts.planId) {
      const plansData = await readJsonFile<PlansData>(getAiPlansPath(), DEFAULT_PLANS);
      plan = plansData.plans.find(p => p.plan_id === artifacts.planId) ?? null;
    }

    return jsonResult({
      ...session,
      artifacts: {
        understanding: artifacts.understanding ?? null,
        result: artifacts.result ?? null,
        plan,
      },
    });
  },
);

server.tool(
  'create_session',
  '创建新的 AI 工作会话',
  {
    title: z.string().describe('会话标题/任务描述'),
    content: z.string().optional().describe('详细任务描述或备注'),
    projectKey: z.string().optional().describe('关联的项目 key'),
  },
  async ({ title, content, projectKey }) => {
    const now = nowISO();
    const newSession: Task = {
      id: `task-${Date.now()}`,
      title,
      content,
      ...(projectKey && { projectKey }),
      status: 'todo',
      phase: 'understanding',
      createdAt: now,
      updatedAt: now,
    };

    await modifyJsonFile<TasksData>(getTasksPath(), DEFAULT_TASKS, (data) => ({
      ...data,
      tasks: [...data.tasks, newSession],
    }));

    await notifyDataChanged();
    return textResult(`已创建会话「${title}」(${newSession.id})`);
  },
);

server.tool(
  'update_session',
  '更新 Session 字段（标题、内容、状态、项目、归档）',
  {
    id: z.string().describe('Session ID'),
    title: z.string().optional().describe('新标题'),
    content: z.string().optional().describe('新内容/描述'),
    status: z.enum(['todo', 'doing', 'done']).optional().describe('新状态'),
    projectKey: z.string().optional().describe('新项目 key'),
    archived: z.boolean().optional().describe('是否归档'),
  },
  async ({ id, title, content, status, projectKey, archived }) => {
    let found = false;

    await modifyJsonFile<TasksData>(getTasksPath(), DEFAULT_TASKS, (data) => {
      const index = data.tasks.findIndex(t => t.id === id);
      if (index === -1) return data;
      found = true;

      const session = data.tasks[index];
      const now = nowISO();
      const updated: Task = {
        ...session,
        ...(title !== undefined && { title }),
        ...(content !== undefined && { content }),
        ...(status !== undefined && { status }),
        ...(projectKey !== undefined && { projectKey }),
        ...(archived !== undefined && { archived }),
        updatedAt: now,
        ...(status === 'done' && !session.completedAt && { completedAt: now }),
      };

      const tasks = [...data.tasks];
      tasks[index] = updated;
      return { ...data, tasks };
    });

    if (!found) return textResult(`Session 不存在: ${id}`);
    await notifyDataChanged();
    return textResult(`已更新 Session: ${id}`);
  },
);

server.tool(
  'delete_session',
  '删除 Session',
  {
    id: z.string().describe('要删除的 Session ID'),
  },
  async ({ id }) => {
    let found = false;

    await modifyJsonFile<TasksData>(getTasksPath(), DEFAULT_TASKS, (data) => {
      const before = data.tasks.length;
      const tasks = data.tasks.filter(t => t.id !== id);
      found = tasks.length < before;
      return { ...data, tasks };
    });

    if (!found) return textResult(`Session 不存在: ${id}`);
    await notifyDataChanged();
    return textResult(`已删除 Session: ${id}`);
  },
);

// ==================== Flow Board Tools ====================

server.tool(
  'get_flow',
  '获取项目的 Flow 看板数据（板块和树形条目）',
  {
    projectKey: z.string().describe('项目 key'),
  },
  async ({ projectKey }) => {
    const filePath = getFlowDataPath(projectKey);
    const data = await readJsonFile<FlowData>(filePath, DEFAULT_FLOW);
    return jsonResult(data);
  },
);

server.tool(
  'update_flow',
  '替换项目的 Flow 看板数据。先用 get_flow 获取，修改后再调用此工具。',
  {
    projectKey: z.string().describe('项目 key'),
    sections: z.array(z.object({
      id: z.string(),
      name: z.string(),
      description: z.string().optional(),
      items: z.array(z.any()),
    })).describe('板块数组，含树形条目'),
    cycleDeadline: z.string().optional().describe('周期截止日期，ISO 格式（如 "2026-03-01"）'),
  },
  async ({ projectKey, sections, cycleDeadline }) => {
    const filePath = getFlowDataPath(projectKey);
    const flowData: FlowData = {
      sections: sections as FlowData['sections'],
      ...(cycleDeadline && { cycleDeadline }),
    };
    await writeJsonFile(filePath, flowData);
    return textResult(`已更新项目 ${projectKey} 的 Flow 看板`);
  },
);

// ==================== Artifact Tools ====================

server.tool(
  'get_session_artifacts',
  '获取 Session 的产物（任务理解、执行计划、执行结果）',
  {
    sessionId: z.string().describe('Session ID（如 "task-1234567890"）'),
  },
  async ({ sessionId }) => {
    const artifacts = await readJsonFile<TaskArtifacts>(
      getTaskArtifactsPath(sessionId),
      { taskId: sessionId, updatedAt: '' },
    );

    let plan = null;
    if (artifacts.planId) {
      const plansData = await readJsonFile<PlansData>(getAiPlansPath(), DEFAULT_PLANS);
      plan = plansData.plans.find(p => p.plan_id === artifacts.planId) ?? null;
    } else {
      const plansData = await readJsonFile<PlansData>(getAiPlansPath(), DEFAULT_PLANS);
      const taskPlans = plansData.plans
        .filter(p => p.task_id === sessionId)
        .sort((a, b) => b.version - a.version);
      plan = taskPlans[0] ?? null;
    }

    return jsonResult({
      sessionId,
      understanding: artifacts.understanding ?? null,
      result: artifacts.result ?? null,
      plan,
      updatedAt: artifacts.updatedAt,
    });
  },
);

// ==================== 启动 ====================

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
