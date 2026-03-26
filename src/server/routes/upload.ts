import { Hono } from 'hono';
import path from 'path';
import fs from 'fs/promises';
import { getDataDir } from '@/lib/file-store';

const app = new Hono();

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

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
  if (!ext && /^[A-Z]/.test(path.basename(filename))) return true;
  return false;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

// ---------------------------------------------------------------------------
// POST / — Upload files
// ---------------------------------------------------------------------------

app.post('/', async (c) => {
  try {
    const body = await c.req.parseBody({ all: true });

    const sessionId = body['sessionId'] as string | undefined;
    if (!sessionId || !/^[\w-]+$/.test(sessionId)) {
      return c.json({ error: 'Invalid or missing sessionId' }, 400);
    }

    const rawFiles = body['files'];
    const files: File[] = Array.isArray(rawFiles)
      ? rawFiles.filter((f): f is File => f instanceof File)
      : (rawFiles instanceof File ? [rawFiles] : []);

    if (files.length === 0) {
      return c.json({ error: 'No files provided' }, 400);
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
        return c.json(
          { error: `File "${file.name}" exceeds 50MB limit (${formatSize(file.size)})` },
          413,
        );
      }

      const safeName = file.name.replace(/[^a-zA-Z0-9._\-\u4e00-\u9fff]/g, '_');
      const destPath = path.join(uploadsDir, safeName);

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

      const displayPath = finalPath.replace(/\\/g, '/');

      results.push({
        name: file.name,
        path: displayPath,
        size: file.size,
        formattedSize: formatSize(file.size),
        isText: isTextFile(file.name),
      });
    }

    return c.json({ files: results });
  } catch (err) {
    console.error('[upload] error:', err);
    return c.json({ error: 'Upload failed' }, 500);
  }
});

export default app;
