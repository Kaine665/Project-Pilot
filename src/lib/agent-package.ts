/**
 * Agent Package (.ppagent) — 导出/导入逻辑
 *
 * 导出：Agent 元数据 + systemPrompt → AgentPackage JSON
 * 导入：AgentPackage → 创建新 Agent；可选将包内 contexts 写入知识类文档（documents/）
 */

import { readJsonFile, getAgentsPath, writeJsonFile, getDocumentContentPath, getDocumentsContentDir } from './file-store';
import { readPromptFile, writePromptFile } from './agent-prompt-store';
import { readDocsIndexFromDocuments, saveDocsIndexToDocuments } from './documents-store';
import { getSettings } from './settings-manager';
import type { Agent, AgentsData, AgentCapabilities, DocEntry } from '@/types';
import { DEFAULT_AGENT_CAPABILITIES } from '@/types';
import type { AgentPackage, PackagedContext } from '@/types/agent-package';
import type { ResourceRef } from '@/types/resource';
import { promises as fs } from 'fs';
import { invalidateAgentsCache } from '@/lib/agents-store';
import { assertDocumentTextWritable } from '@/lib/document-text-write-guard';

// ── 导出 ──

export async function exportAgent(agent: Agent): Promise<AgentPackage> {
  const systemPrompt = await readPromptFile(agent.id) || agent.systemPrompt || '';

  const pkg: AgentPackage = {
    format: 'ppagent',
    version: 1,
    exportedAt: new Date().toISOString(),
    source: 'ProjectPilot',
    agent: {
      name: agent.name,
      description: agent.description,
      icon: agent.icon,
      capabilities: agent.capabilities,
      requiredParams: agent.requiredParams,
    },
    systemPrompt,
  };

  return pkg;
}

// ── 导入 ──

export interface ImportResult {
  agent: Agent;
  contextsImported: number;
}

export function validatePackage(data: unknown): data is AgentPackage {
  if (!data || typeof data !== 'object') return false;
  const pkg = data as Record<string, unknown>;
  return (
    pkg.format === 'ppagent' &&
    pkg.version === 1 &&
    typeof pkg.systemPrompt === 'string' &&
    pkg.agent !== null &&
    typeof pkg.agent === 'object' &&
    typeof (pkg.agent as Record<string, unknown>).name === 'string'
  );
}

/**
 * 导入 .ppagent 包，创建新 Agent。
 * 旧版包中的 contexts[] 会写入知识类文档（projectKey=_imported）。
 */
export async function importAgent(pkg: AgentPackage): Promise<ImportResult> {
  const now = new Date().toISOString();
  const agentId = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  let capabilities: AgentCapabilities;
  if (pkg.agent.capabilities) {
    capabilities = pkg.agent.capabilities;
  } else {
    const settings = await getSettings();
    const exposeByDefault = settings.claude.defaultExposePromptPath !== false;
    capabilities = { ...DEFAULT_AGENT_CAPABILITIES, exposePromptPath: exposeByDefault };
  }

  let contextsImported = 0;

  if (pkg.contexts && pkg.contexts.length > 0) {
    await fs.mkdir(getDocumentsContentDir(), { recursive: true });
    const idx = await readDocsIndexFromDocuments();
    const pk = '_imported';
    if (!idx.projects[pk]) idx.projects[pk] = [];

    for (const ctx of pkg.contexts as PackagedContext[]) {
      const docId = `doc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const ext = ctx.format === 'json' ? 'json' : ctx.format === 'markdown' ? 'md' : 'txt';
      const fileName = `${docId}.${ext}`;
      assertDocumentTextWritable(ctx.label);
      assertDocumentTextWritable(ctx.content);
      await fs.writeFile(getDocumentContentPath(fileName), ctx.content, 'utf-8');

      const entry: DocEntry = {
        id: docId,
        title: ctx.label,
        description: ctx.description,
        fileName,
        projectKey: pk,
        documentKind: 'knowledge',
        createdAt: now,
        updatedAt: now,
      };
      idx.projects[pk].push(entry);
      contextsImported++;
    }
    await saveDocsIndexToDocuments(idx);
  }

  const defaultResources: ResourceRef[] = [
    { type: 'system-prompt', id: agentId, priority: 0 },
    { type: 'design-docs-index', id: '_all', priority: 25 },
    { type: 'doc-save-instructions', id: '_static', priority: 85 },
  ];

  const agent: Agent = {
    id: agentId,
    name: pkg.agent.name,
    description: pkg.agent.description,
    icon: pkg.agent.icon,
    capabilities,
    requiredParams: pkg.agent.requiredParams,
    defaultResources,
    createdAt: now,
    updatedAt: now,
  };

  if (pkg.systemPrompt) {
    await writePromptFile(agentId, pkg.systemPrompt);
  }

  const data = await readJsonFile<AgentsData>(getAgentsPath(), { agents: [] });
  data.agents.push(agent);
  await writeJsonFile(getAgentsPath(), data);
  invalidateAgentsCache();

  return { agent: { ...agent, systemPrompt: pkg.systemPrompt }, contextsImported };
}
