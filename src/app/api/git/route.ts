import { NextRequest, NextResponse } from 'next/server';
import {
  getTasksPath,
  getProjectsPath,
  readJsonFile,
  modifyJsonFile,
} from '@/lib/file-store';
import {
  validateWorkingDir,
  validateBranchName,
  safeGitCheckout,
  safeGitCreateBranch,
  safeGitMerge,
  safeGitDeleteBranch,
  safeGitCurrentBranch,
  detectDefaultBranch,
  isValidTaskId,
} from '@/lib/security';
import type { TasksData, ProjectsData } from '@/types';

/**
 * POST /api/git
 * Create a task branch or merge it.
 * Body: { taskId: string, action: 'create-branch' | 'merge' }
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { taskId, action } = body as { taskId: string; action: string };

  // 🔒 Security: validate required fields
  if (!taskId || !action) {
    return NextResponse.json(
      { error: 'taskId and action are required' },
      { status: 400 },
    );
  }

  // 🔒 Security: validate taskId format
  if (!isValidTaskId(taskId)) {
    return NextResponse.json(
      { error: 'Invalid taskId format' },
      { status: 400 },
    );
  }

  // 🔒 Security: validate action value
  const validActions = ['create-branch', 'merge', 'discard'];
  if (!validActions.includes(action)) {
    return NextResponse.json(
      { error: 'action must be one of: create-branch, merge, discard' },
      { status: 400 },
    );
  }

  // Load task and project
  const tasksData = await readJsonFile<TasksData>(getTasksPath(), { tasks: [] });
  const task = tasksData.tasks.find((t) => t.id === taskId);
  if (!task) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 });
  }

  const projectsData = await readJsonFile<ProjectsData>(getProjectsPath(), { projects: {} });
  const project = task.projectKey ? projectsData.projects[task.projectKey] ?? null : null;
  const workingDir = project?.path;

  if (!workingDir) {
    return NextResponse.json(
      { error: 'Project has no working directory' },
      { status: 400 },
    );
  }

  try {
    if (action === 'create-branch') {
      return await handleCreateBranch(taskId, task.title, task.gitBranch, workingDir, project?.defaultBranch);
    } else if (action === 'merge') {
      return await handleMerge(taskId, task.gitBranch, workingDir, project?.defaultBranch);
    } else if (action === 'discard') {
      return await handleDiscard(taskId, task.gitBranch, workingDir, project?.defaultBranch);
    } else {
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * GET /api/git?taskId=xxx
 * Get git branch status for a task.
 */
export async function GET(request: NextRequest) {
  const taskId = request.nextUrl.searchParams.get('taskId');

  // 🔒 Security: validate taskId
  if (!taskId) {
    return NextResponse.json({ error: 'taskId is required' }, { status: 400 });
  }

  if (!isValidTaskId(taskId)) {
    return NextResponse.json({ error: 'Invalid taskId format' }, { status: 400 });
  }

  const tasksData = await readJsonFile<TasksData>(getTasksPath(), { tasks: [] });
  const task = tasksData.tasks.find((t) => t.id === taskId);
  if (!task) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 });
  }

  const projectsData = await readJsonFile<ProjectsData>(getProjectsPath(), { projects: {} });
  const project = task.projectKey ? projectsData.projects[task.projectKey] ?? null : null;
  const workingDir = project?.path;

  if (!workingDir) {
    return NextResponse.json({ gitBranch: null, currentBranch: null });
  }

  try {
    // Validate working directory
    validateWorkingDir(workingDir);

    const currentBranch = safeGitCurrentBranch(workingDir);

    return NextResponse.json({
      gitBranch: task.gitBranch ?? null,
      currentBranch,
      isOnTaskBranch: task.gitBranch ? currentBranch === task.gitBranch : false,
    });
  } catch {
    return NextResponse.json({ gitBranch: task.gitBranch ?? null, currentBranch: null });
  }
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff]+/g, '-') // non-word (except CJK) → dash
    .replace(/[\u4e00-\u9fff]+/g, '')      // remove CJK characters (not git-friendly)
    .replace(/-+/g, '-')                   // collapse multiple dashes
    .replace(/^-|-$/g, '')                 // trim leading/trailing dashes
    .slice(0, 30);                         // keep it short
}

