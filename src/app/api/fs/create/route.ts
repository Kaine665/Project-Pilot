/**
 * POST /api/fs/create
 * Body: { path: string; type: 'file' | 'directory' }
 *
 * Create a new file or directory.
 */
import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { isValidWorkingDir } from '@/lib/security';

export async function POST(request: NextRequest) {
  let body: { path?: string; type?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const filePath = body?.path?.trim();
  const fileType = body?.type;
  if (!filePath) {
    return NextResponse.json({ error: 'path is required' }, { status: 400 });
  }
  if (fileType !== 'file' && fileType !== 'directory') {
    return NextResponse.json({ error: 'type must be "file" or "directory"' }, { status: 400 });
  }

  const resolved = path.normalize(path.resolve(filePath));
  if (!isValidWorkingDir(resolved)) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
  }

  try {
    // Check if already exists
    try {
      await fs.stat(resolved);
      return NextResponse.json({ error: 'Path already exists' }, { status: 409 });
    } catch {
      // OK — doesn't exist yet
    }

    if (fileType === 'directory') {
      await fs.mkdir(resolved, { recursive: true });
    } else {
      // Ensure parent exists
      await fs.mkdir(path.dirname(resolved), { recursive: true });
      await fs.writeFile(resolved, '', 'utf-8');
    }

    return NextResponse.json({ ok: true, path: resolved });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
