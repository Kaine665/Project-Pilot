/**
 * 统一文档域（设计文档 + 知识文档）进程内 MCP，替代 <save-doc> 流式标签。
 */

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import {
  listDocEntries,
  createDocumentEntry,
  getDocumentWithContent,
  patchDocumentEntry,
  deleteDocumentEntry,
} from '@/lib/documents-crud';
import { changeEmitter } from '@/lib/change-emitter';
import { HttpError } from '@/lib/http-error';
import type { DocStatus, DocumentKind } from '@/types';

export const AGENT_DOCUMENTS_MCP_SERVER_KEY = 'projectpilot-documents';

/** SDK 工具全名，供 UI / 流式事件识别 doc_create */
export const AGENT_DOCUMENTS_DOC_CREATE_TOOL_NAME = `mcp__${AGENT_DOCUMENTS_MCP_SERVER_KEY}__doc_create`;

const TOOL_NAMES = ['doc_list', 'doc_get', 'doc_create', 'doc_update', 'doc_delete'] as const;

export function getAgentDocumentsMcpAllowedToolIds(): string[] {
  return TOOL_NAMES.map((n) => `mcp__${AGENT_DOCUMENTS_MCP_SERVER_KEY}__${n}`);
}

export interface AgentDocumentsMcpContext {
  agentId: string;
  projectKey?: string;
}

