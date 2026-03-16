/**
 * 共享记忆（Shared Memory / Blackboard）
 *
 * Agent 间的公共笔记本。一个 Agent 写入的记忆，其他 Agent 可以在提示词中看到。
 * 支持项目级和全局两种作用域。
 *
 * 数据存储：
 *   ~/.project-pilot/data/shared-memory/
 *     ├── _global.json           # 全局共享记忆
 *     └── {projectKey}.json      # 项目级共享记忆
 *
 * CLI 使用方式（Agent 在 bash 中调用）：
 *   写入：npx tsx src/lib/shared-memory.ts write --key "发现" --value "内容" [--project <key>] [--author <name>] [--ttl <hours>]
 *   读取：npx tsx src/lib/shared-memory.ts read --key "发现" [--project <key>]
 *   列表：npx tsx src/lib/shared-memory.ts list [--project <key>]
 *   删除：npx tsx src/lib/shared-memory.ts delete --key "发现" [--project <key>]
 *   清理：npx tsx src/lib/shared-memory.ts prune  (删除过期条目)
 */

import { getDataDir, readJsonFile, modifyJsonFile } from './file-store';
import path from 'path';
import { promises as fs } from 'fs';

// ── 类型定义 ──

export interface SharedMemoryEntry {
  /** 记忆键名，同 scope 内唯一 */
  key: string;
  /** 记忆内容（纯文本） */
  value: string;
  /** 写入者标识（Agent 名称或 ID） */
  author: string;
  /** 写入时间 ISO */
  createdAt: string;
  /** 最后更新时间 ISO */
  updatedAt: string;
  /** 过期时间 ISO（可选，null = 永不过期） */
  expiresAt?: string;
}

export interface SharedMemoryData {
  entries: SharedMemoryEntry[];
}

const EMPTY_DATA: SharedMemoryData = { entries: [] };

// ── 路径 ──

function getSharedMemoryDir(): string {
  return path.join(getDataDir(), 'storage', 'shared-memory');
}

function getSharedMemoryPath(projectKey?: string): string {
  const fileName = projectKey
    ? `${projectKey.replace(/[^a-zA-Z0-9_-]/g, '')}.json`
    : '_global.json';
  return path.join(getSharedMemoryDir(), fileName);
}

async function ensureDir(): Promise<void> {
  await fs.mkdir(getSharedMemoryDir(), { recursive: true });
}

// ── 核心函数 ──

/** 写入或更新一条记忆 */
export async function writeMemory(opts: {
  key: string;
  value: string;
  author?: string;
  projectKey?: string;
  ttlHours?: number;
}): Promise<SharedMemoryEntry> {
  await ensureDir();
  const filePath = getSharedMemoryPath(opts.projectKey);
  const now = new Date().toISOString();
  const expiresAt = opts.ttlHours
    ? new Date(Date.now() + opts.ttlHours * 3600_000).toISOString()
    : undefined;

  let entry!: SharedMemoryEntry;

  await modifyJsonFile<SharedMemoryData>(filePath, EMPTY_DATA, (data) => {
    const idx = data.entries.findIndex(e => e.key === opts.key);
    if (idx >= 0) {
      // 更新已有
      data.entries[idx] = {
        ...data.entries[idx],
        value: opts.value,
        author: opts.author || data.entries[idx].author,
        updatedAt: now,
        expiresAt: expiresAt ?? data.entries[idx].expiresAt,
      };
      entry = data.entries[idx];
    } else {
      // 新建
      entry = {
        key: opts.key,
        value: opts.value,
        author: opts.author || 'unknown',
        createdAt: now,
        updatedAt: now,
        expiresAt,
      };
      data.entries.push(entry);
    }
    return data;
  });

  return entry;
}

/** 读取一条记忆 */
export async function readMemory(
  key: string,
  projectKey?: string,
): Promise<SharedMemoryEntry | undefined> {
  const filePath = getSharedMemoryPath(projectKey);
  const data = await readJsonFile<SharedMemoryData>(filePath, EMPTY_DATA);
  const entry = data.entries.find(e => e.key === key);
  if (entry?.expiresAt && new Date(entry.expiresAt) < new Date()) {
    return undefined; // 已过期
  }
  return entry;
}

/** 列出所有有效记忆 */
export async function listMemories(projectKey?: string): Promise<SharedMemoryEntry[]> {
  const filePath = getSharedMemoryPath(projectKey);
  const data = await readJsonFile<SharedMemoryData>(filePath, EMPTY_DATA);
  const now = new Date();
  return data.entries.filter(e => !e.expiresAt || new Date(e.expiresAt) > now);
}

