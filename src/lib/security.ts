/**
 * Security utilities for input validation and command sanitization.
 *
 * 用于防止命令注入、路径遍历等安全漏洞的工具函数。
 */

import { execFileSync } from 'child_process';
import path from 'path';

// ── Git 分支名验证 ──

/**
 * 验证 Git 分支名是否安全。
 * 只允许字母、数字、斜杠、中划线、下划线。
 * 不允许特殊 shell 字符。
 */
export function isValidBranchName(branch: string): boolean {
  if (!branch || typeof branch !== 'string') {
    return false;
  }

  // 长度限制
  if (branch.length < 1 || branch.length > 200) {
    return false;
  }

  // 只允许安全字符
  if (!/^[a-zA-Z0-9/_-]+$/.test(branch)) {
    return false;
  }

  // 不允许以 - 开头（Git 会解释为选项）
  if (branch.startsWith('-')) {
    return false;
  }

  return true;
}

/**
 * 验证并清理 Git 分支名。
 * 如果验证失败则抛出错误。
 */
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

/**
 * 验证工作目录路径是否安全。
 * 确保路径已解析且不包含危险模式。
 */
export function isValidWorkingDir(dir: string): boolean {
  if (!dir || typeof dir !== 'string') {
    return false;
  }

  try {
    const resolved = path.resolve(dir);

    // 路径长度限制
    if (resolved.length > 500) {
      return false;
    }

    // 不允许包含 null 字节（可能绕过某些检查）
    if (resolved.includes('\0')) {
      return false;
    }

    // 在 Windows 上检查盘符
    if (process.platform === 'win32') {
      // 确保有有效的盘符
      if (!/^[a-zA-Z]:\\/.test(resolved)) {
        return false;
      }
    } else {
      // 在 Unix 上确保是绝对路径
      if (!resolved.startsWith('/')) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * 验证工作目录路径。
 * 如果验证失败则抛出错误。
 */
export function validateWorkingDir(dir: string | undefined): string {
  if (!dir) {
    throw new Error('Working directory is required');
  }
  if (!isValidWorkingDir(dir)) {
    throw new Error(`Invalid working directory: ${dir}`);
  }
  return dir;
}

// ── 安全的 Git 命令执行 ──

export interface SafeGitOptions {
  cwd: string;
  encoding?: BufferEncoding;
  stdio?: 'pipe' | 'inherit' | 'ignore';
}

/**
 * 安全地执行 Git 命令。
 * 使用 execFileSync 而非 execSync 避免 shell 注入。
 */
export function safeGitExec(
  args: string[],
  options: SafeGitOptions,
): string {
  // 验证工作目录
  validateWorkingDir(options.cwd);

  // 验证每个参数
  for (const arg of args) {
    if (typeof arg !== 'string') {
      throw new Error('Git argument must be string');
    }
    // 不允许 null 字节
    if (arg.includes('\0')) {
      throw new Error('Invalid git argument');
    }
  }

  try {
    // 使用 execFileSync 直接执行 git，不通过 shell
    const result = execFileSync('git', args, {
      cwd: options.cwd,
      encoding: options.encoding ?? 'utf-8',
      stdio: options.stdio ?? 'pipe',
      // 禁用 Git hooks（对于自动化操作更安全）
      env: {
        ...process.env,
        GIT_CONFIG_NOSYSTEM: '1',
      },
    });

    return typeof result === 'string' ? result.trim() : '';
  } catch (error) {
    // 重新抛出错误，但不暴露命令细节
    const message = error instanceof Error ? error.message : 'Git command failed';
    throw new Error(message);
  }
}

/**
 * 安全地切换 Git 分支。
 */
export function safeGitCheckout(branch: string, workingDir: string): void {
  validateBranchName(branch);
  validateWorkingDir(workingDir);
  safeGitExec(['checkout', branch], { cwd: workingDir });
}

/**
 * 安全地创建 Git 分支。
 */
export function safeGitCreateBranch(branch: string, workingDir: string): void {
  validateBranchName(branch);
  validateWorkingDir(workingDir);
  safeGitExec(['checkout', '-b', branch], { cwd: workingDir });
}

/**
 * 安全地合并 Git 分支。
 */
export function safeGitMerge(
  branch: string,
  workingDir: string,
  message?: string,
): string {
  validateBranchName(branch);
  validateWorkingDir(workingDir);

  const args = ['merge', branch, '--no-ff'];
  if (message) {
    args.push('-m', message);
  }

  return safeGitExec(args, { cwd: workingDir });
}

/**
 * 安全地删除 Git 分支。
 * @param force 使用 -D 强制删除（用于废弃未合并的分支）
 */
export function safeGitDeleteBranch(branch: string, workingDir: string, force = false): void {
  validateBranchName(branch);
  validateWorkingDir(workingDir);
  safeGitExec(['branch', force ? '-D' : '-d', branch], { cwd: workingDir, stdio: 'pipe' });
}

// ── Git Worktree 操作 ──

/**
 * 验证 worktree 路径安全性：必须在 {projectPath}/.worktrees/ 下，防止路径穿越。
 */
export function validateWorktreePath(worktreePath: string, projectPath: string): string {
  validateWorkingDir(projectPath);

  const resolved = path.resolve(worktreePath);
  const expectedPrefix = path.join(path.resolve(projectPath), '.worktrees');

  if (!resolved.startsWith(expectedPrefix + path.sep) && resolved !== expectedPrefix) {
    throw new Error(`Worktree path must be under ${expectedPrefix}`);
  }

  // 不允许 null 字节
  if (resolved.includes('\0')) {
    throw new Error('Invalid worktree path');
  }

  return resolved;
}

/**
 * 创建 git worktree 并新建分支。
 * 等价于: git worktree add <path> -b <branch> <baseBranch>
 */
export function safeGitWorktreeAdd(
  worktreePath: string,
  branch: string,
  baseBranch: string,
  repoDir: string,
): void {
  validateWorkingDir(repoDir);
  validateBranchName(branch);
  validateBranchName(baseBranch);
  safeGitExec(
    ['worktree', 'add', worktreePath, '-b', branch, baseBranch],
    { cwd: repoDir },
  );
}

/**
 * 移除 git worktree。
 * 等价于: git worktree remove <path> [--force]
 */
export function safeGitWorktreeRemove(
  worktreePath: string,
  repoDir: string,
  force = false,
): void {
  validateWorkingDir(repoDir);
  const args = ['worktree', 'remove', worktreePath];
  if (force) args.push('--force');
  safeGitExec(args, { cwd: repoDir });
}

/**
 * 获取当前分支名。
 */
export function safeGitCurrentBranch(workingDir: string): string {
  validateWorkingDir(workingDir);
  return safeGitExec(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: workingDir });
}

/**
 * 验证分支是否存在。
 */
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

/**
 * 检测默认分支（main 或 master）。
 */
export function detectDefaultBranch(workingDir: string): string {
  validateWorkingDir(workingDir);

  // 优先级 1: 尝试从 remote HEAD 获取
  try {
    const ref = safeGitExec(
      ['symbolic-ref', 'refs/remotes/origin/HEAD'],
      { cwd: workingDir, stdio: 'pipe' },
    );
    // "refs/remotes/origin/main" → "main"
    const branch = ref.replace('refs/remotes/origin/', '');
    if (branch && isValidBranchName(branch)) {
      return branch;
    }
  } catch {
    // Remote HEAD 未设置，继续下一步
  }

  // 优先级 2: 检查常见分支名
  for (const name of ['main', 'master', 'develop']) {
    if (safeGitVerifyBranch(name, workingDir)) {
      return name;
    }
  }

  // 优先级 3: 返回当前分支
  return safeGitCurrentBranch(workingDir);
}

// ── 其他验证 ──

/**
 * 验证 Task ID 格式。
 */
export function isValidTaskId(id: string): boolean {
  if (!id || typeof id !== 'string') {
    return false;
  }
  return /^task-[0-9]+$/.test(id) && id.length < 50;
}

/**
 * 验证 Project Key 格式。
 */
export function isValidProjectKey(key: string): boolean {
  if (!key || typeof key !== 'string') {
    return false;
  }
  return /^[a-z0-9_-]+$/i.test(key) && key.length > 0 && key.length < 100;
}

/**
 * 验证 Session ID 格式。
 */
export function isValidSessionId(id: string): boolean {
  if (!id || typeof id !== 'string') {
    return false;
  }
  // 允许 UUID、timestamp-based ID 等
  return /^[a-z0-9-]+$/i.test(id) && id.length > 0 && id.length < 100;
}
