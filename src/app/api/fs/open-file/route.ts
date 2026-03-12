/**
 * POST /api/fs/open-file
 * Body: { path: string }
 *
 * 用系统默认应用打开文件。当 Electron preload 不可用时作为回退。
 * 安全：使用 isValidWorkingDir 校验路径。
 */
import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import path from 'path';
import { promisify } from 'util';
import { isValidWorkingDir } from '@/lib/security';

const execAsync = promisify(exec);

export async function POST(request: NextRequest) {
  let body: { path?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const pathParam = body?.path;
  if (!pathParam || typeof pathParam !== 'string') {
    return NextResponse.json({ error: 'path is required' }, { status: 400 });
  }

  const decoded = pathParam.trim();
  const resolved = path.normalize(path.resolve(decoded));

  if (!isValidWorkingDir(resolved)) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
  }

  try {
    const platform = process.platform;
    const escaped = resolved.replace(/"/g, '\\"');
    let cmd: string;
    if (platform === 'win32') {
      cmd = `start "" "${escaped}"`;
    } else if (platform === 'darwin') {
      cmd = `open "${escaped}"`;
    } else {
      cmd = `xdg-open "${escaped}"`;
    }
    await execAsync(cmd, { windowsHide: true });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
