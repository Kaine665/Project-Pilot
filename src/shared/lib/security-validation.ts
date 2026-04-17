/**
 * 纯校验逻辑（无 Node 内置模块），可安全用于 Vite 客户端打包。
 * Git 子进程相关见 `security-git.ts`。
 */

import path from 'path';

// ── Git 分支名验证 ──

export function isValidBranchName(branch: string): boolean {
  if (!branch || typeof branch !== 'string') {
    return false;
  }

  if (branch.length < 1 || branch.length > 200) {
    return false;
  }

  if (!/^[a-zA-Z0-9/_-]+$/.test(branch)) {
    return false;
  }

  if (branch.startsWith('-')) {
    return false;
  }

  return true;
}

export function validateBranchName(branch: string | undefined): string {
  if (!branch) {
    throw new Error('Branch name is required');
  }
  if (!isValidBranchName(branch)) {
    throw new Error(`Invalid branch name: ${branch}`);
  }
  return branch;
}

// ── 工作目录验证 ──

export function isValidWorkingDir(dir: string): boolean {
  if (!dir || typeof dir !== 'string') {
    return false;
  }

  try {
    const resolved = path.resolve(dir);

    if (resolved.length > 500) {
      return false;
    }

    if (resolved.includes('\0')) {
      return false;
    }

    // Windows：`path.resolve` / 环境变量可能给出 `C:/...`，仅用 `:\\` 判断会误判为非法
    if (typeof process !== 'undefined' && process.platform === 'win32') {
      const winPath = path.normalize(resolved).replace(/\//g, '\\');
      if (!/^[a-zA-Z]:\\/.test(winPath)) {
        return false;
      }
    } else {
      if (!resolved.startsWith('/')) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
}

export function validateWorkingDir(dir: string | undefined): string {
  if (!dir) {
    throw new Error('Working directory is required');
  }
  if (!isValidWorkingDir(dir)) {
    throw new Error(`Invalid working directory: ${dir}`);
  }
  return dir;
}

/** 验证 worktree 路径：必须在 {projectPath}/.worktrees/ 下，防止路径穿越。 */
export function validateWorktreePath(worktreePath: string, projectPath: string): string {
  validateWorkingDir(projectPath);

  const resolved = path.resolve(worktreePath);
  const expectedPrefix = path.join(path.resolve(projectPath), '.worktrees');

  if (!resolved.startsWith(expectedPrefix + path.sep) && resolved !== expectedPrefix) {
    throw new Error(`Worktree path must be under ${expectedPrefix}`);
  }

  if (resolved.includes('\0')) {
    throw new Error('Invalid worktree path');
  }

  return resolved;
}

// ── 其他验证 ──

export function isValidTaskId(id: string): boolean {
  if (!id || typeof id !== 'string') {
    return false;
  }
  return /^task-[0-9]+$/.test(id) && id.length < 50;
}

export function isValidProjectKey(key: string): boolean {
  if (!key || typeof key !== 'string') {
    return false;
  }
  return /^[a-z0-9_-]+$/i.test(key) && key.length > 0 && key.length < 100;
}

export function isValidSessionId(id: string): boolean {
  if (!id || typeof id !== 'string') {
    return false;
  }
  return /^[a-z0-9-]+$/i.test(id) && id.length > 0 && id.length < 100;
}
