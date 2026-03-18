/**
 * POST /api/fs/rename
 * Body: { oldPath: string; newPath: string }
 *
 * Rename/move a file or directory.
 */
import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { isValidWorkingDir } from '@/lib/security';

export async function POST(request: NextRequest) {
  let body: { oldPath?: string; newPath?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const oldPath = body?.oldPath?.trim();
  const newPath = body?.newPath?.trim();
  if (!oldPath || !newPath) {
    return NextResponse.json({ error: 'oldPath and newPath are required' }, { status: 400 });
  }

  const resolvedOld = path.normalize(path.resolve(oldPath));
  const resolvedNew = path.normalize(path.resolve(newPath));

  if (!isValidWorkingDir(resolvedOld) || !isValidWorkingDir(resolvedNew)) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
  }

  try {
    await fs.rename(resolvedOld, resolvedNew);
    return NextResponse.json({ ok: true, oldPath: resolvedOld, newPath: resolvedNew });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('ENOENT')) {
      return NextResponse.json({ error: 'Source path not found' }, { status: 404 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
