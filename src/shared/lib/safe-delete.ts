/**
 * safe-delete — Windows-safe file/directory deletion CLI.
 *
 * Handles Windows file locking gracefully:
 * 1. Try fast direct removal
 * 2. If blocked, incremental delete (skip locked files)
 * 3. Move stubborn remnants to _trashs/
 *
 * Usage (Agent 在 bash 中调用):
 *   npx tsx src/lib/safe-delete.ts <path> [--trash-dir <dir>]
 *
 * Exit codes:
 *   0 — fully deleted
 *   1 — partially deleted, remnants moved to trash
 *   2 — failed (path doesn't exist counts as success)
 */

import path from 'path';
import { promises as fs } from 'fs';
import { execSync } from 'child_process';

// ── Core deletion logic ──

/** Try to remove a directory using platform-native command */
async function tryRemoveDir(dirPath: string): Promise<boolean> {
  try {
    if (process.platform === 'win32') {
      execSync(`rd /s /q "${dirPath}"`, { stdio: 'pipe' });
    } else {
      await fs.rm(dirPath, { recursive: true, force: true });
    }
  } catch {
    // Command failed
  }
  try {
    await fs.stat(dirPath);
    return false; // Still exists
  } catch {
    return true; // Gone
  }
}

/** Recursively delete files one by one, skipping locked ones */
async function incrementalDelete(dirPath: string): Promise<{ deleted: number; skipped: number }> {
  const stats = { deleted: 0, skipped: 0 };

  let entries;
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return stats;
  }

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      const sub = await incrementalDelete(fullPath);
      stats.deleted += sub.deleted;
      stats.skipped += sub.skipped;
      try {
        await fs.rmdir(fullPath);
        stats.deleted++;
      } catch {
        stats.skipped++;
      }
    } else {
      try {
        await fs.unlink(fullPath);
        stats.deleted++;
      } catch {
        stats.skipped++;
      }
    }
  }

  return stats;
}

/** Move remnants to trash directory */
async function moveToTrash(targetPath: string, trashDir: string): Promise<string | null> {
  const baseName = path.basename(targetPath);
  const trashDest = path.join(trashDir, `${baseName}_${Date.now()}`);

  try {
    await fs.mkdir(trashDir, { recursive: true });
    await fs.rename(targetPath, trashDest);
    return trashDest;
  } catch {
    return null;
  }
}

/**
 * Safely delete a file or directory.
 *
 * @returns Object with result details
 */
export async function safeDelete(
  targetPath: string,
  trashDir?: string,
): Promise<{
  success: boolean;
  fullyDeleted: boolean;
  trashedTo?: string;
  stats?: { deleted: number; skipped: number };
}> {
  // Check if target exists
  let targetStat;
  try {
    targetStat = await fs.stat(targetPath);
  } catch {
    // Already doesn't exist = success
    return { success: true, fullyDeleted: true };
  }

  // For files, just try unlink
  if (targetStat.isFile()) {
    try {
      await fs.unlink(targetPath);
      return { success: true, fullyDeleted: true };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES') {
        // File is locked, try to move to trash
        const resolvedTrash = trashDir || path.join(path.dirname(targetPath), '_trashs');
        const trashed = await moveToTrash(targetPath, resolvedTrash);
        if (trashed) {
          return { success: true, fullyDeleted: false, trashedTo: trashed };
        }
      }
      return { success: false, fullyDeleted: false };
    }
  }

  // For directories: 3-phase strategy
  // Phase 1: Fast path
  if (await tryRemoveDir(targetPath)) {
    return { success: true, fullyDeleted: true };
  }

  // Phase 2: Incremental delete
  console.log('  Fast removal failed, trying incremental deletion...');
  const stats = await incrementalDelete(targetPath);
  console.log(`  Incremental: ${stats.deleted} deleted, ${stats.skipped} skipped (locked)`);

  // Check if fully cleaned
  if (await tryRemoveDir(targetPath)) {
    return { success: true, fullyDeleted: true, stats };
  }

  // Phase 3: Move remnants to trash
  if (stats.skipped > 0) {
    const resolvedTrash = trashDir || path.join(path.dirname(targetPath), '_trashs');
    console.log(`  Moving ${stats.skipped} locked remnants to ${resolvedTrash}/`);
    const trashed = await moveToTrash(targetPath, resolvedTrash);
    if (trashed) {
      return { success: true, fullyDeleted: false, trashedTo: trashed, stats };
    }
  }

  return { success: false, fullyDeleted: false, stats };
}

// ── CLI 入口 ──

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(`safe-delete — Windows-safe file/directory deletion

Usage:
  npx tsx src/lib/safe-delete.ts <path> [--trash-dir <dir>]

Options:
  --trash-dir <dir>   Custom trash directory (default: <parent>/_trashs/)

Strategy:
  1. Try fast direct removal (rd /s /q on Windows)
  2. If blocked by file locks, delete files one-by-one (skip locked)
  3. Move locked remnants to _trashs/ directory

Exit codes:
  0 — target fully deleted (or didn't exist)
  1 — partially deleted, remnants moved to trash
  2 — deletion failed`);
    process.exit(0);
  }

  const targetPath = path.resolve(args[0]);
  let trashDir: string | undefined;

  const trashIdx = args.indexOf('--trash-dir');
  if (trashIdx !== -1 && args[trashIdx + 1]) {
    trashDir = path.resolve(args[trashIdx + 1]);
  }

  console.log(`safe-delete: ${targetPath}`);

  const result = await safeDelete(targetPath, trashDir);

  if (result.fullyDeleted) {
    console.log('Result: fully deleted');
    process.exit(0);
  } else if (result.success) {
    console.log(`Result: partially deleted, remnants at ${result.trashedTo}`);
    process.exit(1);
  } else {
    console.error('Result: FAILED — could not delete or move target');
    process.exit(2);
  }
}

const isDirectRun = process.argv[1]?.replace(/\\/g, '/').includes('safe-delete');
if (isDirectRun) {
  main().catch(err => {
    console.error(err.message);
    process.exit(2);
  });
}
