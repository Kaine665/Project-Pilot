/**
 * ProjectPilot MCP Server
 *
 * 通过 stdio 协议为 Cursor / Claude Code 等 MCP 客户端暴露 PP 核心数据。
 *
 * 能力域：Projects · Documents · Todos · Agents · Skills · Prompts · 语义资源（pp.* 读写）
 *
 * 本地开发：`npm run mcp` 或 `npx tsx mcp-server/index.ts`（在仓库根、已 `npm install`）。
 * **Cursor 外部 MCP**：见仓库根 `.cursor/mcp.json` 与 `docs/cursor-mcp-project-pilot.md`
 * （须 `node` + `tsx/dist/cli.mjs` + `TSX_TSCONFIG_PATH`；勿用 `npm run mcp` 作 Cursor 启动命令，避免污染 stdout）。
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { promises as fsPromises } from 'fs';

import {
  readProjectIndex,
  writeProjectIndex,
  notifyDataChanged,
  getDocumentContentPath,
  getGlobalPromptPath,
  getProjectPromptPath,
} from '../src/lib/file-store';
import {
  loadAllDocumentEntries,
  documentToDocEntry,
} from '../src/lib/documents-store';
import { readTodosMerged, modifyTodosMerged } from '../src/lib/todo-file-store';
import { listAgents, getAgentById } from '../src/lib/agents-store';
import { listAllSkills, readSkillFile } from '../src/lib/skill-store';
import { readPromptFile } from '../src/lib/agent-prompt-store';
import type { ProjectEntry, ProjectTechStack, TodoItem } from '../src/types';
import { registerPpResourceTools } from './pp-resource-tools';

// ── Helpers ────────────────────────────────────────────────────────

function textResult(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

function jsonResult(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

// ── Server ─────────────────────────────────────────────────────────

const server = new McpServer({
  name: 'project-pilot',
  version: '0.3.0',
});

registerPpResourceTools(server);

// ═══════════════════════════════════════════════════════════════════
//  1. Projects
// ═══════════════════════════════════════════════════════════════════

server.tool(
  'list_projects',
  'List all registered projects',
  {},
  async () => {
    const { projects } = await readProjectIndex();
    const entries = projects.map((p) => ({
      key: p.key,
      name: p.name,
      path: p.path,
      location: p.location,
      description: p.description,
      techStack: p.techStack,
      tags: p.tags,
    }));
    return jsonResult({ count: entries.length, projects: entries });
  },
);

server.tool(
  'get_project',
  'Get details of a single project by key',
  { key: z.string().describe('Project key') },
  async ({ key }) => {
    const { projects } = await readProjectIndex();
    const project = projects.find((p) => p.key === key);
    if (!project) return textResult(`Project not found: ${key}`);
    return jsonResult(project);
  },
);

server.tool(
  'create_project',
  'Register a new project',
  {
    key: z.string().describe('Unique project identifier (alphanumeric, dashes, underscores)'),
    name: z.string().describe('Project display name'),
    path: z.string().describe('Absolute path to project root'),
    type: z.enum(['react-native', 'nextjs', 'node', 'python', 'other']).describe('Project type'),
    description: z.string().optional().describe('Short description'),
    defaultBranch: z.string().optional().describe('Default git branch'),
    webCommand: z.string().optional().describe('Dev server start command'),
    webUrl: z.string().optional().describe('Dev server URL'),
  },
  async ({ key, name, path: projectPath, type, description, defaultBranch, webCommand, webUrl }) => {
    const safe = key.replace(/[^a-zA-Z0-9_-]/g, '');
    if (!safe) return textResult('Invalid key');
    const index = await readProjectIndex();
    if (index.projects.some((p) => p.key === safe)) {
      return textResult(`Project already exists: ${safe}`);
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
    return textResult(`Registered project "${name}" (${safe})`);
  },
);

server.tool(
  'delete_project',
  'Remove a project from the registry',
  { key: z.string().describe('Project key to delete') },
  async ({ key }) => {
    const index = await readProjectIndex();
    const next = index.projects.filter((p) => p.key !== key);
    if (next.length === index.projects.length) {
      return textResult(`Project not found: ${key}`);
    }
    await writeProjectIndex({ projects: next });
    await notifyDataChanged();
    return textResult(`Deleted project: ${key}`);
  },
);

// ═══════════════════════════════════════════════════════════════════
//  2. Documents (knowledge base)
// ═══════════════════════════════════════════════════════════════════

server.tool(
  'list_documents',
  'List all documents / knowledge entries. Optionally filter by projectKey, tag, or documentKind.',
  {
    projectKey: z.string().optional().describe('Filter by project key (e.g. "my-app"). Omit for all.'),
    tag: z.string().optional().describe('Filter by tag (e.g. "code-card")'),
    kind: z.string().optional().describe('Filter by documentKind (e.g. "knowledge", "design_doc")'),
  },
  async ({ projectKey, tag, kind }) => {
    const docs = await loadAllDocumentEntries();
    let filtered = docs.filter((d) => (d.status ?? 'active') === 'active');
    if (projectKey) {
      filtered = filtered.filter((d) => d.projectKey === projectKey || (projectKey === '_global' && d.scope === 'global'));
    }
    if (tag) {
      filtered = filtered.filter((d) => d.tags?.includes(tag));
    }
    if (kind) {
      filtered = filtered.filter((d) => d.documentKind === kind);
    }
    const entries = filtered.map((d) => ({
      id: d.id,
      title: d.title,
      description: d.description,
      scope: d.scope,
      projectKey: d.projectKey,
      documentKind: d.documentKind,
      tags: d.tags,
      summary: d.summary,
      updatedAt: d.updatedAt,
    }));
    return jsonResult({ count: entries.length, documents: entries });
  },
);

server.tool(
  'get_document',
  'Get a document\'s metadata AND full content by id',
  { id: z.string().describe('Document id') },
  async ({ id }) => {
    const docs = await loadAllDocumentEntries();
    const doc = docs.find((d) => d.id === id);
    if (!doc) return textResult(`Document not found: ${id}`);

    const entry = documentToDocEntry(doc);
    let content = '';
    try {
      const readPath = doc.sourcePath || getDocumentContentPath(entry.fileName);
      content = await fsPromises.readFile(readPath, 'utf-8');
    } catch { /* file may not exist yet */ }

    return jsonResult({ ...entry, content });
  },
);

