import { NextRequest, NextResponse } from 'next/server';
import { orchestratorManager } from '@/lib/chat-managers/orchestrator-manager';
import { readJsonFile, getProjectsPath } from '@/lib/file-store';
import type { ProjectsData } from '@/types';

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/orchestrator/[id] — Get orchestration status
 */
export async function GET(_request: NextRequest, { params }: Params) {
  const { id } = await params;

  const status = orchestratorManager.getStatus(id);
  if (status) {
    return NextResponse.json(status);
  }

  // Fallback: load from disk
  const session = await orchestratorManager.loadSession(id);
  if (session) {
    return NextResponse.json({
      session,
      eventCount: 0,
      completedWorkers: session.workers.filter(w => w.status === 'completed').length,
    });
  }

  return NextResponse.json({ error: 'Orchestration not found' }, { status: 404 });
}

/**
 * POST /api/orchestrator/[id] — Execute an action
 * Body: { action: 'confirm-split' | 'confirm-merge' | 'stop' }
 */
export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params;

  try {
    const body = await request.json();
    const { action } = body as { action?: string };

    if (!action) {
      return NextResponse.json({ error: 'action is required' }, { status: 400 });
    }

    switch (action) {
      case 'confirm-split':
      case 'confirm-merge': {
        // Need project path for git operations
        const session = await orchestratorManager.loadSession(id);
        if (!session) {
          return NextResponse.json({ error: 'Orchestration not found' }, { status: 404 });
        }

        const projectsData = await readJsonFile<ProjectsData>(getProjectsPath(), { projects: {} });
        const project = projectsData.projects[session.projectKey];
        if (!project?.path) {
          return NextResponse.json({ error: 'Project not found' }, { status: 404 });
        }

        if (action === 'confirm-split') {
          await orchestratorManager.confirmSplit(id, project.path);
        } else {
          await orchestratorManager.confirmMerge(id, project.path);
        }
        break;
      }
      case 'stop':
        await orchestratorManager.stop(id);
        break;
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
