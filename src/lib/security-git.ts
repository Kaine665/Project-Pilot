/**
 * 服务端 Git 子进程封装（依赖 `child_process`），勿在浏览器入口直接 import 本文件。
 */

import { execFileSync } from 'child_process';
import { isValidBranchName, validateBranchName, validateWorkingDir } from '@/lib/security-validation';

export interface SafeGitOptions {
  cwd: string;
  encoding?: BufferEncoding;
  stdio?: 'pipe' | 'inherit' | 'ignore';
}

export function safeGitExec(args: string[], options: SafeGitOptions): string {
  validateWorkingDir(options.cwd);

  for (const arg of args) {
    if (typeof arg !== 'string') {
      throw new Error('Git argument must be string');
    }
    if (arg.includes('\0')) {
      throw new Error('Invalid git argument');
    }
  }

  try {
    const result = execFileSync('git', args, {
      cwd: options.cwd,
      encoding: options.encoding ?? 'utf-8',
      stdio: options.stdio ?? 'pipe',
      env: {
        ...process.env,
        GIT_CONFIG_NOSYSTEM: '1',
      },
    });

    return typeof result === 'string' ? result.trim() : '';
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Git command failed';
    throw new Error(message);
  }
}

export function safeGitCheckout(branch: string, workingDir: string): void {
  validateBranchName(branch);
  validateWorkingDir(workingDir);
  safeGitExec(['checkout', branch], { cwd: workingDir });
}

export function safeGitCreateBranch(branch: string, workingDir: string): void {
  validateBranchName(branch);
  validateWorkingDir(workingDir);
  safeGitExec(['checkout', '-b', branch], { cwd: workingDir });
}

export function safeGitMerge(branch: string, workingDir: string, message?: string): string {
  validateBranchName(branch);
  validateWorkingDir(workingDir);

  const args = ['merge', branch, '--no-ff'];
  if (message) {
    args.push('-m', message);
  }

  return safeGitExec(args, { cwd: workingDir });
}

export function safeGitDeleteBranch(branch: string, workingDir: string, force = false): void {
  validateBranchName(branch);
  validateWorkingDir(workingDir);
  safeGitExec(['branch', force ? '-D' : '-d', branch], { cwd: workingDir, stdio: 'pipe' });
}

export function safeGitWorktreeAdd(
  worktreePath: string,
  branch: string,
  baseBranch: string,
  repoDir: string,
): void {
  validateWorkingDir(repoDir);
  validateBranchName(branch);
  validateBranchName(baseBranch);
  safeGitExec(['worktree', 'add', worktreePath, '-b', branch, baseBranch], { cwd: repoDir });
}

export function safeGitWorktreeRemove(worktreePath: string, repoDir: string, force = false): void {
  validateWorkingDir(repoDir);
  const args = ['worktree', 'remove', worktreePath];
  if (force) args.push('--force');
  safeGitExec(args, { cwd: repoDir });
}

export function safeGitCurrentBranch(workingDir: string): string {
  validateWorkingDir(workingDir);
  return safeGitExec(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: workingDir });
}

export function safeGitVerifyBranch(branch: string, workingDir: string): boolean {
  validateBranchName(branch);
  validateWorkingDir(workingDir);
  try {
    safeGitExec(['rev-parse', '--verify', branch], { cwd: workingDir, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

export function detectDefaultBranch(workingDir: string): string {
  validateWorkingDir(workingDir);

  try {
    const ref = safeGitExec(['symbolic-ref', 'refs/remotes/origin/HEAD'], {
      cwd: workingDir,
      stdio: 'pipe',
    });
    const branch = ref.replace('refs/remotes/origin/', '');
    if (branch && isValidBranchName(branch)) {
      return branch;
    }
  } catch {
    // Remote HEAD 未设置
  }

  for (const name of ['main', 'master', 'develop']) {
    if (safeGitVerifyBranch(name, workingDir)) {
      return name;
    }
  }

  return safeGitCurrentBranch(workingDir);
}
