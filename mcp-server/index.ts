/**
 * ProjectPilot MCP Server
 *
 * 通过 stdio 协议为 Claude Code 等 MCP 客户端提供项目注册能力。
 * Flow 看板已下线，相关工具已移除。
 *
 * 启动方式: npx tsx mcp-server/index.ts
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  readProjectIndex,
  writeProjectIndex,
  notifyDataChanged,
} from '../src/lib/file-store';
import type { ProjectEntry, ProjectTechStack } from '../src/types';

function textResult(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

function jsonResult(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

const server = new McpServer({
  name: 'projct-pilot',
  version: '0.1.0',
});

server.tool(
  'list_projects',
  '列出所有已注册项目（projects/index.json）',
  {},
  async () => {
    const { projects } = await readProjectIndex();
    const entries = projects.map((p) => ({
      key: p.key,
      name: p.name,
      path: p.path,
      location: p.location,
      description: p.description,
    }));
    return jsonResult({ count: entries.length, projects: entries });
  },
);

server.tool(
  'get_project',
  '获取单个项目详情',
  {
    key: z.string().describe('项目 key'),
  },
  async ({ key }) => {
    const { projects } = await readProjectIndex();
    const project = projects.find((p) => p.key === key);
    if (!project) return textResult(`项目不存在: ${key}`);
    return jsonResult(project);
  },
);

server.tool(
  'create_project',
  '注册新项目',
  {
    key: z.string().describe('唯一项目标识（字母、数字、下划线、连字符）'),
    name: z.string().describe('项目显示名'),
    path: z.string().describe('项目根目录的绝对路径'),
    type: z.enum(['react-native', 'nextjs', 'node', 'python', 'other']).describe('项目类型'),
    description: z.string().optional().describe('项目简要描述'),
    defaultBranch: z.string().optional().describe('默认 git 分支（如 main、master）'),
    webCommand: z.string().optional().describe('开发服务器启动命令'),
    webUrl: z.string().optional().describe('开发服务器 URL'),
  },
  async ({
    key,
    name,
    path: projectPath,
    type,
    description,
    defaultBranch,
    webCommand,
    webUrl,
  }) => {
    const safe = key.replace(/[^a-zA-Z0-9_-]/g, '');
    if (!safe) return textResult('无效的 key');
    const index = await readProjectIndex();
    if (index.projects.some((p) => p.key === safe)) {
      return textResult(`项目已存在: ${safe}`);
    }
    const now = new Date().toISOString();
    const entry: ProjectEntry = {
      key: safe,
      name,
      path: projectPath,
      location: 'local',
      techStack: type as ProjectTechStack,
      ...(description && { description }),
      ...(defaultBranch && { repository: { defaultBranch } }),
      ...((webCommand || webUrl) && {
        devServer: {
          ...(webCommand && { command: webCommand }),
          ...(webUrl && { url: webUrl }),
        },
      }),
      createdAt: now,
      updatedAt: now,
    };
    index.projects.push(entry);
    await writeProjectIndex(index);
    await notifyDataChanged();
    return textResult(`已注册项目「${name}」(${safe})`);
  },
);

server.tool(
  'delete_project',
  '从注册表中删除项目',
  {
    key: z.string().describe('要删除的项目 key'),
  },
  async ({ key }) => {
    const index = await readProjectIndex();
    const next = index.projects.filter((p) => p.key !== key);
    if (next.length === index.projects.length) {
      return textResult(`项目不存在: ${key}`);
    }
    await writeProjectIndex({ projects: next });
    await notifyDataChanged();
    return textResult(`已删除项目: ${key}`);
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
