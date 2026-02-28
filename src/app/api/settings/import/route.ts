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
} from '@/lib/file-store';
import { DEFAULT_AGENTS } from '@/lib/default-agents';
import { writePromptFile } from '@/lib/agent-prompt-store';
import type { Agent } from '@/types';

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
      // Ensure built-in agents survive import
      const imported = data.agents as { agents?: Agent[] };
      const agents = Array.isArray(imported.agents) ? imported.agents : [];
      for (const defaultAgent of DEFAULT_AGENTS) {
        if (!agents.some((a: Agent) => a.id === defaultAgent.id)) {
          agents.unshift(defaultAgent);
        }
      }
      // 将 systemPrompt 外置到 .md 文件，不存入 agents.json
      for (const agent of agents) {
        if (agent.systemPrompt) {
          await writePromptFile(agent.id, agent.systemPrompt);
          delete agent.systemPrompt;
        }
      }
      await writeJsonFile(getAgentsPath(), { agents });
      stats.agents = agents.length;
    }
    if (data.agentChatSessions) {
      await writeJsonFile(getAgentChatSessionsPath(), data.agentChatSessions);
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
