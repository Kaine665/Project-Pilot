/**
 * Worktree 端口注册表
 *
 * 管理开发 worktree 的端口分配，避免多个并行任务端口冲突。
 * 数据存储在 ~/.project-pilot/data/worktree-ports.json
 *
 * 使用方式（Agent 在 bash 中调用）：
 *   注册：npx tsx src/lib/worktree-ports.ts register <branch> <description>
 *   释放：npx tsx src/lib/worktree-ports.ts release <branch>
 *   查看：npx tsx src/lib/worktree-ports.ts list
 *   清理：npx tsx src/lib/worktree-ports.ts cleanup <branch> <worktreePath>
 */

import { execSync } from 'child_process';
import { promises as fsPromises } from 'fs';
import { getWorktreePortsPath, readJsonFile, modifyJsonFile } from './file-store';

// ── 类型定义 ──

export interface WorktreePortEntry {
  /** 分支名，如 dev/data-safety-260303 */
  branch: string;
  /** 分配的端口号 */
  port: number;
  /** 任务简述 */
  description: string;
  /** 注册时间 */
  registeredAt: string;
  /** 释放时间（未释放时为 undefined） */
  releasedAt?: string;
}

export interface WorktreePortsData {
  entries: WorktreePortEntry[];
}

// ── 常量 ──

/** 主实例端口（保留，不分配） */
const MAIN_PORT = 4000;

/** 开发实例端口起始值 */
const DEV_PORT_START = 4010;

/** 开发实例端口结束值（上限） */
const DEV_PORT_END = 4099;

const DEFAULT_DATA: WorktreePortsData = { entries: [] };

// ── 核心函数 ──

/** 读取当前注册表 */
export async function listWorktreePorts(): Promise<WorktreePortEntry[]> {
  const data = await readJsonFile<WorktreePortsData>(getWorktreePortsPath(), DEFAULT_DATA);
  return data.entries;
}

/** 获取所有活跃（未释放）的端口条目 */
export async function listActivePorts(): Promise<WorktreePortEntry[]> {
  const entries = await listWorktreePorts();
  return entries.filter(e => !e.releasedAt);
}

/** 为一个分支分配下一个可用端口并注册 */
export async function registerPort(branch: string, description: string): Promise<WorktreePortEntry> {
  const data = await modifyJsonFile<WorktreePortsData>(
    getWorktreePortsPath(),
    DEFAULT_DATA,
    (current) => {
      // 检查该分支是否已注册且未释放
      const existing = current.entries.find(e => e.branch === branch && !e.releasedAt);
      if (existing) {
        // 已注册，不重复分配
        return current;
      }

      // 找出所有被占用的端口
      const usedPorts = new Set(
        current.entries.filter(e => !e.releasedAt).map(e => e.port),
      );

      // 分配下一个可用端口
      let port = DEV_PORT_START;
      while (usedPorts.has(port) && port <= DEV_PORT_END) {
        port++;
      }
      if (port > DEV_PORT_END) {
        throw new Error(`No available ports in range ${DEV_PORT_START}-${DEV_PORT_END}`);
      }

      current.entries.push({
        branch,
        port,
        description,
        registeredAt: new Date().toISOString(),
      });

      return current;
    },
  );

  // 返回刚注册的（或已存在的）条目
  const entry = data.entries.find(e => e.branch === branch && !e.releasedAt);
  if (!entry) throw new Error(`Failed to register port for ${branch}`);
  return entry;
}

/** 释放一个分支的端口 */
export async function releasePort(branch: string): Promise<boolean> {
  let found = false;
  await modifyJsonFile<WorktreePortsData>(
    getWorktreePortsPath(),
    DEFAULT_DATA,
    (current) => {
      const entry = current.entries.find(e => e.branch === branch && !e.releasedAt);
      if (entry) {
        entry.releasedAt = new Date().toISOString();
        found = true;
      }
      return current;
    },
  );
  return found;
}

// ── Worktree 清理 ──

/** sleep 工具 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Windows 上带重试的目录删除。
 * NTFS 文件句柄释放有延迟，.node 原生模块尤其严重。
 * 策略：用 rd /s /q 删除，失败则等待后重试。
 */
