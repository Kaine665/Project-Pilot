/**
 * 离线执行数据根初始化 + 项目索引合并（ensureDataDirV2Migrated），并做布局验收检查。
 *
 * 用法：
 *   npx tsx scripts/run-layout-migrations.ts [DATA_DIR]
 * 未传参时使用 PROJECT_PILOT_DATA_DIR 或默认 ~/.project-pilot（Windows: %USERPROFILE%\.project-pilot）
 *
 * 注意：必须在任何 import file-store 之前设置 PROJECT_PILOT_DATA_DIR（见下方动态 import）。
 * 历史一次性迁移（chat→sessions、V2 复制等）已不在此链中；详见 scripts/data-layout-migration.md。
 */

import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const arg = process.argv[2];
const dataRoot = path.resolve(arg ?? process.env.PROJECT_PILOT_DATA_DIR ?? path.join(os.homedir(), '.project-pilot'));
process.env.PROJECT_PILOT_DATA_DIR = dataRoot;

async function verifyLayout(dataDir: string): Promise<void> {
  const issues: string[] = [];
  const warns: string[] = [];

  const chatDir = path.join(dataDir, 'chat');
  try {
    const st = await fs.stat(chatDir);
    if (st.isDirectory()) {
      const entries = (await fs.readdir(chatDir)).filter((e) => e !== '.DS_Store');
      if (entries.length > 0) {
        issues.push(`chat/ 仍非空: ${entries.slice(0, 20).join(', ')}${entries.length > 20 ? '…' : ''}`);
      }
    }
  } catch {
    /* 无 chat */
  }

  const msgDir = path.join(dataDir, 'sessions', 'messages');
  let hasJsonl = false;
  try {
    const names = await fs.readdir(msgDir);
    hasJsonl = names.some((n) => n.endsWith('.jsonl'));
  } catch {
    /* 无目录 */
  }

  const sessionsIndex = path.join(dataDir, 'sessions', 'index.json');
  if (hasJsonl) {
    try {
      await fs.access(sessionsIndex);
    } catch {
      issues.push('sessions/messages 存在 .jsonl 但缺少 sessions/index.json');
    }
  }

  const legacyUsage = path.join(dataDir, 'usage');
  try {
    const st = await fs.stat(legacyUsage);
    if (st.isDirectory()) {
      const files = (await fs.readdir(legacyUsage)).filter((f) => !f.startsWith('.'));
      if (files.length > 0) {
        warns.push(`根下 usage/ 仍有文件（应已迁到 config/usage）: ${files.join(', ')}`);
      }
    }
  } catch {
    /* ok */
  }

  const legacyWorktree = path.join(dataDir, 'workflows', 'worktree-ports.json');
  try {
    await fs.access(legacyWorktree);
    warns.push('仍存在 workflows/worktree-ports.json（应使用 config/worktree-ports.json）');
  } catch {
    /* ok */
  }

  const tasksTodos = path.join(dataDir, 'tasks', 'todos.json');
  try {
    await fs.access(tasksTodos);
    warns.push('仍存在 tasks/todos.json（应使用根目录 todos.json）');
  } catch {
    /* ok */
  }

  const storageArtifacts = path.join(dataDir, 'storage', 'artifacts');
  const storageSkills = path.join(dataDir, 'storage', 'skills');
  for (const p of [storageArtifacts, storageSkills]) {
    try {
      const st = await fs.stat(p);
      if (st.isDirectory()) {
        const n = await fs.readdir(p);
        if (n.length > 0) {
          warns.push(`仍存在非空 ${path.relative(dataDir, p)}（历史 storage 嵌套，应合并到根下对应目录）`);
        }
      }
    } catch {
      /* ok */
    }
  }

  if (issues.length) {
    console.error('[verify] 未通过:', issues.join('\n'));
    process.exitCode = 1;
  } else {
    console.log('[verify] 关键项通过（无残留 chat/、索引与消息一致）');
  }
  if (warns.length) {
    console.warn('[verify] 警告:\n', warns.join('\n'));
  }
}

async function main(): Promise<void> {
  console.log('[migrate:layout] PROJECT_PILOT_DATA_DIR =', dataRoot);

  try {
    await fs.access(dataRoot);
  } catch {
    console.error('[migrate:layout] 数据目录不存在:', dataRoot);
    process.exit(1);
  }

  const { ensureDataDirV2Migrated, getDataDir } = await import('../src/lib/file-store.ts');
  await ensureDataDirV2Migrated();

  const dir = getDataDir();
  if (path.resolve(dir) !== path.resolve(dataRoot)) {
    console.error('[migrate:layout] 路径不一致: argv/env=', dataRoot, 'getDataDir()=', dir);
    process.exit(1);
  }

  await verifyLayout(dir);
  console.log('[migrate:layout] 完成');
}

main().catch((e) => {
  console.error('[migrate:layout] 失败:', e);
  process.exit(1);
});