/** 删除一条记忆 */
export async function deleteMemory(key: string, projectKey?: string): Promise<boolean> {
  const filePath = getSharedMemoryPath(projectKey);
  let found = false;
  await modifyJsonFile<SharedMemoryData>(filePath, EMPTY_DATA, (data) => {
    const before = data.entries.length;
    data.entries = data.entries.filter(e => e.key !== key);
    found = data.entries.length < before;
    return data;
  });
  return found;
}

/** 清理所有过期条目（跨所有文件） */
export async function pruneExpired(): Promise<number> {
  const dir = getSharedMemoryDir();
  let pruned = 0;
  try {
    const files = await fs.readdir(dir);
    const now = new Date();
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const filePath = path.join(dir, file);
      await modifyJsonFile<SharedMemoryData>(filePath, EMPTY_DATA, (data) => {
        const before = data.entries.length;
        data.entries = data.entries.filter(
          e => !e.expiresAt || new Date(e.expiresAt) > now,
        );
        pruned += before - data.entries.length;
        return data;
      });
    }
  } catch {
    // 目录不存在 = 没什么好清理的
  }
  return pruned;
}

/** 获取所有作用域的记忆摘要（供 ResourceLoader 使用） */
export async function getMemorySummary(projectKey?: string): Promise<string> {
  const global = await listMemories();
  const project = projectKey ? await listMemories(projectKey) : [];

  if (global.length === 0 && project.length === 0) {
    return '';
  }

  const lines: string[] = [];

  const renderEntry = (e: SharedMemoryEntry) => {
    const ttl = e.expiresAt ? ` (过期: ${e.expiresAt.slice(0, 16)})` : '';
    return `- **${e.key}**${ttl}: ${e.value}\n  _— ${e.author}, ${e.updatedAt.slice(0, 16)}_`;
  };

  if (project.length > 0) {
    lines.push(`### 项目记忆 (${projectKey})`);
    lines.push(...project.map(renderEntry));
  }

  if (global.length > 0) {
    lines.push('### 全局记忆');
    lines.push(...global.map(renderEntry));
  }

  return lines.join('\n');
}

// ── CLI 入口 ──

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        result[key] = next;
        i++;
      } else {
        result[key] = 'true';
      }
    }
  }
  return result;
}

async function main() {
  const rawArgs = process.argv.slice(2);
  const command = rawArgs[0];
  const opts = parseArgs(rawArgs.slice(1));

  switch (command) {
    case 'write': {
      if (!opts['key'] || !opts['value']) {
        process.stderr.write('Usage: shared-memory.ts write --key <key> --value <value> [--project <key>] [--author <name>] [--ttl <hours>]\n');
        process.exit(1);
      }
      const entry = await writeMemory({
        key: opts['key'],
        value: opts['value'],
        author: opts['author'],
        projectKey: opts['project'],
        ttlHours: opts['ttl'] ? parseFloat(opts['ttl']) : undefined,
      });
      process.stdout.write(JSON.stringify(entry, null, 2));
      break;
    }

    case 'read': {
      if (!opts['key']) {
        process.stderr.write('Usage: shared-memory.ts read --key <key> [--project <key>]\n');
        process.exit(1);
      }
      const entry = await readMemory(opts['key'], opts['project']);
      if (!entry) {
        process.stderr.write(`Key not found or expired: ${opts['key']}\n`);
        process.exit(1);
      }
      process.stdout.write(JSON.stringify(entry, null, 2));
      break;
    }

    case 'list': {
      const entries = await listMemories(opts['project']);
      process.stdout.write(JSON.stringify(entries, null, 2));
      break;
    }

    case 'delete': {
      if (!opts['key']) {
        process.stderr.write('Usage: shared-memory.ts delete --key <key> [--project <key>]\n');
        process.exit(1);
      }
      const found = await deleteMemory(opts['key'], opts['project']);
      process.stdout.write(found ? 'Deleted' : 'Not found');
      if (!found) process.exit(1);
      break;
    }

    case 'prune': {
      const count = await pruneExpired();
      process.stdout.write(`Pruned ${count} expired entries`);
      break;
    }

    default:
      process.stderr.write(
        'Usage: shared-memory.ts <write|read|list|delete|prune> [options]\n' +
        '\nCommands:\n' +
        '  write   --key <key> --value <value> [--project <key>] [--author <name>] [--ttl <hours>]\n' +
        '  read    --key <key> [--project <key>]\n' +
        '  list    [--project <key>]\n' +
        '  delete  --key <key> [--project <key>]\n' +
        '  prune\n',
      );
      process.exit(1);
  }
}

const isDirectRun = process.argv[1]?.replace(/\\/g, '/').includes('shared-memory');
if (isDirectRun) {
  main().catch((err) => {
    process.stderr.write(`[shared-memory] ${(err as Error).message}\n`);
    process.exit(1);
  });
}
