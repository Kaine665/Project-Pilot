/**
 * GET /api/prompt-blocks?agentId=xxx&projectKey=xxx
 *
 * 返回指定 Agent 的 prompt 组成 blocks：
 * - global prompt
 * - project prompt (if projectKey)
 * - agent prompt
 * - skills (agent-level, project-level, global)
 *
 * 每个 block 包含: id, name, description, source, tokenEstimate, enabled, content (truncated preview)
 */

import { NextRequest, NextResponse } from 'next/server';
import { readFile, readdir } from 'fs/promises';
import {
  getGlobalPromptPath,
  getProjectPromptPath,
  getPromptFilePath,
  getProjectPromptsDir,
  getScopedSkillsDir,
  getSkillFilePath,
  type SkillScope,
} from '@/lib/file-store';

interface PromptBlock {
  id: string;
  name: string;
  description: string;
  source: 'global' | 'project' | 'agent' | 'skill' | 'injected';
  tokenEstimate: number;
  enabled: boolean;
  contentPreview: string;
  location?: string;
}

// Re-export from shared utility for CJK-aware token estimation
import { estimateTokens } from '@/lib/token-estimate';

function truncate(text: string, maxLen = 200): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '...';
}

async function safeReadFile(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const agentId = searchParams.get('agentId') ?? undefined;
  const projectKey = searchParams.get('projectKey') ?? undefined;

  const blocks: PromptBlock[] = [];

  // 1. Global prompt
  const globalContent = await safeReadFile(getGlobalPromptPath());
  if (globalContent) {
    blocks.push({
      id: 'global',
      name: '全局提示词',
      description: '所有 Agent 共享的基础指令与标准操作规范',
      source: 'global',
      tokenEstimate: estimateTokens(globalContent),
      enabled: true,
      contentPreview: truncate(globalContent),
      location: getGlobalPromptPath(),
    });
  }

  // 2. Project prompts
  try {
    const projDir = getProjectPromptsDir();
    const files = await readdir(projDir);
    for (const file of files) {
      if (!file.endsWith('.md')) continue;
      const key = file.replace(/\.md$/, '');
      const content = await safeReadFile(getProjectPromptPath(key));
      if (content) {
        blocks.push({
          id: `project-${key}`,
          name: key,
          description: `项目「${key}」级别的提示词`,
          source: 'project',
          tokenEstimate: estimateTokens(content),
          enabled: projectKey ? key === projectKey : true,
          contentPreview: truncate(content),
          location: getProjectPromptPath(key),
        });
      }
    }
  } catch {
    // project-prompts dir may not exist
  }

  // 3. Agent prompts
  if (agentId) {
    const agentContent = await safeReadFile(getPromptFilePath(agentId));
    if (agentContent) {
      blocks.push({
        id: `agent-${agentId}`,
        name: `Agent 专属提示词`,
        description: `此 Agent 的个性化指令与角色定义`,
        source: 'agent',
        tokenEstimate: estimateTokens(agentContent),
        enabled: true,
        contentPreview: truncate(agentContent),
        location: getPromptFilePath(agentId),
      });
    }
  }

  // 4. Skills — scan skills directories (global / agent / project scopes)
  const skillScopes: { scope: SkillScope; idPrefix: string; label: string }[] = [
    { scope: { level: 'global' }, idPrefix: 'skill-global', label: '全局 Skill' },
  ];
  if (agentId) {
    skillScopes.push({ scope: { level: 'agent', agentId }, idPrefix: `skill-agent-${agentId}`, label: 'Agent 级别 Skill' });
  }
  if (projectKey) {
    skillScopes.push({ scope: { level: 'project', projectKey }, idPrefix: `skill-project-${projectKey}`, label: `项目 Skill (${projectKey})` });
  }

  for (const { scope, idPrefix, label } of skillScopes) {
    try {
      const scopeDir = getScopedSkillsDir(scope);
      const skillDirs = await readdir(scopeDir);
      for (const skillName of skillDirs) {
        const skillMd = getSkillFilePath(skillName, scope);
        const content = await safeReadFile(skillMd);
        if (content) {
          blocks.push({
            id: `${idPrefix}-${skillName}`,
            name: skillName,
            description: label,
            source: 'skill',
            tokenEstimate: estimateTokens(content),
            enabled: true,
            contentPreview: truncate(content),
            location: skillMd,
          });
        }
      }
    } catch { /* scope dir may not exist */ }
  }

  const totalTokens = blocks.filter(b => b.enabled).reduce((sum, b) => sum + b.tokenEstimate, 0);

  return NextResponse.json({ blocks, totalTokens });
}
