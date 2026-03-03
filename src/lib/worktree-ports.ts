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
 */

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
    default:
      console.error('Commands: register, release, list');
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