function jsonResult(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function errorResult(message: string) {
  return { content: [{ type: 'text' as const, text: message }], isError: true as const };
}

function catchHttp(e: unknown): ReturnType<typeof errorResult> {
  if (e instanceof HttpError) {
    return errorResult(`${e.statusCode}: ${e.message}`);
  }
  return errorResult(e instanceof Error ? e.message : String(e));
}

/** 有会话项目时，参数 projectKey 若给出须与之一致；最终默认用会话项目。 */
function effectiveProjectKey(ctx: AgentDocumentsMcpContext, param?: string): string {
  const p = param?.trim();
  const c = ctx.projectKey?.trim();
  if (p) {
    if (c && p !== c) {
      throw new Error(`projectKey 与当前会话项目不一致（会话: ${c}，参数: ${p}）`);
    }
    return p;
  }
  if (!c) {
    throw new Error('当前会话无项目上下文：创建/列表时请显式传入 projectKey');
  }
  return c;
}

function optionalProjectKey(ctx: AgentDocumentsMcpContext, param?: string): string | undefined {
  const p = param?.trim();
  const c = ctx.projectKey?.trim();
  if (p) {
    if (c && p !== c) {
      throw new Error(`projectKey 与当前会话项目不一致（会话: ${c}，参数: ${p}）`);
    }
    return p;
  }
  return c || undefined;
}

async function assertDocInScope(ctx: AgentDocumentsMcpContext, docProjectKey: string): Promise<void> {
  const c = ctx.projectKey?.trim();
  if (c && docProjectKey !== c) {
    throw new Error('无权访问其他项目的文档');
  }
}

export function createAgentDocumentsMcpServer(ctx: AgentDocumentsMcpContext) {
  return createSdkMcpServer({
    name: AGENT_DOCUMENTS_MCP_SERVER_KEY,
    version: '0.1.0',
    tools: [
      tool(
        'doc_list',
        '列出文档条目（默认当前项目；可传 projectKey 或 documentKind 过滤）。',
        {
          projectKey: z.string().optional(),
          documentKind: z.enum(['design_doc', 'knowledge']).optional(),
          status: z.enum(['active', 'draft', 'deprecated']).optional(),
        },
        async ({ projectKey, documentKind, status }) => {
          try {
            const pk = optionalProjectKey(ctx, projectKey);
            if (!pk) {
              const data = await listDocEntries({ documentKind: documentKind ?? null, status: status ?? null });
              if (data.mode === 'all_projects') {
                const slim: Record<string, unknown[]> = {};
                for (const [k, entries] of Object.entries(data.projects ?? {})) {
                  slim[k] = entries.map(slimEntry);
                }
                return jsonResult({ projects: slim });
              }
              return jsonResult({ docs: (data.docs ?? []).map(slimEntry) });
            }
            const data = await listDocEntries({
              projectKey: pk,
              documentKind: documentKind ?? null,
              status: status ?? null,
            });
            return jsonResult({ projectKey: pk, docs: (data.docs ?? []).map(slimEntry) });
          } catch (e) {
            return catchHttp(e);
          }
        },
      ),

      tool(
        'doc_get',
        '读取文档元数据与正文（Markdown）。',
        { id: z.string().min(1) },
        async ({ id }) => {
          try {
            const { entry, content } = await getDocumentWithContent(id);
            await assertDocInScope(ctx, entry.projectKey);
            return jsonResult({ entry: slimEntry(entry), content });
          } catch (e) {
            return catchHttp(e);
          }
        },
      ),

      tool(
        'doc_create',
        '新建文档（设计文档或知识文档）。projectKey 默认当前会话项目。',
        {
          projectKey: z.string().optional(),
          title: z.string().min(1).max(500),
          description: z.string().max(5000).optional(),
          content: z.string().max(2_000_000).optional(),
          documentKind: z.enum(['design_doc', 'knowledge']).optional(),
          category: z.string().optional(),
          tags: z.array(z.string()).optional(),
          status: z.enum(['active', 'draft', 'deprecated']).optional(),
          supersedes: z.string().optional(),
        },
        async (args) => {
          try {
            const pk = effectiveProjectKey(ctx, args.projectKey);
            const entry = await createDocumentEntry({
              projectKey: pk,
              title: args.title,
              description: args.description,
              content: args.content,
              documentKind: (args.documentKind ?? 'design_doc') as DocumentKind,
              category: args.category,
              tags: args.tags,
              status: args.status as DocStatus | undefined,
              supersedes: args.supersedes,
            });
            changeEmitter.emit({
              type: 'doc_updated',
              sourceId: entry.id,
              summary: `文档「${entry.title}」已创建`,
              timestamp: new Date().toISOString(),
              projectKey: entry.projectKey,
              agentId: ctx.agentId,
            });
            return jsonResult({
              ok: true,
              entry: slimEntry(entry),
            });
          } catch (e) {
            return catchHttp(e);
          }
        },
      ),

      tool(
        'doc_update',
        '更新文档元数据与/或正文。',
        {
          id: z.string().min(1),
          title: z.string().max(500).optional(),
          description: z.string().max(5000).optional(),
          content: z.string().max(2_000_000).optional(),
          category: z.string().optional(),
          tags: z.array(z.string()).nullable().optional(),
          status: z.enum(['active', 'draft', 'deprecated']).optional(),
          supersedes: z.string().optional(),
          supersededBy: z.string().optional(),
        },
        async (args) => {
          try {
            const { id, ...patch } = args;
            const { entry: before } = await getDocumentWithContent(id);
            await assertDocInScope(ctx, before.projectKey);
            const entry = await patchDocumentEntry(id, {
              ...patch,
              tags: patch.tags === null ? null : patch.tags,
            });
            changeEmitter.emit({
              type: 'doc_updated',
              sourceId: entry.id,
              summary: `文档「${entry.title}」已更新`,
              timestamp: new Date().toISOString(),
              projectKey: entry.projectKey,
              agentId: ctx.agentId,
            });
            return jsonResult({ ok: true, entry: slimEntry(entry) });
          } catch (e) {
            return catchHttp(e);
          }
        },
      ),

      tool(
        'doc_delete',
        '删除文档（移除索引与内容文件）。',
        { id: z.string().min(1) },
        async ({ id }) => {
          try {
            const { entry } = await getDocumentWithContent(id);
            await assertDocInScope(ctx, entry.projectKey);
            const title = entry.title;
            const pk = entry.projectKey;
            await deleteDocumentEntry(id);
            changeEmitter.emit({
              type: 'doc_updated',
              sourceId: id,
              summary: `文档「${title}」已删除`,
              timestamp: new Date().toISOString(),
              projectKey: pk,
              agentId: ctx.agentId,
            });
            return jsonResult({ ok: true, id });
          } catch (e) {
            return catchHttp(e);
          }
        },
      ),
    ],
  });
}

function slimEntry(e: import('@/types').DocEntry) {
  return {
    id: e.id,
    title: e.title,
    description: e.description,
    projectKey: e.projectKey,
    documentKind: e.documentKind ?? 'design_doc',
    category: e.category,
    tags: e.tags,
    status: e.status,
    fileName: e.fileName,
    supersedes: e.supersedes,
    supersededBy: e.supersededBy,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}
