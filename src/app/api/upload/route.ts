import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs/promises';
import { getDataDir } from '@/lib/file-store';

/** 50 MB */
const MAX_FILE_SIZE = 50 * 1024 * 1024;

/** Extensions treated as text (Agent can `cat` these directly) */
const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.rst',
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.json', '.jsonl', '.json5',
  '.py', '.rb', '.go', '.rs', '.java', '.kt', '.swift', '.c', '.cpp', '.h', '.hpp', '.cs',
  '.css', '.scss', '.less', '.sass',
  '.html', '.htm', '.xml', '.svg', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf',
  '.sh', '.bash', '.zsh', '.fish', '.bat', '.ps1',
  '.sql', '.graphql', '.gql',
  '.env', '.env.local', '.env.example',
  '.gitignore', '.dockerignore', '.editorconfig',
  '.csv', '.tsv', '.log',
]);

function isTextFile(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  if (TEXT_EXTENSIONS.has(ext)) return true;
  // dotfiles without extension (Makefile, Dockerfile, etc.)
  if (!ext && /^[A-Z]/.test(path.basename(filename))) return true;
  return false;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const sessionId = formData.get('sessionId') as string | null;
    if (!sessionId || !/^[\w-]+$/.test(sessionId)) {
      return NextResponse.json({ error: 'Invalid or missing sessionId' }, { status: 400 });
    }

    const files = formData.getAll('files') as File[];
    if (files.length === 0) {
      return NextResponse.json({ error: 'No files provided' }, { status: 400 });
    }

    const uploadsDir = path.join(getDataDir(), 'uploads', sessionId);
    await fs.mkdir(uploadsDir, { recursive: true });

    const results: Array<{
      name: string;
      path: string;
      size: number;
      formattedSize: string;
      isText: boolean;
    }> = [];

    for (const file of files) {
      if (file.size > MAX_FILE_SIZE) {
        return NextResponse.json(
          { error: `File "${file.name}" exceeds 50MB limit (${formatSize(file.size)})` },
          { status: 413 },
        );
      }

      // Sanitize filename: keep only safe characters
      const safeName = file.name.replace(/[^a-zA-Z0-9._\-\u4e00-\u9fff]/g, '_');
      const destPath = path.join(uploadsDir, safeName);

      // Handle name collision: append counter
      let finalPath = destPath;
      let counter = 1;
      try {
        while (await fs.stat(finalPath).then(() => true).catch(() => false)) {
          const ext = path.extname(safeName);
          const base = safeName.slice(0, safeName.length - ext.length);
          finalPath = path.join(uploadsDir, `${base}_${counter}${ext}`);
          counter++;
        }
      } catch { /* stat failed = file doesn't exist, use as is */ }

      const buffer = Buffer.from(await file.arrayBuffer());
      await fs.writeFile(finalPath, buffer);

      // Normalize path separators for display (Windows → forward slash)
      const displayPath = finalPath.replace(/\\/g, '/');

      results.push({
        name: file.name,
        path: displayPath,
        size: file.size,
        formattedSize: formatSize(file.size),
        isText: isTextFile(file.name),
      });
    }

    return NextResponse.json({ files: results });
  } catch (err) {
    console.error('[upload] error:', err);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}
