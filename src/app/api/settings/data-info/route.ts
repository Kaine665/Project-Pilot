import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { getDataDir } from '@/lib/file-store';

/**
 * GET /api/settings/data-info
 * 返回数据目录信息和磁盘占用。
 */
export async function GET() {
  try {
    const dataDir = getDataDir();
    let totalSize = 0;
    let fileCount = 0;

    async function walkDir(dir: string) {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          // 跳过备份目录
          if (entry.name.startsWith('_backup_')) continue;

          const fullPath = path.join(dir, entry.name);
          if (entry.isFile()) {
            const stat = await fs.stat(fullPath);
            totalSize += stat.size;
            fileCount++;
          } else if (entry.isDirectory()) {
            await walkDir(fullPath);
          }
        }
      } catch {
        // 目录不存在则跳过
      }
    }

    await walkDir(dataDir);

    // 格式化大小
    let sizeStr: string;
    if (totalSize < 1024) {
      sizeStr = `${totalSize} B`;
    } else if (totalSize < 1024 * 1024) {
      sizeStr = `${(totalSize / 1024).toFixed(1)} KB`;
    } else {
      sizeStr = `${(totalSize / (1024 * 1024)).toFixed(1)} MB`;
    }

    return NextResponse.json({
      dataDir,
      diskUsage: {
        total: sizeStr,
        bytes: totalSize,
        files: fileCount,
      },
    });
  } catch (error) {
    console.error('Data info failed:', error);
    return NextResponse.json({ error: 'Failed to get data info' }, { status: 500 });
  }
}
