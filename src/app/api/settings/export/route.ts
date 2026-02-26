import { NextResponse } from 'next/server';
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
  readJsonFile,
} from '@/lib/file-store';

/**
 * GET /api/settings/export
 * 导出所有项目数据为 JSON 文件下载。
 * 排除：settings.json（含 API Key）、artifacts/（二进制文件太大）
 */
export async function GET() {
  try {
    // 收集核心数据文件
    const [tasks, projects, aiPlans, agents, agentChatSessions] = await Promise.all([
      readJsonFile(getTasksPath(), {}),
      readJsonFile(getProjectsPath(), {}),
      readJsonFile(getAiPlansPath(), {}),
      readJsonFile(getAgentsPath(), {}),
      readJsonFile(getAgentChatSessionsPath(), {}),
    ]);

    // 收集 flows 数据
    const flows: Record<string, unknown> = {};
    const flowsDir = getFlowsDir();
    try {
      const files = await fs.readdir(flowsDir);
      for (const file of files) {
        if (file.endsWith('.json')) {
          const key = file.replace('.json', '');
          flows[key] = await readJsonFile(path.join(flowsDir, file), {});
        }
      }
    } catch {
      // flows 目录不存在则跳过
    }

    // 收集对话数据
    const conversations: Record<string, Record<string, unknown>> = {};
    const conversationsDir = path.join(getDataDir(), 'conversations');
    try {
      const taskDirs = await fs.readdir(conversationsDir);
      for (const taskDir of taskDirs) {
        const taskDirPath = path.join(conversationsDir, taskDir);
        const stat = await fs.stat(taskDirPath);

        if (stat.isDirectory()) {
          conversations[taskDir] = {};
          const convFiles = await fs.readdir(taskDirPath);
          for (const convFile of convFiles) {
            if (convFile.endsWith('.json')) {
              const convKey = convFile.replace('.json', '');
              conversations[taskDir][convKey] = await readJsonFile(
                path.join(taskDirPath, convFile),
                {},
              );
            }
          }
        } else if (taskDir.endsWith('.json')) {
          // 旧格式单文件对话
          const key = taskDir.replace('.json', '');
          conversations[key] = {
            _legacy: await readJsonFile(taskDirPath, {}),
          };
        }
      }
    } catch {
      // conversations 目录不存在则跳过
    }

    const exportData = {
      version: 1,
      exportedAt: new Date().toISOString(),
      data: {
        tasks,
        projects,
        aiPlans,
        agents,
        agentChatSessions,
        flows,
        conversations,
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
