/**
 * GET /api/fs/git-info?path=<encoded-path>
 *
 * Returns git branch name and file count for a project directory.
 */
import { NextRequest, NextResponse } from 'next/server';
import { execSync } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { isValidWorkingDir } from '@/lib/security';

export async function GET(request: NextRequest) {
  const pathParam = request.nextUrl.searchParams.get('path');
  if (!pathParam) {
    return NextResponse.json({ error: 'path is required' }, { status: 400 });
  }

  const resolved = path.normalize(path.resolve(decodeURIComponent(pathParam).trim()));
  if (!isValidWorkingDir(resolved)) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
  }

  let branch: string | null = null;
  let hasGit = false;

  try {
    branch = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: resolved,
      encoding: 'utf-8',
      timeout: 5000,
      windowsHide: true,
    }).trim();
    hasGit = true;
  } catch {
    // Not a git repo
  }

  // Count immediate children (files + dirs)
  let fileCount = 0;
  let dirCount = 0;
  try {
    const entries = await fs.readdir(resolved, { withFileTypes: true });
    for (const ent of entries) {
      if (ent.name.startsWith('.')) continue; // skip dotfiles in count
      if (ent.isDirectory()) dirCount++;
      else fileCount++;
    }
  } catch {
    // ignore
  }

  // Get project folder name
  const folderName = path.basename(resolved);

  return NextResponse.json({
    path: resolved,
    folderName,
    branch,
    hasGit,
    fileCount,
    dirCount,
  });
}
