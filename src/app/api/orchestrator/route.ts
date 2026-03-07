import { NextRequest, NextResponse } from 'next/server';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { orchestratorManager } from '@/lib/chat-managers/orchestrator-manager';
import { readJsonFile, getProjectsPath, modifyJsonFile } from '@/lib/file-store';
import { isValidProjectKey } from '@/lib/security';
import type { ProjectsData } from '@/types';

function toKebabCase(str: string): string {
  return str.trim().toLowerCase().replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]/g, '');
}

/**
 * POST /api/orchestrator — Start a new orchestration
 * Body: { projectKey: string, prompt: string, teamId?: string }
 *   OR  { newProject: { name: string, path?: string }, prompt: string, teamId?: string }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { prompt, teamId } = body as { prompt?: string; teamId?: string };
    const newProject = body.newProject as { name: string; path?: string } | undefined;

    if (!prompt) {
      return NextResponse.json({ error: 'prompt is required' }, { status: 400 });
    }
    if (prompt.length > 20000) {
      return NextResponse.json({ error: 'Prompt too long (max 20000 chars)' }, { status: 400 });
    }

    let resolvedKey: string;
    let resolvedPath: string;

    if (newProject?.name) {
      // 创建新项目模式
      const kebab = toKebabCase(newProject.name);
      if (!kebab) {
        return NextResponse.json({ error: 'Invalid project name' }, { status: 400 });
      }
      resolvedPath = newProject.path || path.join(os.homedir(), 'ProjectPilot-Experiments', kebab);
      resolvedKey = `proj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

      // 创建目录 + git init
      fs.mkdirSync(resolvedPath, { recursive: true });
      execSync('git init', { cwd: resolvedPath, stdio: 'ignore' });

      // 注册到 projects.json
      await modifyJsonFile<ProjectsData>(getProjectsPath(), { projects: {} }, (data) => {
        data.projects[resolvedKey] = {
          name: newProject.name.trim(),
          path: resolvedPath,
          type: 'other',
        };
        return data;
      });
    } else {
      // 已有项目模式
      const projectKey = body.projectKey as string | undefined;
      if (!projectKey) {
        return NextResponse.json({ error: 'projectKey or newProject is required' }, { status: 400 });
      }
      if (!isValidProjectKey(projectKey)) {
        return NextResponse.json({ error: 'Invalid projectKey' }, { status: 400 });
      }

      const projectsData = await readJsonFile<ProjectsData>(getProjectsPath(), { projects: {} });
      const project = projectsData.projects[projectKey];
      if (!project?.path) {
        return NextResponse.json({ error: 'Project not found or has no path' }, { status: 404 });
      }
      resolvedKey = projectKey;
      resolvedPath = project.path;
    }

    const orchId = await orchestratorManager.start(resolvedKey, resolvedPath, prompt, teamId);
    return NextResponse.json({ orchestrationId: orchId, projectKey: resolvedKey });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * GET /api/orchestrator?projectKey=xxx — List orchestration sessions
 */
export async function GET(request: NextRequest) {
  const projectKey = request.nextUrl.searchParams.get('projectKey') ?? undefined;

  if (projectKey && !isValidProjectKey(projectKey)) {
    return NextResponse.json({ error: 'Invalid projectKey' }, { status: 400 });
  }

  const sessions = await orchestratorManager.listSessions(projectKey);
  return NextResponse.json({ sessions });
}
