import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import {
  getDataDir,
  getFlowsDir,
  getFlowIndexPath,
  getAgentsPath,
  getAgentChatSessionsPath,
  getAgentChatMessagesDir,
  getPromptsDir,
  writeJsonFile,
  readJsonFile,
} from '@/lib/file-store';
import { deleteAllMessageFiles } from '@/lib/chat-managers/agent-chat-session-store';
import { DEFAULT_AGENTS } from '@/lib/default-agents';
import { invalidateAgentsCache } from '@/app/api/agents/route';
import type { AgentsData } from '@/types';
import type { AgentChatSessionsData } from '@/types/agent-chat';

type ClearTarget = 'sessions' | 'flows' | 'all';
const VALID_TARGETS: ClearTarget[] = ['sessions', 'flows', 'all'];

/**
 * POST /api/settings/clear
 * 清除数据。操作前自动备份到 _backup_{timestamp}/。
 * body: { target: 'sessions' | 'flows' | 'all' }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const target = body.target as ClearTarget;

    if (!VALID_TARGETS.includes(target)) {
      return NextResponse.json({ error: 'Invalid target. Must be: sessions, flows, or all' }, { status: 400 });
    }

    const dataDir = getDataDir();
    const timestamp = Date.now();
    const backupDir = path.join(dataDir, `_backup_${timestamp}`);
    await fs.mkdir(backupDir, { recursive: true });

    // 备份函数
    async function backupFile(filePath: string) {
      try {
        await fs.stat(filePath);
        const fileName = path.relative(dataDir, filePath);
        const dest = path.join(backupDir, fileName);
        await fs.mkdir(path.dirname(dest), { recursive: true });
        await fs.copyFile(filePath, dest);
      } catch {
        // 文件不存在则跳过
      }
    }

    async function backupDir2(dirPath: string) {
      try {
        const files = await fs.readdir(dirPath, { withFileTypes: true });
        for (const entry of files) {
          const src = path.join(dirPath, entry.name);
          if (entry.isFile()) {
            await backupFile(src);
          } else if (entry.isDirectory()) {
            await backupDir2(src);
          }
        }
      } catch {
        // 目录不存在则跳过
      }
    }

    // 统计清除数量
    const cleared = { sessions: 0, flows: 0 };

    if (target === 'sessions' || target === 'all') {
      // 统计将被清除的会话数
      const sessionsData = await readJsonFile<AgentChatSessionsData>(
        getAgentChatSessionsPath(), { sessions: [] },
      );
      cleared.sessions = sessionsData.sessions.length;

      // 备份 sessions index + JSONL message files
      await backupFile(getAgentChatSessionsPath());
      await backupDir2(getAgentChatMessagesDir());

      // 清空 index + JSONL files
      await writeJsonFile(getAgentChatSessionsPath(), { sessions: [] });
      await deleteAllMessageFiles();

      // 清理所有运行时 prompt 副本（.runtime/ 目录）
      try {
        const promptsDir = getPromptsDir();
        const entries = await fs.readdir(promptsDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory() && entry.name.endsWith('.runtime')) {
            await fs.rm(path.join(promptsDir, entry.name), { recursive: true, force: true }).catch(() => {});
          }
        }
      } catch { /* prompts 目录可能不存在 */ }
    }

    if (target === 'flows' || target === 'all') {
      // 备份 flows
      await backupDir2(getFlowsDir());

      // 清空 flows 目录并重建空索引
      try {
        await fs.rm(getFlowsDir(), { recursive: true, force: true });
      } catch { /* ignore */ }
      await fs.mkdir(getFlowsDir(), { recursive: true });
      await writeJsonFile(getFlowIndexPath(), { projects: [] });
    }

    if (target === 'all') {
      // agents 和 prompts 不清除 — 只清空 agent-chat 会话记录
      // Agent 定义和 prompt 是用户精心配置的资产，清空数据不应该丢失它们
      await backupFile(getAgentsPath());
      const agentsData = await readJsonFile<AgentsData>(getAgentsPath(), { agents: [] });
      // Ensure all default built-in agents are present
      for (const defaultAgent of DEFAULT_AGENTS) {
        if (!agentsData.agents.some(a => a.id === defaultAgent.id)) {
          agentsData.agents.unshift(defaultAgent);
        }
      }
      // Un-archive any soft-deleted agents (fresh start for sessions, not for agent definitions)
      for (const agent of agentsData.agents) {
        if (agent.archived) {
          agent.archived = undefined;
          agent.archivedAt = undefined;
        }
      }
      await writeJsonFile(getAgentsPath(), agentsData);
      invalidateAgentsCache();
    }

    return NextResponse.json({
      success: true,
      backupDir: `_backup_${timestamp}`,
      cleared,
    });
  } catch (error) {
    console.error('Clear data failed:', error);
    return NextResponse.json({ error: 'Clear failed' }, { status: 500 });
  }
}
