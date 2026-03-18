/**
 * POST /api/fs/delete
 * Body: { path: string }
 *
 * Delete a file or empty directory. Refuses to delete non-empty directories
 * unless ?force=true is passed as query param.
 */
import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { isValidWorkingDir } from '@/lib/security';

export async function POST(request: NextRequest) {
  let body: { path?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const filePath = body?.path?.trim();
  if (!filePath) {
    return NextResponse.json({ error: 'path is required' }, { status: 400 });
  }

  const resolved = path.normalize(path.resolve(filePath));
  if (!isValidWorkingDir(resolved)) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
  }

  const force = request.nextUrl.searchParams.get('force') === 'true';

  try {
    const stat = await fs.stat(resolved);
    if (stat.isDirectory()) {
      if (force) {
        await fs.rm(resolved, { recursive: true, force: true });
      } else {
        // Try rmdir (fails on non-empty)
        await fs.rmdir(resolved);
      }
    } else {
      await fs.unlink(resolved);
    }
    return NextResponse.json({ ok: true, path: resolved });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('ENOENT')) {
      return NextResponse.json({ error: 'Path not found' }, { status: 404 });
    }
    if (msg.includes('ENOTEMPTY')) {
      return NextResponse.json({ error: 'Directory is not empty. Use force=true to delete recursively.' }, { status: 400 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
