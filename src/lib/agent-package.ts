/**
 * Agent Package (.ppagent) — 导出/导入逻辑
 *
 * 导出：Agent 元数据 + systemPrompt + 关联 context 内容内联化 → AgentPackage JSON
 * 导入：AgentPackage → 创建新 Agent + 写 prompt 文件 + 可选导入 context
 */

import { readJsonFile, getContextIndexPath, getContextFilePath, getAgentsPath, writeJsonFile } from './file-store';
import { readPromptFile, writePromptFile } from './agent-prompt-store';
import { getSettings } from './settings-manager';
import type { Agent, AgentsData, ContextIndexData, ContextEntry, AgentCapabilities } from '@/types';
import { DEFAULT_AGENT_CAPABILITIES } from '@/types';
import type { AgentPackage, PackagedContext } from '@/types/agent-package';
import type { ResourceRef } from '@/types/resource';
import { promises as fs } from 'fs';
import { invalidateAgentsCache } from '@/lib/agents-store';

// ── 导出 ──

export async function exportAgent(agent: Agent): Promise<AgentPackage> {
  // 1. 读取 systemPrompt
  const systemPrompt = await readPromptFile(agent.id) || agent.systemPrompt || '';

  // 2. 收集关联的 context 内容
  const contexts: PackagedContext[] = [];
  const contextRefs = (agent.defaultResources || []).filter(r => r.type === 'context');

  if (contextRefs.length > 0) {
    const contextIndex = await readJsonFile<ContextIndexData>(getContextIndexPath(), { entries: [] });

    for (const ref of contextRefs) {
      const entry = contextIndex.entries.find(e => e.id === ref.id && (!e.status || e.status === 'active'));
      if (!entry) continue;

      try {
        const filePath = getContextFilePath(entry.fileName);
        const content = await fs.readFile(filePath, 'utf-8');
        contexts.push({
          label: entry.label,
          description: entry.description,
          format: entry.format,
          content,
        });
      } catch {
        // 文件不存在，跳过
      }
    }
  }

  // 3. 组装包
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

  if (contexts.length > 0) {
    pkg.contexts = contexts;
  }

  return pkg;
}

// ── 导入 ──

export interface ImportResult {
  agent: Agent;
  contextsImported: number;
}

/**
 * 验证 .ppagent 包的基本格式
 */
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
 *
 * - 始终生成新 ID（不会覆盖已有 agent）
 * - contexts 作为新的 ContextEntry 导入（如果有）
 * - 返回创建的 Agent 和导入的 context 数量
 */
export async function importAgent(pkg: AgentPackage): Promise<ImportResult> {
  const now = new Date().toISOString();
  const agentId = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  // 1. 确定 capabilities
  let capabilities: AgentCapabilities;
  if (pkg.agent.capabilities) {
    capabilities = pkg.agent.capabilities;
  } else {
    const settings = await getSettings();
    const exposeByDefault = settings.claude.defaultExposePromptPath !== false;
    capabilities = { ...DEFAULT_AGENT_CAPABILITIES, exposePromptPath: exposeByDefault };
  }

  // 2. 导入 contexts（如果有）
  let contextsImported = 0;
  const contextRefs: ResourceRef[] = [];

  if (pkg.contexts && pkg.contexts.length > 0) {
    const { modifyJsonFile, getContextDir } = await import('./file-store');

    // 确保 context 目录存在
    const contextDir = getContextDir();
    await fs.mkdir(contextDir, { recursive: true });

    for (const ctx of pkg.contexts) {
      const contextId = `ctx-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const ext = ctx.format === 'json' ? '.json' : ctx.format === 'markdown' ? '.md' : '.txt';
      const fileName = `${contextId}${ext}`;

      // 写上下文文件
      const filePath = getContextFilePath(fileName);
      await fs.writeFile(filePath, ctx.content, 'utf-8');

      // 写索引
      const entry: ContextEntry = {
        id: contextId,
        label: ctx.label,
        description: ctx.description,
        fileName,
        format: ctx.format,
        createdAt: now,
        updatedAt: now,
      };

      await modifyJsonFile<ContextIndexData>(
        getContextIndexPath(),
        { entries: [] },
        (d) => { d.entries.push(entry); return d; },
      );

      contextRefs.push({
        type: 'context',
        id: contextId,
        priority: 30,
        label: ctx.label,
      });

      contextsImported++;
    }
  }

  // 3. 构建 defaultResources
  // 基础资源（和 resource-migration.ts 一致）+ 导入的 context
  const defaultResources: ResourceRef[] = [
    { type: 'system-prompt', id: agentId, priority: 0 },
    { type: 'context-index', id: '_all', priority: 20 },
    { type: 'design-docs-index', id: '_all', priority: 25 },
    ...contextRefs,
    { type: 'knowledge-instructions', id: '_static', priority: 80 },
    { type: 'doc-save-instructions', id: '_static', priority: 85 },
    // session-title-instructions 已移除：标题由 session-title-generator 异步生成
  ];

  // 4. 创建 Agent
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

  // 5. 写 systemPrompt 文件
  if (pkg.systemPrompt) {
    await writePromptFile(agentId, pkg.systemPrompt);
  }

  // 6. 写 agents.json
  const data = await readJsonFile<AgentsData>(getAgentsPath(), { agents: [] });
  data.agents.push(agent);
  await writeJsonFile(getAgentsPath(), data);
  invalidateAgentsCache();

  return { agent: { ...agent, systemPrompt: pkg.systemPrompt }, contextsImported };
}