server.tool(
  'search_documents',
  'Search documents by keyword in title, description, or full content',
  { query: z.string().describe('Search keyword') },
  async ({ query }) => {
    const docs = await loadAllDocumentEntries();
    const q = query.toLowerCase();
    const results: Array<{ id: string; title: string; matchIn: string }> = [];

    for (const doc of docs) {
      if ((doc.status ?? 'active') !== 'active') continue;
      if (doc.title.toLowerCase().includes(q) || doc.description?.toLowerCase().includes(q)) {
        results.push({ id: doc.id, title: doc.title, matchIn: 'metadata' });
        continue;
      }
      try {
        const entry = documentToDocEntry(doc);
        const readPath = doc.sourcePath || getDocumentContentPath(entry.fileName);
        const content = await fsPromises.readFile(readPath, 'utf-8');
        if (content.toLowerCase().includes(q)) {
          results.push({ id: doc.id, title: doc.title, matchIn: 'content' });
        }
      } catch { /* skip */ }
    }

    return jsonResult({ count: results.length, results });
  },
);

// ═══════════════════════════════════════════════════════════════════
//  3. Todos
// ═══════════════════════════════════════════════════════════════════

server.tool(
  'list_todos',
  'List todo items. Optionally filter by status or projectKey.',
  {
    status: z.enum(['pending', 'in_progress', 'done']).optional().describe('Filter by status'),
    projectKey: z.string().optional().describe('Filter by project key'),
  },
  async ({ status, projectKey }) => {
    const { todos } = await readTodosMerged();
    let filtered = todos;
    if (status) filtered = filtered.filter((t) => t.status === status);
    if (projectKey) filtered = filtered.filter((t) => t.projectKey === projectKey);

    const items = filtered.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      status: t.status,
      priority: t.priority,
      projectKey: t.projectKey,
      tags: t.tags,
      dueAt: t.dueAt,
      updatedAt: t.updatedAt,
    }));
    return jsonResult({ count: items.length, todos: items });
  },
);

server.tool(
  'get_todo',
  'Get a single todo item by id',
  { id: z.string().describe('Todo id') },
  async ({ id }) => {
    const { todos } = await readTodosMerged();
    const todo = todos.find((t) => t.id === id);
    if (!todo) return textResult(`Todo not found: ${id}`);
    return jsonResult(todo);
  },
);

