/**
 * ProjectPilot 语义资源 MCP 工具：prompt / skill / knowledge / todo / memory。
 * 工具名与行为见 docs/design/prompt-system-architecture.md §「Phase 4（长期）：PP 内置 MCP」。
 */

import path from 'path';
import { mkdir, writeFile, readFile } from 'fs/promises';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import {
  getGlobalPromptPath,
  getProjectPromptPath,
  getProjectPromptsDir,
  getPromptsDir,
  getAgentDataFilePath,
  notifyDataChanged,
  type SkillScope,
} from '../src/lib/file-store';
import { writePromptFile, readPromptFile } from '../src/lib/agent-prompt-store';
import { assertDocumentTextWritable } from '../src/lib/document-text-write-guard';
import { writeSkillFile } from '../src/lib/skill-store';
import { createDocumentEntry } from '../src/lib/documents-crud';
import { modifyTodosMerged } from '../src/lib/todo-file-store';
import { writeMemory } from '../src/lib/shared-memory';
import { HttpError } from '../src/lib/http-error';
import type { TodoItem, TodoPriority, TodoStatus } from '../src/types';

function textResult(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

function jsonResult(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function buildSkillScope(
  level: 'global' | 'project' | 'agent',
  projectKey?: string,
  agentId?: string,
): SkillScope {
  if (level === 'global') return { level: 'global' };
  if (level === 'project') {
    if (!projectKey?.trim()) throw new Error('projectKey is required for project-scoped skill');
    return { level: 'project', projectKey: projectKey.trim() };
  }
  if (!agentId?.trim()) throw new Error('agentId is required for agent-scoped skill');
  return { level: 'agent', agentId: agentId.trim() };
}

/** 注册与设计文档一致的工具名（pp.*），与 list_* / get_* 只读工具并存 */
export function registerPpResourceTools(server: McpServer): void {
  server.tool(
    'pp.prompt.read',
    'Read the global prompt, a project prompt, or an agent system prompt. Uses ProjectPilot paths; do not pass raw filesystem paths.',
    {
      scope: z.enum(['global', 'project', 'agent']).describe('Which prompt to read'),
      projectKey: z.string().optional().describe('Required when scope is project'),
      agentId: z.string().optional().describe('Required when scope is agent'),
    },
    async ({ scope, projectKey, agentId }) => {
      try {
        if (scope === 'global') {
          const content = await readFile(getGlobalPromptPath(), 'utf-8').catch(() => '');
          return textResult(content || '(empty)');
        }
        if (scope === 'project') {
          if (!projectKey?.trim()) return textResult('projectKey is required for scope=project');
          const content = await readFile(getProjectPromptPath(projectKey), 'utf-8').catch(() => '');
          return textResult(content || '(empty)');
        }
        if (!agentId?.trim()) return textResult('agentId is required for scope=agent');
        const content = await readPromptFile(agentId);
        if (!content) return textResult(`No prompt file for agent: ${agentId}`);
        return textResult(content);
      } catch (e) {
        return textResult(`Error: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );

  server.tool(
    'pp.prompt.write',
    'Write the global prompt, a project prompt, or an agent prompt. Agent scope uses the same snapshot history as the app. For agent scope, optional onBehalfOfAgentId must match agentId.',
    {
      scope: z.enum(['global', 'project', 'agent']),
      content: z.string().describe('Full markdown body'),
      projectKey: z.string().optional(),
      agentId: z.string().optional(),
      onBehalfOfAgentId: z
        .string()
        .optional()
        .describe('When scope is agent: if set, must equal agentId'),
    },
    async ({ scope, content, projectKey, agentId, onBehalfOfAgentId }) => {
      try {
        assertDocumentTextWritable(content);
        if (scope === 'global') {
          await mkdir(getPromptsDir(), { recursive: true });
          await writeFile(getGlobalPromptPath(), content, 'utf-8');
          await notifyDataChanged();
          return textResult('OK: global prompt written');
        }
        if (scope === 'project') {
          if (!projectKey?.trim()) return textResult('projectKey is required');
          await mkdir(getProjectPromptsDir(), { recursive: true });
          await writeFile(getProjectPromptPath(projectKey), content, 'utf-8');
          await notifyDataChanged();
          return textResult(`OK: project prompt written (${projectKey})`);
        }
        if (!agentId?.trim()) return textResult('agentId is required for scope=agent');
        if (onBehalfOfAgentId && onBehalfOfAgentId !== agentId) {
          return textResult('Permission denied: onBehalfOfAgentId must match agentId');
        }
        await writePromptFile(agentId, content);
        await notifyDataChanged();
        return textResult(`OK: agent prompt written (${agentId})`);
      } catch (e) {
        return textResult(`Error: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );

  server.tool(
    'pp.skill.save',
    'Save or update a skill (SKILL.md body). Chooses the correct directory for global / project / agent scope.',
    {
      name: z.string().describe('Skill name (directory name)'),
      content: z.string().describe('Full SKILL.md (may include YAML frontmatter)'),
      scope: z.enum(['global', 'project', 'agent']),
      projectKey: z.string().optional(),
      agentId: z.string().optional(),
    },
    async ({ name, content, scope, projectKey, agentId }) => {
      try {
        const sk = buildSkillScope(scope, projectKey, agentId);
        await writeSkillFile(name, content, sk);
        await notifyDataChanged();
        return textResult(`OK: skill "${name}" saved (${scope})`);
      } catch (e) {
        return textResult(`Error: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );

  server.tool(
    'pp.knowledge.save',
    'Create a knowledge document under a project (same behavior as the app API).',
    {
      projectKey: z.string(),
      title: z.string(),
      content: z.string().optional().default(''),
      description: z.string().optional(),
      tags: z.array(z.string()).optional(),
    },
    async ({ projectKey, title, content, description, tags }) => {
      try {
        const entry = await createDocumentEntry({
          projectKey,
          title,
          content: content ?? '',
          description,
          tags,
          documentKind: 'knowledge',
        });
        await notifyDataChanged();
        return jsonResult({ ok: true, id: entry.id, title: entry.title, projectKey: entry.projectKey });
      } catch (e) {
        if (e instanceof HttpError) return textResult(`Error: ${e.message}`);
        return textResult(`Error: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );

  server.tool(
    'pp.todo.update',
    'Update an existing todo by id (partial fields).',
    {
      id: z.string(),
      status: z.enum(['pending', 'in_progress', 'done']).optional(),
      title: z.string().optional(),
      description: z.string().optional(),
      priority: z.enum(['high', 'medium', 'low']).optional(),
    },
    async ({ id, status, title, description, priority }) => {
      try {
        const result = await modifyTodosMerged((data) => {
          const todo = data.todos.find((t: TodoItem) => t.id === id);
          if (!todo) return data;
          const now = new Date().toISOString();
          if (status) todo.status = status as TodoStatus;
          if (title !== undefined) todo.title = title;
          if (description !== undefined) todo.description = description;
          if (priority) todo.priority = priority as TodoPriority;
          todo.updatedAt = now;
          return data;
        });
        const updated = result.todos.find((t: TodoItem) => t.id === id);
        if (!updated) return textResult(`Todo not found: ${id}`);
        await notifyDataChanged();
        return jsonResult({ ok: true, todo: updated });
      } catch (e) {
        return textResult(`Error: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );

  server.tool(
    'pp.memory.write',
    'Write shared-memory (blackboard) or a single file in an agent private workspace (basename only, no path segments).',
    {
      mode: z.enum(['shared', 'agent_workspace']),
      key: z.string().optional().describe('shared: memory key'),
      value: z.string().optional().describe('shared: text; agent_workspace: file body'),
      author: z.string().optional(),
      projectKey: z.string().optional().describe('shared: optional project scope'),
      ttlHours: z.number().optional(),
      agentId: z.string().optional().describe('agent_workspace: agent id'),
      fileName: z.string().optional().describe('agent_workspace: single file name (no paths)'),
    },
    async ({ mode, key, value, author, projectKey, ttlHours, agentId, fileName }) => {
      try {
        if (mode === 'shared') {
          if (!key?.trim() || value === undefined) {
            return textResult('shared mode requires key and value');
          }
          const entry = await writeMemory({
            key: key.trim(),
            value,
            author: author ?? 'mcp',
            projectKey: projectKey?.trim() || undefined,
            ttlHours,
          });
          await notifyDataChanged();
          return jsonResult({ ok: true, entry });
        }
        if (!agentId?.trim() || !fileName?.trim() || value === undefined) {
          return textResult('agent_workspace requires agentId, fileName, value');
        }
        assertDocumentTextWritable(value);
        const absPath = getAgentDataFilePath(agentId, fileName);
        await mkdir(path.dirname(absPath), { recursive: true });
        await writeFile(absPath, value, 'utf-8');
        await notifyDataChanged();
        return textResult(`OK: wrote agent workspace file ${fileName}`);
      } catch (e) {
        return textResult(`Error: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );
}
