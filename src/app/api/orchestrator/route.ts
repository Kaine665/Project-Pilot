import { NextRequest, NextResponse } from 'next/server';
import { orchestratorManager } from '@/lib/chat-managers/orchestrator-manager';
import { readJsonFile, getProjectsPath } from '@/lib/file-store';
import { isValidProjectKey } from '@/lib/security';
import type { ProjectsData } from '@/types';

/**
 * POST /api/orchestrator — Start a new orchestration
 * Body: { projectKey: string, prompt: string, teamId?: string }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { projectKey, prompt, teamId } = body as { projectKey?: string; prompt?: string; teamId?: string };

    if (!projectKey || !prompt) {
      return NextResponse.json({ error: 'projectKey and prompt are required' }, { status: 400 });
    }
    if (!isValidProjectKey(projectKey)) {
      return NextResponse.json({ error: 'Invalid projectKey' }, { status: 400 });
    }
    if (prompt.length > 20000) {
      return NextResponse.json({ error: 'Prompt too long (max 20000 chars)' }, { status: 400 });
    }

    const projectsData = await readJsonFile<ProjectsData>(getProjectsPath(), { projects: {} });
    const project = projectsData.projects[projectKey];
    if (!project?.path) {
      return NextResponse.json({ error: 'Project not found or has no path' }, { status: 404 });
    }

    const orchId = await orchestratorManager.start(projectKey, project.path, prompt, teamId);
    return NextResponse.json({ orchestrationId: orchId });
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