async function handleCreateBranch(
  taskId: string,
  taskTitle: string,
  existingBranch: string | undefined,
  workingDir: string,
  defaultBranch?: string,
) {
  try {
    // Validate working directory
    validateWorkingDir(workingDir);

    if (existingBranch) {
      // Validate existing branch name
      validateBranchName(existingBranch);

      // Branch already exists, just check it out
      try {
        const currentBranch = safeGitCurrentBranch(workingDir);

        if (currentBranch !== existingBranch) {
          safeGitCheckout(existingBranch, workingDir);
        }

        return NextResponse.json({
          ok: true,
          branch: existingBranch,
          message: `已切换到任务分支 ${existingBranch}`,
          created: false,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return NextResponse.json({ error: `Failed to checkout branch: ${message}` }, { status: 500 });
      }
    }

    // Determine base branch
    const baseBranch = defaultBranch ?? detectDefaultBranch(workingDir);

    // Generate branch name: task/{taskId}-{short-description}
    const slug = slugify(taskTitle);
    const branchName = slug ? `task/${taskId}-${slug}` : `task/${taskId}`;

    // Validate generated branch name
    validateBranchName(branchName);
    validateBranchName(baseBranch);

    // Create branch from base
    try {
      // Make sure we're on the base branch first
      safeGitCheckout(baseBranch, workingDir);
      // Create and switch to new branch
      safeGitCreateBranch(branchName, workingDir);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return NextResponse.json(
        { error: `Failed to create branch: ${message}` },
        { status: 500 },
      );
    }

    // Save branch name to task
    await modifyJsonFile<TasksData>(getTasksPath(), { tasks: [] }, (data) => {
      const t = data.tasks.find((t) => t.id === taskId);
      if (t) {
        t.gitBranch = branchName;
        t.updatedAt = new Date().toISOString();
      }
      return data;
    });

    return NextResponse.json({
      ok: true,
      branch: branchName,
      baseBranch,
      message: `已从 ${baseBranch} 创建任务分支 ${branchName}`,
      created: true,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function handleMerge(
  taskId: string,
  gitBranch: string | undefined,
  workingDir: string,
  defaultBranch?: string,
) {
  if (!gitBranch) {
    return NextResponse.json(
      { error: 'No task branch to merge' },
      { status: 400 },
    );
  }

  try {
    // Validate working directory
    validateWorkingDir(workingDir);

    // Validate branch names
    validateBranchName(gitBranch);

    const targetBranch = defaultBranch ?? detectDefaultBranch(workingDir);
    validateBranchName(targetBranch);

    // Switch to target branch
    safeGitCheckout(targetBranch, workingDir);

    // Merge task branch
    const mergeOutput = safeGitMerge(gitBranch, workingDir, `Merge task branch ${gitBranch}`);

    // Delete the merged branch
    try {
      safeGitDeleteBranch(gitBranch, workingDir);
    } catch {
      // Branch deletion is best-effort; may fail if not fully merged
    }

    // Clear gitBranch from task (merge complete)
    await modifyJsonFile<TasksData>(getTasksPath(), { tasks: [] }, (data) => {
      const t = data.tasks.find((t) => t.id === taskId);
      if (t) {
        t.gitBranch = undefined;
        t.updatedAt = new Date().toISOString();
      }
      return data;
    });

    return NextResponse.json({
      ok: true,
      message: `已将 ${gitBranch} 合并到 ${targetBranch}`,
      targetBranch,
      mergeOutput: mergeOutput.trim(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Merge failed: ${message}` },
      { status: 500 },
    );
  }
}

async function handleDiscard(
  taskId: string,
  gitBranch: string | undefined,
  workingDir: string,
  defaultBranch?: string,
) {
  if (!gitBranch) {
    return NextResponse.json(
      { error: 'No task branch to discard' },
      { status: 400 },
    );
  }

  try {
    validateWorkingDir(workingDir);
    validateBranchName(gitBranch);

    const targetBranch = defaultBranch ?? detectDefaultBranch(workingDir);
    validateBranchName(targetBranch);

    // Switch to default branch first
    safeGitCheckout(targetBranch, workingDir);

    // Force-delete the task branch (it's unmerged, that's intentional)
    safeGitDeleteBranch(gitBranch, workingDir, true);

    // Clear gitBranch from task
    await modifyJsonFile<TasksData>(getTasksPath(), { tasks: [] }, (data) => {
      const t = data.tasks.find((t) => t.id === taskId);
      if (t) {
        t.gitBranch = undefined;
        t.updatedAt = new Date().toISOString();
      }
      return data;
    });

    return NextResponse.json({
      ok: true,
      message: `已废弃分支 ${gitBranch}，已切回 ${targetBranch}`,
      targetBranch,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Discard failed: ${message}` },
      { status: 500 },
    );
  }
}

