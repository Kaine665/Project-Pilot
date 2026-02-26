import { NextRequest, NextResponse } from 'next/server';
import {
  getTasksPath,
  getProjectsPath,
  readJsonFile,
  modifyJsonFile,
} from '@/lib/file-store';
import path from 'path';
import {
  validateWorkingDir,
  validateBranchName,
  validateWorktreePath,
  safeGitCheckout,
  safeGitCreateBranch,
  safeGitMerge,
  safeGitDeleteBranch,
  safeGitCurrentBranch,
  safeGitWorktreeAdd,
  safeGitWorktreeRemove,
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
      return await handleCreateBranch(taskId, task.title, task.gitBranch, task.worktreePath, workingDir, project?.defaultBranch);
    } else if (action === 'merge') {
      return await handleMerge(taskId, task.gitBranch, task.worktreePath, workingDir, project?.defaultBranch);
    } else if (action === 'discard') {
      return await handleDiscard(taskId, task.gitBranch, task.worktreePath, workingDir, project?.defaultBranch);
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
  existingWorktreePath: string | undefined,
  workingDir: string,
  defaultBranch?: string,
) {
  try {
    validateWorkingDir(workingDir);

    if (existingBranch) {
      // Branch already exists — if worktree exists, just report it
      validateBranchName(existingBranch);

      return NextResponse.json({
        ok: true,
        branch: existingBranch,
        worktreePath: existingWorktreePath,
        message: `任务分支 ${existingBranch} 已存在`,
        created: false,
      });
    }

    // Determine base branch
    const baseBranch = defaultBranch ?? detectDefaultBranch(workingDir);

    // Generate branch name: task/{taskId}-{short-description}
    const slug = slugify(taskTitle);
    const branchName = slug ? `task/${taskId}-${slug}` : `task/${taskId}`;

    validateBranchName(branchName);
    validateBranchName(baseBranch);

    // Compute worktree path
    const shortId = taskId.replace(/^task-/, '').slice(-8);
    const safeName = branchName.replace(/^task\//, '').replace(/[^a-zA-Z0-9_-]/g, '-');
    const worktreePath = path.join(workingDir, '.worktrees', `${shortId}-${safeName}`);
    validateWorktreePath(worktreePath, workingDir);

    // Create worktree with new branch
    try {
      safeGitWorktreeAdd(worktreePath, branchName, baseBranch, workingDir);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return NextResponse.json(
        { error: `Failed to create worktree: ${message}` },
        { status: 500 },
      );
    }

    // Save branch name and worktree path to task
    await modifyJsonFile<TasksData>(getTasksPath(), { tasks: [] }, (data) => {
      const t = data.tasks.find((t) => t.id === taskId);
      if (t) {
        t.gitBranch = branchName;
        t.worktreePath = worktreePath;
        t.updatedAt = new Date().toISOString();
      }
      return data;
    });

    return NextResponse.json({
      ok: true,
      branch: branchName,
      baseBranch,
      worktreePath,
      message: `已从 ${baseBranch} 创建任务分支 ${branchName}（worktree）`,
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
  worktreePath: string | undefined,
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
    validateWorkingDir(workingDir);
    validateBranchName(gitBranch);

    const targetBranch = defaultBranch ?? detectDefaultBranch(workingDir);
    validateBranchName(targetBranch);

    // Remove worktree first (can't delete branch while it's checked out in a worktree)
    if (worktreePath) {
      try {
        safeGitWorktreeRemove(worktreePath, workingDir, true);
      } catch { /* best-effort */ }
    }

    // Switch to target branch in main repo
    safeGitCheckout(targetBranch, workingDir);

    // Merge task branch
    const mergeOutput = safeGitMerge(gitBranch, workingDir, `Merge task branch ${gitBranch}`);

    // Delete the merged branch (best-effort)
    try {
      safeGitDeleteBranch(gitBranch, workingDir);
    } catch { /* best-effort */ }

    // Clear gitBranch and worktreePath from task
    await modifyJsonFile<TasksData>(getTasksPath(), { tasks: [] }, (data) => {
      const t = data.tasks.find((t) => t.id === taskId);
      if (t) {
        t.gitBranch = undefined;
        t.worktreePath = undefined;
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
  worktreePath: string | undefined,
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

    // Remove worktree first
    if (worktreePath) {
      try {
        safeGitWorktreeRemove(worktreePath, workingDir, true);
      } catch { /* best-effort */ }
    }

    // Switch to default branch
    safeGitCheckout(targetBranch, workingDir);

    // Force-delete the task branch (it's unmerged, that's intentional)
    safeGitDeleteBranch(gitBranch, workingDir, true);

    // Clear gitBranch and worktreePath from task
    await modifyJsonFile<TasksData>(getTasksPath(), { tasks: [] }, (data) => {
      const t = data.tasks.find((t) => t.id === taskId);
      if (t) {
        t.gitBranch = undefined;
        t.worktreePath = undefined;
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