async function removeDirectoryWithRetry(dirPath: string, maxRetries = 5): Promise<boolean> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await fsPromises.stat(dirPath);
    } catch {
      // 目录已不存在
      return true;
    }

    try {
      if (process.platform === 'win32') {
        // Windows: rd /s /q 比 Node fs.rm 更可靠地处理长路径和锁
        execSync(`rd /s /q "${dirPath}"`, { stdio: 'pipe' });
      } else {
        await fsPromises.rm(dirPath, { recursive: true, force: true });
      }
      return true;
    } catch {
      if (attempt < maxRetries) {
        const waitMs = attempt * 2000; // 2s, 4s, 6s, 8s, 10s
        console.log(`  Retry ${attempt}/${maxRetries}: directory locked, waiting ${waitMs / 1000}s...`);
        await sleep(waitMs);
      }
    }
  }
  return false;
}

/**
 * 完整清理一个 worktree：释放端口 → 删目录（带重试） → prune → 删分支
 */
export async function cleanupWorktree(branch: string, worktreePath: string): Promise<void> {
  // Step 1: 释放端口
  const released = await releasePort(branch);
  console.log(released ? `[1/4] Port released: ${branch}` : `[1/4] Port not found (already released or never registered)`);

  // Step 2: 删除 worktree 目录（带重试）
  console.log(`[2/4] Removing directory: ${worktreePath}`);
  const removed = await removeDirectoryWithRetry(worktreePath);
  if (removed) {
    console.log(`[2/4] Directory removed`);
  } else {
    console.error(`[2/4] FAILED: Could not remove directory after retries.`);
    console.error(`  Manual cleanup needed: rd /s /q "${worktreePath}"`);
    // 继续执行后续步骤，不中断
  }

  // Step 3: git worktree prune（清理 git 中的 worktree 记录）
  try {
    execSync('git worktree prune', { stdio: 'pipe' });
    console.log('[3/4] Git worktree pruned');
  } catch {
    console.log('[3/4] Git worktree prune skipped (not in a git repo or already clean)');
  }

  // Step 4: 删除分支
  try {
    execSync(`git branch -d "${branch}"`, { stdio: 'pipe' });
    console.log(`[4/4] Branch deleted: ${branch}`);
  } catch {
    // 分支可能未合并或不存在
    try {
      execSync(`git branch -D "${branch}"`, { stdio: 'pipe' });
      console.log(`[4/4] Branch force-deleted: ${branch}`);
    } catch {
      console.log(`[4/4] Branch not found or already deleted: ${branch}`);
    }
  }

  console.log('Cleanup complete.');
}

// ── CLI 入口 ──

async function main() {
  const [,, command, ...args] = process.argv;

  switch (command) {
    case 'register': {
      const [branch, ...descParts] = args;
      if (!branch) {
        console.error('Usage: register <branch> <description>');
        process.exit(1);
      }
      const description = descParts.join(' ') || branch;
      const entry = await registerPort(branch, description);
      console.log(JSON.stringify(entry, null, 2));
      break;
    }
    case 'release': {
      const [branch] = args;
      if (!branch) {
        console.error('Usage: release <branch>');
        process.exit(1);
      }
      const released = await releasePort(branch);
      console.log(released ? `Released: ${branch}` : `Not found: ${branch}`);
      break;
    }
    case 'list': {
      const entries = await listWorktreePorts();
      const active = entries.filter(e => !e.releasedAt);
      const released = entries.filter(e => e.releasedAt);
      console.log(`=== Active (${active.length}) ===`);
      for (const e of active) {
        console.log(`  :${e.port}  ${e.branch}  "${e.description}"  since ${e.registeredAt}`);
      }
      if (released.length > 0) {
        console.log(`=== Released (${released.length}) ===`);
        for (const e of released) {
          console.log(`  :${e.port}  ${e.branch}  released ${e.releasedAt}`);
        }
      }
      break;
    }
    case 'cleanup': {
      const [branch, worktreePath] = args;
      if (!branch || !worktreePath) {
        console.error('Usage: cleanup <branch> <worktreePath>');
        process.exit(1);
      }
      await cleanupWorktree(branch, worktreePath);
      break;
    }
    default:
      console.error('Commands: register, release, list, cleanup');
      process.exit(1);
  }
}

// 作为脚本直接运行时执行 CLI
const isDirectRun = process.argv[1]?.replace(/\\/g, '/').includes('worktree-ports');
if (isDirectRun) {
  main().catch(err => {
    console.error(err.message);
    process.exit(1);
  });
}
