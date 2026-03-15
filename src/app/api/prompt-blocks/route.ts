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
import path from 'path';
import {
  getGlobalPromptPath,
  getProjectPromptPath,
  getPromptFilePath,
  getProjectPromptsDir,
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

function estimateTokens(text: string): number {
  return Math.round(text.length / 3.5);
}

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

  // 4. Skills — scan skills directories
  const DATA_DIR = path.join(process.env.HOME || process.env.USERPROFILE || '', '.project-pilot', 'data');
  const skillsDir = path.join(DATA_DIR, 'skills');

  // Global skills
  try {
    const globalSkillsDir = path.join(skillsDir, '_global');
    const skillDirs = await readdir(globalSkillsDir);
    for (const skillName of skillDirs) {
      const skillMd = path.join(globalSkillsDir, skillName, 'SKILL.md');
      const content = await safeReadFile(skillMd);
      if (content) {
        blocks.push({
          id: `skill-global-${skillName}`,
          name: skillName,
          description: `全局 Skill`,
          source: 'skill',
          tokenEstimate: estimateTokens(content),
          enabled: true,
          contentPreview: truncate(content),
          location: skillMd,
        });
      }
    }
  } catch { /* no global skills */ }

  // Agent-level skills
  if (agentId) {
    try {
      const agentSkillsDir = path.join(skillsDir, agentId);
      const skillDirs = await readdir(agentSkillsDir);
      for (const skillName of skillDirs) {
        const skillMd = path.join(agentSkillsDir, skillName, 'SKILL.md');
        const content = await safeReadFile(skillMd);
        if (content) {
          blocks.push({
            id: `skill-agent-${agentId}-${skillName}`,
            name: skillName,
            description: `Agent 级别 Skill`,
            source: 'skill',
            tokenEstimate: estimateTokens(content),
            enabled: true,
            contentPreview: truncate(content),
            location: skillMd,
          });
        }
      }
    } catch { /* no agent skills */ }
  }

  // Project-level skills
  if (projectKey) {
    try {
      const projSkillsDir = path.join(skillsDir, `_project_${projectKey}`);
      const skillDirs = await readdir(projSkillsDir);
      for (const skillName of skillDirs) {
        const skillMd = path.join(projSkillsDir, skillName, 'SKILL.md');
        const content = await safeReadFile(skillMd);
        if (content) {
          blocks.push({
            id: `skill-project-${projectKey}-${skillName}`,
            name: skillName,
            description: `项目 Skill (${projectKey})`,
            source: 'skill',
            tokenEstimate: estimateTokens(content),
            enabled: true,
            contentPreview: truncate(content),
            location: skillMd,
          });
        }
      }
    } catch { /* no project skills */ }
  }

  const totalTokens = blocks.filter(b => b.enabled).reduce((sum, b) => sum + b.tokenEstimate, 0);

  return NextResponse.json({ blocks, totalTokens });
}
