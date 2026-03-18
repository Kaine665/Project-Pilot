/**
 * GET /api/agents/files?agentId=xxx
 *
 * 返回指定 Agent 在数据目录中的文件夹入口列表。
 * 每个入口是一个实际存在的目录绝对路径 + 标签，前端用 /api/fs/list-dir 懒加载。
 *
 * 返回格式：
 * {
 *   agentId: "...",
 *   folders: [
 *     { label: "提示词", path: "C:/.../prompts/agents", description: "主提示词文件" },
 *     { label: "提示词片段", path: "C:/.../prompts/agents/xxx.d", description: "分段提示词" },
 *     { label: "技能", path: "C:/.../skills/_agents/xxx", description: "Agent 专属技能" },
 *     { label: "数据", path: "C:/.../agent-data/xxx", description: "Agent 数据存储" },
 *   ]
 * }
 */
import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { getDataDir } from '@/lib/file-store';

interface AgentFolder {
  label: string;
  path: string;
  description: string;
  /** The specific file to highlight (for single-file folders like prompt) */
  highlightFile?: string;
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest) {
  const agentId = request.nextUrl.searchParams.get('agentId');
  if (!agentId) {
    return NextResponse.json({ error: 'agentId is required' }, { status: 400 });
  }

  const dataDir = getDataDir();
  const folders: AgentFolder[] = [];

  // 1. Main prompt directory: prompts/agents/
  const promptDir = path.join(dataDir, 'prompts', 'agents');
  const promptFile = path.join(promptDir, `${agentId}.md`);
  if (await exists(promptFile)) {
    folders.push({
      label: '提示词',
      path: promptDir,
      description: '主提示词文件',
      highlightFile: `${agentId}.md`,
    });
  } else {
    // Legacy location
    const legacyDir = path.join(dataDir, 'prompts');
    const legacyFile = path.join(legacyDir, `${agentId}.md`);
    if (await exists(legacyFile)) {
      folders.push({
        label: '提示词',
        path: legacyDir,
        description: '主提示词文件（旧位置）',
        highlightFile: `${agentId}.md`,
      });
    }
  }

  // 2. Prompt segments: prompts/agents/{agentId}.d/
  const segmentsDir = path.join(dataDir, 'prompts', 'agents', `${agentId}.d`);
  if (await exists(segmentsDir)) {
    folders.push({
      label: '提示词片段',
      path: segmentsDir,
      description: '分段提示词目录',
    });
  }

  // 3. Agent-level skills: skills/_agents/{agentId}/
  const skillsDir = path.join(dataDir, 'skills', '_agents', agentId);
  if (await exists(skillsDir)) {
    folders.push({
      label: '技能',
      path: skillsDir,
      description: 'Agent 专属技能',
    });
  }

  // 4. Agent data store: agent-data/{agentId}/
  const dataStoreDir = path.join(dataDir, 'agent-data', agentId);
  if (await exists(dataStoreDir)) {
    folders.push({
      label: '数据',
      path: dataStoreDir,
      description: 'Agent 数据存储',
    });
  }

  // 5. Also check by slug if agent has one
  // (slug-based data dirs are common for agents with dataStore capability)
  // We'll let the frontend handle slug lookup from agent.slug

  return NextResponse.json({ agentId, folders });
}
