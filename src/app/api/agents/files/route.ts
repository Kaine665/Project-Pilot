/**
 * GET /api/agents/files?agentId=xxx
 *
 * 返回指定 Agent 在数据目录中的文件树结构。
 * 用于 RuntimePanel 的「文件夹」区域。
 *
 * 返回格式：
 * {
 *   tree: [
 *     { name: "prompt.md", path: "prompts/agents/xxx.md", type: "file", category: "prompt" },
 *     { name: "skills/", path: "skills/_agents/xxx/", type: "dir", category: "skill", children: [...] },
 *     ...
 *   ]
 * }
 */
import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { getDataDir } from '@/lib/file-store';

export interface AgentFileNode {
  name: string;
  /** Relative path from data dir */
  relPath: string;
  type: 'file' | 'dir';
  category: 'prompt' | 'prompt-segment' | 'skill' | 'data' | 'block';
  children?: AgentFileNode[];
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function listDir(dir: string, dataDir: string, category: AgentFileNode['category']): Promise<AgentFileNode[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const nodes: AgentFileNode[] = [];
  for (const ent of entries) {
    const fullPath = path.join(dir, ent.name);
    const relPath = path.relative(dataDir, fullPath).replace(/\\/g, '/');
    if (ent.isDirectory()) {
      const children = await listDir(fullPath, dataDir, category);
      nodes.push({ name: ent.name + '/', relPath: relPath + '/', type: 'dir', category, children });
    } else {
      nodes.push({ name: ent.name, relPath, type: 'file', category });
    }
  }
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return nodes;
}

export async function GET(request: NextRequest) {
  const agentId = request.nextUrl.searchParams.get('agentId');
  if (!agentId) {
    return NextResponse.json({ error: 'agentId is required' }, { status: 400 });
  }

  const dataDir = getDataDir();
  const tree: AgentFileNode[] = [];

  // 1. Main prompt file: prompts/agents/{agentId}.md
  const promptPath = path.join(dataDir, 'prompts', 'agents', `${agentId}.md`);
  if (await exists(promptPath)) {
    tree.push({
      name: `${agentId}.md`,
      relPath: `prompts/agents/${agentId}.md`,
      type: 'file',
      category: 'prompt',
    });
  } else {
    // Also check legacy location: prompts/{agentId}.md
    const legacyPromptPath = path.join(dataDir, 'prompts', `${agentId}.md`);
    if (await exists(legacyPromptPath)) {
      tree.push({
        name: `${agentId}.md`,
        relPath: `prompts/${agentId}.md`,
        type: 'file',
        category: 'prompt',
      });
    }
  }

  // 2. Prompt segments: prompts/agents/{agentId}.d/
  const segmentsDir = path.join(dataDir, 'prompts', 'agents', `${agentId}.d`);
  if (await exists(segmentsDir)) {
    const children = await listDir(segmentsDir, dataDir, 'prompt-segment');
    tree.push({
      name: `${agentId}.d/`,
      relPath: `prompts/agents/${agentId}.d/`,
      type: 'dir',
      category: 'prompt-segment',
      children,
    });
  }

  // 3. Agent-level skills: skills/_agents/{agentId}/
  const skillsDir = path.join(dataDir, 'skills', '_agents', agentId);
  if (await exists(skillsDir)) {
    const children = await listDir(skillsDir, dataDir, 'skill');
    tree.push({
      name: 'skills/',
      relPath: `skills/_agents/${agentId}/`,
      type: 'dir',
      category: 'skill',
      children,
    });
  }

  // 4. Agent data store: agent-data/{agentId}/ or agent-data/{slug}/
  const dataStoreDir = path.join(dataDir, 'agent-data', agentId);
  if (await exists(dataStoreDir)) {
    const children = await listDir(dataStoreDir, dataDir, 'data');
    tree.push({
      name: 'data/',
      relPath: `agent-data/${agentId}/`,
      type: 'dir',
      category: 'data',
      children,
    });
  }

  // 5. Prompt blocks referenced by agent (just list refs, don't scan)
  // This is handled separately via agent.promptRefs in the frontend

  return NextResponse.json({ agentId, tree });
}
