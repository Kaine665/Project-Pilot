import { NextRequest, NextResponse } from 'next/server';
import { getAgentsPath, readJsonFile } from '@/lib/file-store';
import { DEFAULT_AGENTS } from '@/lib/default-agents';
import { resolveSystemPrompt } from '@/lib/agent-prompt-store';
import { exportAgent } from '@/lib/agent-package';
import type { Agent, AgentsData } from '@/types';

/** GET /api/agents/export/[id] — 导出 agent 为 .ppagent 格式 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }

  // 读取 agent
  const data = await readJsonFile<AgentsData>(getAgentsPath(), { agents: [] });

  // 合并内置 agent
  for (const defaultAgent of DEFAULT_AGENTS) {
    if (!data.agents.find(a => a.id === defaultAgent.id)) {
      data.agents.unshift(defaultAgent);
    }
  }

  const agent = data.agents.find(a => a.id === id);
  if (!agent) {
    return NextResponse.json({ error: 'agent not found' }, { status: 404 });
  }

  // 确保有 systemPrompt
  agent.systemPrompt = await resolveSystemPrompt(agent.id, agent.systemPrompt);

  const pkg = await exportAgent(agent);

  // 返回 JSON 并设置下载 headers
  const safeName = agent.name.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '_');
  const fileName = `${safeName}.ppagent`;

  return new NextResponse(JSON.stringify(pkg, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    },
  });
}
