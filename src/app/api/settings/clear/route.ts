import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import {
  getDataDir,
  getTasksPath,
  getAiPlansPath,
  getFlowsDir,
  getFlowIndexPath,
  getAgentsPath,
  getAgentChatSessionsPath,
  getPromptsDir,
  writeJsonFile,
  readJsonFile,
} from '@/lib/file-store';
import { DEFAULT_AGENTS } from '@/lib/default-agents';
import type { AgentsData } from '@/types';

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

    if (target === 'sessions' || target === 'all') {
      // 备份 sessions 相关
      await backupFile(getTasksPath());
      await backupFile(getAiPlansPath());
      await backupFile(getAgentChatSessionsPath());
      await backupDir2(path.join(dataDir, 'conversations'));

      // 清空
      await writeJsonFile(getTasksPath(), { tasks: [] });
      await writeJsonFile(getAiPlansPath(), { plans: [] });
      await writeJsonFile(getAgentChatSessionsPath(), { sessions: [] });

      // 删除 conversations 目录内容
      try {
        await fs.rm(path.join(dataDir, 'conversations'), { recursive: true, force: true });
      } catch { /* ignore */ }
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
      // 清除 agents，但保留内置 agent
      await backupFile(getAgentsPath());
      const agentsData = await readJsonFile<AgentsData>(getAgentsPath(), { agents: [] });
      const builtInAgents = agentsData.agents.filter(a => a.builtIn);
      // Ensure all default built-in agents are present
      for (const defaultAgent of DEFAULT_AGENTS) {
        if (!builtInAgents.some(a => a.id === defaultAgent.id)) {
          builtInAgents.unshift(defaultAgent);
        }
      }
      await writeJsonFile(getAgentsPath(), { agents: builtInAgents });

      // 清理非内置 agent 的外置 prompt 文件
      const promptsDir = getPromptsDir();
      await backupDir2(promptsDir);
      try {
        const builtInIds = new Set(builtInAgents.map(a => a.id));
        const files = await fs.readdir(promptsDir);
        for (const file of files) {
          if (file.endsWith('.md')) {
            const agentId = file.slice(0, -3);
            if (!builtInIds.has(agentId)) {
              await fs.unlink(path.join(promptsDir, file));
            }
          }
        }
      } catch {
        // prompts 目录不存在则跳过
      }
    }

    return NextResponse.json({
      success: true,
      backupDir: `_backup_${timestamp}`,
    });
  } catch (error) {
    console.error('Clear data failed:', error);
    return NextResponse.json({ error: 'Clear failed' }, { status: 500 });
  }
}
