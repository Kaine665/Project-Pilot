/**
 * GET /api/fs/list-dir?path=<encoded-path>
 *
 * 列出指定目录下的文件和子目录。
 * 用于对话区右侧的本地文件夹浏览面板。
 *
 * 安全：使用 isValidWorkingDir 校验路径，仅允许用户可访问的目录。
 */
import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { isValidWorkingDir } from '@/lib/security';

export interface DirEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

export async function GET(request: NextRequest) {
  const pathParam = request.nextUrl.searchParams.get('path');
  if (!pathParam || typeof pathParam !== 'string') {
    return NextResponse.json({ error: 'path is required' }, { status: 400 });
  }

  try {
    const decoded = decodeURIComponent(pathParam).trim();
    if (!decoded) {
      return NextResponse.json({ error: 'path is required' }, { status: 400 });
    }
    // 规范化路径：处理尾部斜杠、正反斜杠混用等
    const resolved = path.normalize(path.resolve(decoded));

    if (!isValidWorkingDir(resolved)) {
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }

    const stat = await fs.stat(resolved);
    if (!stat.isDirectory()) {
      return NextResponse.json({ error: 'Path is not a directory' }, { status: 400 });
    }

    const entries = await fs.readdir(resolved, { withFileTypes: true });
    const result: DirEntry[] = [];

    for (const ent of entries) {
      const fullPath = path.join(resolved, ent.name);
      if (!isValidWorkingDir(fullPath)) continue;
      result.push({
        name: ent.name,
        path: fullPath,
        isDirectory: ent.isDirectory(),
      });
    }

    // 目录在前，文件在后；同类型按名称排序
    result.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });

    return NextResponse.json({
      path: resolved,
      entries: result,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const attempted = pathParam
      ? path.normalize(path.resolve(decodeURIComponent(pathParam).trim()))
      : '';
    if (msg.includes('ENOENT')) {
      return NextResponse.json(
        { error: 'Directory not found', attempted: process.env.NODE_ENV === 'development' ? attempted : undefined },
        { status: 404 },
      );
    }
    if (msg.includes('EACCES') || msg.includes('EPERM')) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
