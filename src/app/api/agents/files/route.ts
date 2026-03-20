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
import { getAgentById } from '@/lib/agents-store';
import { getAgentDataPath, getDataDir } from '@/lib/file-store';

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

function extractLegacyDataDirName(systemPrompt?: string): string | null {
  if (!systemPrompt) return null;
  const match = systemPrompt.match(/agent-data[\\/]+([a-zA-Z0-9_-]+)/);
  return match?.[1] ?? null;
}

async function resolveAgentDataStoreDir(agentId: string): Promise<string> {
  const agent = await getAgentById(agentId, { includeArchived: true, includePrompt: true });
  const legacyDataDirName = extractLegacyDataDirName(agent?.systemPrompt);
  const candidates = [
    agent?.slug ? getAgentDataPath(agent.slug) : null,
    legacyDataDirName ? getAgentDataPath(legacyDataDirName) : null,
    getAgentDataPath(agentId),
  ].filter((value): value is string => !!value);

  for (const candidate of candidates) {
    if (await fileExists(candidate)) return candidate;
  }

  return candidates[0];
}

async function ensureAgentDataStoreDir(dirPath: string): Promise<void> {
  await fs.mkdir(path.join(dirPath, 'data'), { recursive: true });
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

  // 4. Agent data store: agents/data/{agentId}/
  const dataStoreDir = await resolveAgentDataStoreDir(agentId);
  await ensureAgentDataStoreDir(dataStoreDir);
  entries.push({
    name: '数据',
    path: dataStoreDir,
    isDirectory: true,
    category: 'data',
    exists: await fileExists(dataStoreDir),
  });

  return NextResponse.json(
    { agentId, entries },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } },
  );
}
