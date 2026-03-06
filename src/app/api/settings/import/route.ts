import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import {
  getDataDir,
  getTasksPath,
  getProjectsPath,
  getAiPlansPath,
  getAgentsPath,
  getAgentChatSessionsPath,
  getFlowsDir,
  writeJsonFile,
  readJsonFile,
} from '@/lib/file-store';
import { DEFAULT_AGENTS } from '@/lib/default-agents';
import { writePromptFile } from '@/lib/agent-prompt-store';
import { invalidateAgentsCache } from '@/app/api/agents/route';
import type { Agent, AgentsData } from '@/types';
import type { AgentChatSessionsData } from '@/types/agent-chat';

/**
 * POST /api/settings/import
 * 从 JSON 导入数据。自动备份当前数据到 _backup_{timestamp}/ 目录。
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // 验证基本结构
    if (!body.version || !body.data) {
      return NextResponse.json({ error: 'Invalid export format: missing version or data' }, { status: 400 });
    }

    const { data } = body;

    // 备份当前数据
    const dataDir = getDataDir();
    const timestamp = Date.now();
    const backupDir = path.join(dataDir, `_backup_${timestamp}`);
    await fs.mkdir(backupDir, { recursive: true });

    // 复制核心文件到备份
    const filesToBackup = ['tasks.json', 'projects.json', 'ai-plans.json', 'agents.json', 'agent-chat-sessions.json'];
    for (const file of filesToBackup) {
      const src = path.join(dataDir, file);
      try {
        await fs.stat(src);
        await fs.copyFile(src, path.join(backupDir, file));
      } catch {
        // 文件不存在则跳过
      }
    }

    // 备份 flows 目录
    const flowsDir = getFlowsDir();
    try {
      const flowsBackup = path.join(backupDir, 'flows');
      await fs.mkdir(flowsBackup, { recursive: true });
      const flowFiles = await fs.readdir(flowsDir);
      for (const file of flowFiles) {
        if (file.endsWith('.json')) {
          await fs.copyFile(path.join(flowsDir, file), path.join(flowsBackup, file));
        }
      }
    } catch {
      // flows 目录不存在则跳过
    }

    // 写入导入数据
    const stats = { tasks: 0, flows: 0, agents: 0, plans: 0 };

    if (data.tasks) {
      await writeJsonFile(getTasksPath(), data.tasks);
      const taskList = data.tasks.tasks;
      stats.tasks = Array.isArray(taskList) ? taskList.length : 0;
    }
    if (data.projects) {
      await writeJsonFile(getProjectsPath(), data.projects);
    }
    if (data.aiPlans) {
      await writeJsonFile(getAiPlansPath(), data.aiPlans);
      const planList = data.aiPlans.plans;
      stats.plans = Array.isArray(planList) ? planList.length : 0;
    }
    if (data.agents) {
      // Merge imported agents into existing ones — never discard existing agents
      const imported = data.agents as { agents?: Agent[] };
      const importedAgents = Array.isArray(imported.agents) ? imported.agents : [];
      const existingData = await readJsonFile<AgentsData>(getAgentsPath(), { agents: [] });
      const mergedAgents = [...existingData.agents];

      for (const incoming of importedAgents) {
        const idx = mergedAgents.findIndex(a => a.id === incoming.id);
        if (idx >= 0) {
          // Update existing agent with imported data
          mergedAgents[idx] = { ...mergedAgents[idx], ...incoming };
        } else {
          // Add new agent from import
          mergedAgents.push(incoming);
        }
      }

      // Ensure built-in agents are present
      for (const defaultAgent of DEFAULT_AGENTS) {
        if (!mergedAgents.some((a: Agent) => a.id === defaultAgent.id)) {
          mergedAgents.unshift(defaultAgent);
        }
      }

      // 将 systemPrompt 外置到 .md 文件，不存入 agents.json
      for (const agent of mergedAgents) {
        if (agent.systemPrompt) {
          await writePromptFile(agent.id, agent.systemPrompt);
          delete agent.systemPrompt;
        }
      }
      await writeJsonFile(getAgentsPath(), { agents: mergedAgents });
      invalidateAgentsCache();
      stats.agents = mergedAgents.length;
    }
    if (data.agentChatSessions) {
      // 合并式导入：按 session ID 去重，保留更新的版本，不丢失已有会话
      const imported = data.agentChatSessions as AgentChatSessionsData;
      const importedSessions = Array.isArray(imported.sessions) ? imported.sessions : [];
      const existing = await readJsonFile<AgentChatSessionsData>(
        getAgentChatSessionsPath(), { sessions: [] },
      );
      const merged = [...existing.sessions];

      for (const incoming of importedSessions) {
        const idx = merged.findIndex(s => s.id === incoming.id);
        if (idx >= 0) {
          // 同 ID 的会话，取 updatedAt 更新的版本
          if (incoming.updatedAt > merged[idx].updatedAt) {
            merged[idx] = incoming;
          }
        } else {
          merged.push(incoming);
        }
      }

      await writeJsonFile(getAgentChatSessionsPath(), { sessions: merged });
    }

    // 写入 flows
    if (data.flows && typeof data.flows === 'object') {
      await fs.mkdir(flowsDir, { recursive: true });
      for (const [key, value] of Object.entries(data.flows)) {
        await writeJsonFile(path.join(flowsDir, `${key}.json`), value);
        if (key !== '_index') stats.flows++;
      }
    }

    // 写入 conversations
    if (data.conversations && typeof data.conversations === 'object') {
      const conversationsDir = path.join(getDataDir(), 'conversations');
      for (const [taskId, convData] of Object.entries(data.conversations)) {
        if (typeof convData === 'object' && convData !== null) {
          const taskConvDir = path.join(conversationsDir, taskId);
          await fs.mkdir(taskConvDir, { recursive: true });
          for (const [convKey, convValue] of Object.entries(convData as Record<string, unknown>)) {
            await writeJsonFile(path.join(taskConvDir, `${convKey}.json`), convValue);
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      backupDir: `_backup_${timestamp}`,
      stats,
    });
  } catch (error) {
    console.error('Import failed:', error);
    return NextResponse.json({ error: 'Import failed' }, { status: 500 });
  }
}
