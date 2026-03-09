import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import {
  getDataDir,
  getProjectsPath,
  getAgentsPath,
  getAgentChatSessionsPath,
  getFlowsDir,
  readJsonFile,
} from '@/lib/file-store';
import { resolveSystemPrompt } from '@/lib/agent-prompt-store';
import type { Agent, AgentsData } from '@/types';

/**
 * GET /api/settings/export
 * 导出所有项目数据为 JSON 文件下载。
 * 排除：settings.json（含 API Key）、artifacts/（二进制文件太大）
 */
export async function GET() {
  try {
    // 收集核心数据文件
    const [projects, agents, agentChatSessions] = await Promise.all([
      readJsonFile(getProjectsPath(), {}),
      readJsonFile(getAgentsPath(), {}),
      readJsonFile(getAgentChatSessionsPath(), {}),
    ]);

    // 导出时将外置的 systemPrompt 重新填入 agents 数据，保证导出文件自包含
    const agentsData = agents as AgentsData;
    if (agentsData.agents) {
      await Promise.all(
        agentsData.agents.map(async (agent: Agent) => {
          agent.systemPrompt = await resolveSystemPrompt(agent.id, agent.systemPrompt);
        }),
      );
    }

    // 收集 flows 数据（并行读取所有 flow 文件）
    const flows: Record<string, unknown> = {};
    const flowsDir = getFlowsDir();
    try {
      const files = await fs.readdir(flowsDir);
      const jsonFiles = files.filter(f => f.endsWith('.json'));
      const flowEntries = await Promise.all(
        jsonFiles.map(async (file) => {
          const key = file.replace('.json', '');
          const data = await readJsonFile(path.join(flowsDir, file), {});
          return [key, data] as const;
        }),
      );
      for (const [key, data] of flowEntries) {
        flows[key] = data;
      }
    } catch {
      // flows 目录不存在则跳过
    }

    const exportData = {
      version: 1,
      exportedAt: new Date().toISOString(),
      data: {
        projects,
        agents,
        agentChatSessions,
        flows,
      },
    };

    const json = JSON.stringify(exportData, null, 2);
    const date = new Date().toISOString().slice(0, 10);

    return new NextResponse(json, {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename=projectpilot-export-${date}.json`,
      },
    });
  } catch (error) {
    console.error('Export failed:', error);
    return NextResponse.json({ error: 'Export failed' }, { status: 500 });
  }
}
