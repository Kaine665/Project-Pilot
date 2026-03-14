import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import {
  getDataDir,
  getProjectsPath,
  getAgentsPath,
  getAgentChatSessionsPath,
  getAgentChatMessagesDir,
  getFlowsDir,
  writeJsonFile,
  readJsonFile,
} from '@/lib/file-store';
import { importSessionsWithMessages } from '@/lib/chat-managers/agent-chat-session-store';
import { DEFAULT_AGENTS } from '@/lib/default-agents';
import { writePromptFile } from '@/lib/agent-prompt-store';
import { invalidateAgentsCache } from '@/lib/agents-store';
import type { Agent, AgentsData } from '@/types';
import type { AgentChatSession } from '@/types/agent-chat';

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
    const filesToBackup = ['projects.json', 'agents.json', 'agent-chat-sessions.json'];
    for (const file of filesToBackup) {
      const src = path.join(dataDir, file);
      try {
        await fs.stat(src);
        await fs.copyFile(src, path.join(backupDir, file));
      } catch {
        // 文件不存在则跳过
      }
    }

    // 备份 JSONL message files
    const messagesDir = getAgentChatMessagesDir();
    try {
      const msgBackup = path.join(backupDir, 'agent-chat-messages');
      await fs.mkdir(msgBackup, { recursive: true });
      const msgFiles = await fs.readdir(messagesDir);
      for (const file of msgFiles) {
        if (file.endsWith('.jsonl')) {
          await fs.copyFile(path.join(messagesDir, file), path.join(msgBackup, file));
        }
      }
    } catch {
      // messages 目录不存在则跳过
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
    const stats = { flows: 0, agents: 0 };

    if (data.projects) {
      await writeJsonFile(getProjectsPath(), data.projects);
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
      // Import sessions with embedded messages — extracts to JSONL + index
      const imported = data.agentChatSessions as { sessions?: AgentChatSession[] };
      const importedSessions = Array.isArray(imported.sessions) ? imported.sessions : [];
      if (importedSessions.length > 0) {
        await importSessionsWithMessages(importedSessions);
      }
    }

    // 写入 flows
    if (data.flows && typeof data.flows === 'object') {
      await fs.mkdir(flowsDir, { recursive: true });
      for (const [key, value] of Object.entries(data.flows)) {
        await writeJsonFile(path.join(flowsDir, `${key}.json`), value);
        if (key !== '_index') stats.flows++;
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
