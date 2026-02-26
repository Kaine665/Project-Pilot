import { NextRequest, NextResponse } from 'next/server';
import { getTasksPath, getFlowDataPath, getProjectsPath, readJsonFile, modifyJsonFile } from '@/lib/file-store';
import { isValidTaskId, isValidProjectKey, safeGitWorktreeRemove, safeGitDeleteBranch } from '@/lib/security';
import type { Task, TasksData, ProjectsData } from '@/types';
import type { FlowData, TreeItem, Status } from '@/types/flow';
import type { FlowTaskContext } from '@/types/flow-context';
import { isLegacyFormat, migrateLegacyToSections } from '@/lib/flow-migration';

const DEFAULT_TASKS_DATA: TasksData = { tasks: [] };

/**
 * GET /api/tasks/[id]
 * Return a single task by id.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // 🔒 Security: validate task ID format
  if (!isValidTaskId(id)) {
    return NextResponse.json({ error: 'Invalid task ID format' }, { status: 400 });
  }

  const data = await readJsonFile<TasksData>(getTasksPath(), DEFAULT_TASKS_DATA);
  const task = data.tasks.find((t) => t.id === id);

  if (!task) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 });
  }

  return NextResponse.json(task);
}

/**
 * PATCH /api/tasks/[id]
 * Update task fields (title, content, status, projectKey, ai_execution).
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // 🔒 Security: validate task ID format
  if (!isValidTaskId(id)) {
    return NextResponse.json({ error: 'Invalid task ID format' }, { status: 400 });
  }

  const body = await request.json();

  // 🔒 Security: validate input fields
  if (body.title !== undefined) {
    if (typeof body.title !== 'string' || body.title.length < 1 || body.title.length > 500) {
      return NextResponse.json(
        { error: 'title must be a string between 1 and 500 characters' },
        { status: 400 },
      );
    }
  }

  if (body.content !== undefined && body.content !== null) {
    if (typeof body.content !== 'string' || body.content.length > 50000) {
      return NextResponse.json(
        { error: 'content must be a string not exceeding 50000 characters' },
        { status: 400 },
      );
    }
  }

  if (body.projectKey !== undefined && body.projectKey !== null) {
    if (!isValidProjectKey(body.projectKey)) {
      return NextResponse.json(
        { error: 'Invalid projectKey format' },
        { status: 400 },
      );
    }
  }

  if (body.status !== undefined) {
    const validStatuses = ['todo', 'doing', 'done'];
    if (!validStatuses.includes(body.status)) {
      return NextResponse.json(
        { error: 'status must be one of: todo, doing, done' },
        { status: 400 },
      );
    }
  }

  let updatedTask: Task | null = null;

  await modifyJsonFile<TasksData>(getTasksPath(), DEFAULT_TASKS_DATA, (data) => {
    const index = data.tasks.findIndex((t) => t.id === id);
    if (index === -1) return data;

    const task = data.tasks[index];
    const now = new Date().toISOString();

    const merged: Task = {
      ...task,
      ...(body.title !== undefined && { title: body.title }),
      ...(body.content !== undefined && { content: body.content }),
      ...(body.status !== undefined && { status: body.status }),
      ...(body.projectKey !== undefined && { projectKey: body.projectKey }),
      ...(body.ai_execution !== undefined && { ai_execution: body.ai_execution }),
      ...(body.archived !== undefined && { archived: body.archived }),
      ...(body.phase !== undefined && { phase: body.phase }),
      ...(body.gitBranch !== undefined && { gitBranch: body.gitBranch }),
      updatedAt: now,
      ...(body.status === 'done' && !task.completedAt && { completedAt: now }),
    };

    const tasks = [...data.tasks];
    tasks[index] = merged;
    updatedTask = merged;
    return { ...data, tasks };
  });

  // updatedTask is assigned inside modifyJsonFile callback; TypeScript can't track closure mutations
  const finalTask = updatedTask as Task | null;
  if (!finalTask) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 });
  }

  // Sync status back to flow data if task originated from a flow
  if (body.status !== undefined && finalTask.flowContext) {
    await syncFlowTaskStatus(finalTask.flowContext, body.status as Status);
  }

  return NextResponse.json(finalTask);
}

/**
 * DELETE /api/tasks/[id]
 * Permanently remove a task. Cleans up worktree and branch if they exist.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // Read task data first to get worktree info for cleanup
  const tasksData = await readJsonFile<TasksData>(getTasksPath(), DEFAULT_TASKS_DATA);
  const task = tasksData.tasks.find((t) => t.id === id);

  if (!task) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 });
  }

  // Best-effort: cleanup worktree and branch before removing task data
  if (task.projectKey && (task.worktreePath || task.gitBranch)) {
    try {
      const projectsData = await readJsonFile<ProjectsData>(getProjectsPath(), { projects: {} });
      const project = projectsData.projects[task.projectKey];
      if (project?.path) {
        if (task.worktreePath) {
          try {
            safeGitWorktreeRemove(task.worktreePath, project.path, true);
          } catch { /* best-effort */ }
        }
        if (task.gitBranch) {
          try {
            safeGitDeleteBranch(task.gitBranch, project.path, true);
          } catch { /* best-effort */ }
        }
      }
    } catch { /* best-effort */ }
  }

  let found = false;
  await modifyJsonFile<TasksData>(getTasksPath(), DEFAULT_TASKS_DATA, (data) => {
    const index = data.tasks.findIndex((t) => t.id === id);
    if (index === -1) return data;
    found = true;
    const tasks = data.tasks.filter((t) => t.id !== id);
    return { ...data, tasks };
  });

  if (!found) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}

// ── Flow task status sync ──────────────────────────────────

function updateItemInList(items: TreeItem[], taskId: string, newStatus: Status): boolean {
  for (const item of items) {
    if (item.id === taskId) {
      item.status = newStatus;
      return true;
    }
    if (item.children?.length && updateItemInList(item.children, taskId, newStatus)) {
      return true;
    }
  }
  return false;
}

async function syncFlowTaskStatus(flowContext: FlowTaskContext, newStatus: Status): Promise<void> {
  try {
    await modifyJsonFile<FlowData>(
      getFlowDataPath(flowContext.projectKey),
      { sections: [] },
      (rawData) => {
        // 兼容旧格式
        const data: FlowData = isLegacyFormat(rawData)
          ? migrateLegacyToSections(rawData)
          : rawData as FlowData;

        for (const section of data.sections) {
          if (updateItemInList(section.items, flowContext.flowTaskId, newStatus)) {
            return data;
          }
        }
        return data;
      },
    );
  } catch (err) {
    console.error(`Failed to sync flow task status to ${newStatus}:`, err);
  }
}
