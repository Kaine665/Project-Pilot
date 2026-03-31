/**
 * Worktree 端口注册表
 *
 * 管理开发 worktree 的端口分配，避免多个并行任务端口冲突。
 * 数据存储在 {DATA_DIR}/config/worktree-ports.json
 *
 * 使用方式（Agent 在 bash 中调用）：
 *   注册：npx tsx src/lib/worktree-ports.ts register <branch> <description>
 *   释放：npx tsx src/lib/worktree-ports.ts release <branch>
 *   查看：npx tsx src/lib/worktree-ports.ts list
 *   清理：npx tsx src/lib/worktree-ports.ts cleanup <branch> <worktreePath>
 */

import { execSync } from 'child_process';
import path from 'path';
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

/**
 * Windows 上的 worktree 目录删除。
 *
 * 核心问题：npm install 产生的 .node 原生模块（如 tailwindcss-oxide）
 * 会被 Windows 锁住文件句柄，导致整个目录删不掉。
 *
 * 策略：
 * 1. 先尝试直接删除整个目录（快速路径）
 * 2. 如果失败，递归遍历逐个删除文件和子目录
 * 3. 遇到文件锁（EBUSY/EPERM/EACCES）就跳过，继续删别的
 * 4. 最后把删不掉的残留整体移到 _trashs/
 */
async function removeWorktreeDirectory(dirPath: string): Promise<boolean> {
  try {
    await fsPromises.stat(dirPath);
  } catch {
    return true; // 已不存在
  }

  // 快速路径：尝试直接删除
  if (await tryRemoveDir(dirPath)) return true;

  // 精细删除：递归遍历，逐个删，跳过被锁文件
  console.log('  Direct removal failed, trying incremental deletion...');
  await incrementalDelete(dirPath);

  // 检查目录是否已空/已删
  if (await tryRemoveDir(dirPath)) return true;

  // 仍有残留（被锁文件），移到 _trashs/
  const dirName = path.basename(dirPath);
  const trashRoot = path.join(path.dirname(dirPath), '_trashs');
  const trashDest = path.join(trashRoot, `${dirName}_${Date.now()}`);

  try {
    await fsPromises.mkdir(trashRoot, { recursive: true });
    console.log('  Moving locked remnants to _trashs/...');
    await fsPromises.rename(dirPath, trashDest);
    return true;
  } catch {
    console.log('  Failed to move remnants to _trashs/, directory partially cleaned');
    return false;
  }
}

/**
 * 递归删除目录内容，遇到文件锁就跳过继续。
 * 采用后序遍历：先删子文件/子目录，再删父目录。
 */
async function incrementalDelete(dirPath: string): Promise<void> {
  let entries;
  try {
    entries = await fsPromises.readdir(dirPath, { withFileTypes: true });
  } catch {
    return; // 目录已不存在或无权限
  }

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      await incrementalDelete(fullPath);
      // 子内容删完后尝试删空目录
      try {
        await fsPromises.rmdir(fullPath);
      } catch {
        // 目录非空（有被锁文件）或已不存在，跳过
      }
    } else {
      try {
        await fsPromises.unlink(fullPath);
      } catch {
        // 文件被锁，跳过
      }
    }
  }
}

/** 尝试删除目录，返回是否成功（目录不存在也算成功） */
async function tryRemoveDir(dirPath: string): Promise<boolean> {
  try {
    if (process.platform === 'win32') {
      execSync(`rd /s /q "${dirPath}"`, { stdio: 'pipe' });
    } else {
      await fsPromises.rm(dirPath, { recursive: true, force: true });
    }
  } catch {
    // 删除命令失败
  }
  // rd /s /q 可能部分删除但不报错，需确认
  try {
    await fsPromises.stat(dirPath);
    return false;
  } catch {
    return true;
  }
}

/**
 * 尝试清理 _trashs/ 统一垃圾桶（尽力而为）。
 * 能删多少删多少，删不掉的留着下次再试。
 */
async function cleanupTrashDir(projectRoot: string): Promise<void> {
  const trashRoot = path.join(projectRoot, '_trashs');
  try {
    await fsPromises.stat(trashRoot);
  } catch {
    return; // 不存在
  }

  // 尝试直接删整个 _trashs/
  if (await tryRemoveDir(trashRoot)) {
    console.log('  Cleaned up _trashs/');
    return;
  }

  // 逐个子目录尝试
  try {
    const entries = await fsPromises.readdir(trashRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const sub = path.join(trashRoot, entry.name);
        if (await tryRemoveDir(sub)) {
          console.log(`  Cleaned up _trashs/${entry.name}`);
        }
      }
    }
  } catch {
    // 忽略
  }
}

/**
 * 完整清理一个 worktree：释放端口 → 删目录 → prune → 删分支 → 清理旧垃圾
 */
export async function cleanupWorktree(branch: string, worktreePath: string): Promise<void> {
  const projectRoot = path.dirname(worktreePath);

  // Step 1: 释放端口
  const released = await releasePort(branch);
  console.log(released ? `[1/5] Port released: ${branch}` : `[1/5] Port not found (already released or never registered)`);

  // Step 2: 删除 worktree 目录
  console.log(`[2/5] Removing directory: ${worktreePath}`);
  const removed = await removeWorktreeDirectory(worktreePath);
  if (removed) {
    console.log(`[2/5] Directory removed`);
  } else {
    console.error(`[2/5] FAILED: Could not remove directory.`);
    console.error(`  Manual cleanup needed: delete "${worktreePath}"`);
  }

  // Step 3: git worktree prune
  try {
    execSync('git worktree prune', { stdio: 'pipe' });
    console.log('[3/5] Git worktree pruned');
  } catch {
    console.log('[3/5] Git worktree prune skipped');
  }

  // Step 4: 删除分支
  try {
    execSync(`git branch -d "${branch}"`, { stdio: 'pipe' });
    console.log(`[4/5] Branch deleted: ${branch}`);
  } catch {
    try {
      execSync(`git branch -D "${branch}"`, { stdio: 'pipe' });
      console.log(`[4/5] Branch force-deleted: ${branch}`);
    } catch {
      console.log(`[4/5] Branch not found or already deleted: ${branch}`);
    }
  }

  // Step 5: 尝试清理 _trashs/ 垃圾桶
  console.log('[5/5] Cleaning up _trashs/...');
  await cleanupTrashDir(projectRoot);

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