server.tool(
  'update_todo_status',
  'Update the status of a todo item',
  {
    id: z.string().describe('Todo id'),
    status: z.enum(['pending', 'in_progress', 'done']).describe('New status'),
  },
  async ({ id, status }) => {
    const result = await modifyTodosMerged((data) => {
      const todo = data.todos.find((t: TodoItem) => t.id === id);
      if (!todo) return data;
      todo.status = status;
      todo.updatedAt = new Date().toISOString();
      return data;
    });
    const updated = result.todos.find((t: TodoItem) => t.id === id);
    if (!updated) return textResult(`Todo not found: ${id}`);
    await notifyDataChanged();
    return textResult(`Todo "${updated.title}" → ${status}`);
  },
);

// ═══════════════════════════════════════════════════════════════════
//  4. Agents
// ═══════════════════════════════════════════════════════════════════

server.tool(
  'list_agents',
  'List all agents (AI execution units). Returns id, name, description, project binding, and status.',
  {
    projectKey: z.string().optional().describe('Filter by project key. Omit for all.'),
  },
  async ({ projectKey }) => {
    const agents = await listAgents({ projectKey: projectKey || undefined });
    const items = agents.map((a) => ({
      id: a.id,
      name: a.name,
      slug: a.slug,
      description: a.description,
      projectKey: a.projectKey,
      builtIn: a.builtIn,
      defaultProvider: a.defaultProvider,
      defaultModel: a.defaultModel,
      triggerHints: a.triggerHints,
      state: a.agentStatus?.state,
    }));
    return jsonResult({ count: items.length, agents: items });
  },
);

server.tool(
  'get_agent',
  'Get full details of an agent by id, including its system prompt',
  { id: z.string().describe('Agent id') },
  async ({ id }) => {
    const agent = await getAgentById(id, { includePrompt: true });
    if (!agent) return textResult(`Agent not found: ${id}`);
    const { systemPrompt, ...meta } = agent;
    return jsonResult({
      ...meta,
      systemPromptPreview: systemPrompt?.slice(0, 500),
      systemPromptLength: systemPrompt?.length ?? 0,
    });
  },
);

// ═══════════════════════════════════════════════════════════════════
//  5. Skills
// ═══════════════════════════════════════════════════════════════════

server.tool(
  'list_skills',
  'List all skills (reusable prompt / knowledge modules)',
  {},
  async () => {
    const skills = await listAllSkills();
    return jsonResult({
      count: skills.length,
      skills: skills.map((s) => ({
        name: s.name,
        dirName: s.dirName ?? s.name,
        scope: s.scope,
        description: s.description,
        bundle: s.bundle,
      })),
    });
  },
);

server.tool(
  'get_skill',
  'Read the full content of a skill (SKILL.md)',
  { name: z.string().describe('Skill name (e.g. "code-review")') },
  async ({ name }) => {
    const content = await readSkillFile(name);
    if (!content) return textResult(`Skill not found: ${name}`);
    return textResult(content);
  },
);

// ═══════════════════════════════════════════════════════════════════
//  6. Prompts (read-only)
// ═══════════════════════════════════════════════════════════════════

server.tool(
  'get_global_prompt',
  'Read the global system prompt (applies to all agents)',
  {},
  async () => {
    try {
      const content = await fsPromises.readFile(getGlobalPromptPath(), 'utf-8');
      return textResult(content || '(empty)');
    } catch {
      return textResult('(no global prompt file)');
    }
  },
);

server.tool(
  'get_agent_prompt',
  'Read an agent\'s system prompt by agent id',
  { agentId: z.string().describe('Agent id') },
  async ({ agentId }) => {
    const content = await readPromptFile(agentId);
    if (!content) return textResult(`No prompt file for agent: ${agentId}`);
    return textResult(content);
  },
);

server.tool(
  'get_project_prompt',
  'Read a project-level prompt by project key',
  { projectKey: z.string().describe('Project key') },
  async ({ projectKey }) => {
    try {
      const content = await fsPromises.readFile(getProjectPromptPath(projectKey), 'utf-8');
      return textResult(content || '(empty)');
    } catch {
      return textResult(`No prompt file for project: ${projectKey}`);
    }
  },
);

// ═══════════════════════════════════════════════════════════════════
//  Boot
// ═══════════════════════════════════════════════════════════════════

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
