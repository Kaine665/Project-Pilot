/**
 * GET /api/agents/files?agentId=xxx
 *
 * 返回指定 Agent 自身拥有的文件和目录列表（不暴露父目录）。
 * 前端用 /api/fs/list-dir 懒加载子目录。
 *
 * 返回格式：
 * {
 *   agentId: "...",
 *   entries: [
 *     { name: "prompt.md", path: "C:/.../xxx.md", isDirectory: false, category: "prompt" },
 *     { name: "提示词片段", path: "C:/.../xxx.d", isDirectory: true, category: "prompt-segment" },
 *     { name: "技能", path: "C:/.../skills/_agents/xxx", isDirectory: true, category: "skill" },
 *     { name: "数据", path: "C:/.../agent-data/xxx", isDirectory: true, category: "data" },
 *   ]
 * }
 */
import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { getDataDir } from '@/lib/file-store';

export interface AgentFileEntry {
  /** Display name */
  name: string;
  /** Absolute path */
  path: string;
  isDirectory: boolean;
  category: 'prompt' | 'prompt-segment' | 'skill' | 'data';
  /** Whether the file/directory actually exists on disk */
  exists: boolean;
}

async function fileExists(p: string): Promise<boolean> {
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
  const entries: AgentFileEntry[] = [];

  // 1. Main prompt FILE (not the parent directory!)
  const promptFile = path.join(dataDir, 'prompts', 'agents', `${agentId}.md`);
  const promptExists = await fileExists(promptFile);
  if (promptExists) {
    entries.push({
      name: `${agentId}.md`,
      path: promptFile,
      isDirectory: false,
      category: 'prompt',
      exists: true,
    });
  } else {
    // Legacy location
    const legacyFile = path.join(dataDir, 'prompts', `${agentId}.md`);
    const legacyExists = await fileExists(legacyFile);
    entries.push({
      name: `${agentId}.md`,
      path: legacyExists ? legacyFile : promptFile,
      isDirectory: false,
      category: 'prompt',
      exists: legacyExists,
    });
  }

  // 2. Prompt segments directory: prompts/agents/{agentId}.d/
  const segmentsDir = path.join(dataDir, 'prompts', 'agents', `${agentId}.d`);
  entries.push({
    name: '提示词片段',
    path: segmentsDir,
    isDirectory: true,
    category: 'prompt-segment',
    exists: await fileExists(segmentsDir),
  });

  // 3. Agent-level skills: skills/_agents/{agentId}/
  const skillsDir = path.join(dataDir, 'skills', '_agents', agentId);
  entries.push({
    name: '技能',
    path: skillsDir,
    isDirectory: true,
    category: 'skill',
    exists: await fileExists(skillsDir),
  });

  // 4. Agent data store: agent-data/{agentId}/
  const dataStoreDir = path.join(dataDir, 'agent-data', agentId);
  entries.push({
    name: '数据',
    path: dataStoreDir,
    isDirectory: true,
    category: 'data',
    exists: await fileExists(dataStoreDir),
  });

  return NextResponse.json({ agentId, entries });
}
