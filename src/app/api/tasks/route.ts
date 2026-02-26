import { NextRequest, NextResponse } from 'next/server';
import { getTasksPath, readJsonFile, modifyJsonFile } from '@/lib/file-store';
import { processManager } from '@/lib/process-manager';
import { isValidProjectKey } from '@/lib/security';
import type { Task, TasksData, SessionPhase } from '@/types';

const DEFAULT_TASKS_DATA: TasksData = { tasks: [] };

/**
 * GET /api/tasks
 * Return all tasks, each enriched with `aiStatus`.
 * Optional query: ?flowTaskId=xxx — find a session originating from this flow task.
 */
export async function GET(request: NextRequest) {
  const data = await readJsonFile<TasksData>(getTasksPath(), DEFAULT_TASKS_DATA);

  const flowTaskId = request.nextUrl.searchParams.get('flowTaskId');
  if (flowTaskId) {
    // 🔒 Security: validate flowTaskId format
    if (!/^[a-zA-Z0-9_-]+$/.test(flowTaskId) || flowTaskId.length > 100) {
      return NextResponse.json({ error: 'Invalid flowTaskId' }, { status: 400 });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tasks: Task[] = (data as any).tasks ?? [];
    const match = tasks.find(
      s => s.flowContext?.flowTaskId === flowTaskId && !s.archived,
    );
    return NextResponse.json({ session: match ?? null });
  }

  // Enrich each task with AI process status
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tasks: Task[] = (data as any).tasks ?? [];
  const enriched = tasks.map((t) => {
    const pm = processManager.getStatus(t.id);
    let aiStatus: 'running' | 'waiting' | 'confirm' | null = null;
    if (pm.status === 'running') {
      aiStatus = 'running';
    } else if (t.status === 'doing' && t.claudeSessionId) {
      aiStatus = t.phase === 'summarizing' ? 'confirm' : 'waiting';
    }
    return { ...t, aiStatus };
  });

  return NextResponse.json({ tasks: enriched });
}

/**
 * POST /api/tasks
 * Create a new task.
 * Body: { title, content?, projectKey? }
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { title, content, projectKey, flowContext, agentId } = body;

  // 🔒 Security: validate title
  if (!title || typeof title !== 'string') {
    return NextResponse.json(
      { error: 'title is required and must be a string' },
      { status: 400 },
    );
  }
  if (title.length < 1 || title.length > 500) {
    return NextResponse.json(
      { error: 'title must be between 1 and 500 characters' },
      { status: 400 },
    );
  }

  // 🔒 Security: validate content length if provided
  if (content !== undefined && content !== null) {
    if (typeof content !== 'string') {
      return NextResponse.json(
        { error: 'content must be a string' },
        { status: 400 },
      );
    }
    if (content.length > 50000) {
      return NextResponse.json(
        { error: 'content must not exceed 50000 characters' },
        { status: 400 },
      );
    }
  }

  // 🔒 Security: validate projectKey format if provided
  if (projectKey !== undefined && projectKey !== null) {
    if (!isValidProjectKey(projectKey)) {
      return NextResponse.json(
        { error: 'Invalid projectKey format' },
        { status: 400 },
      );
    }
  }

  // 🔒 Security: validate agentId format if provided
  if (agentId !== undefined && agentId !== null) {
    if (typeof agentId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(agentId) || agentId.length > 100) {
      return NextResponse.json(
        { error: 'Invalid agentId format' },
        { status: 400 },
      );
    }
  }

  const now = new Date().toISOString();
  const newTask: Task = {
    id: `task-${Date.now()}`,
    title,
    content: content ?? undefined,
    ...(projectKey && { projectKey }),
    ...(flowContext && { flowContext }),
    ...(agentId && { agentId }),
    status: 'todo',
    phase: (projectKey ? 'branching' : 'understanding') as SessionPhase,
    createdAt: now,
    updatedAt: now,
  };

  await modifyJsonFile<TasksData>(getTasksPath(), DEFAULT_TASKS_DATA, (data) => ({
    ...data,
    tasks: [...data.tasks, newTask],
  }));

  return NextResponse.json(newTask, { status: 201 });
}
