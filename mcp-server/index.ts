/**
 * ProjectPilot MCP Server
 *
 * 通过 stdio 协议为 Claude Code 等 MCP 客户端
 * 提供项目注册、Flow 看板管理能力。
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
  getFlowDataPath,
  notifyDataChanged,
} from '../src/lib/file-store.js';
import type {
  ProjectsData,
} from '../src/types/index.js';
import type { FlowData } from '../src/types/flow.js';

// ==================== 辅助函数 ====================

function textResult(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

function jsonResult(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

// ==================== 默认数据 ====================

const DEFAULT_PROJECTS: ProjectsData = { projects: {} };
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

// ==================== 启动 ====================

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
