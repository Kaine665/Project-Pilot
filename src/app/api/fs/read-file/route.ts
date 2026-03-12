/**
 * GET /api/fs/read-file?path=<encoded-path>&resolve=<mode>
 *
 * 读取文本文件内容，用于在应用内预览。
 * 安全：路径校验 + 大小限制（512KB）
 *
 * resolve 参数（可选）:
 *   - 缺省: path.resolve(decoded)，即相对于 CWD
 *   - "data": 相对于 ~/.project-pilot/data/ 解析
 */
import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { isValidWorkingDir } from '@/lib/security';
import { getDataDir } from '@/lib/file-store';

const MAX_SIZE = 512 * 1024; // 512KB

const TEXT_EXT = new Set([
  'txt', 'md', 'json', 'js', 'ts', 'tsx', 'jsx', 'mjs', 'cjs',
  'css', 'scss', 'less', 'html', 'htm', 'xml', 'yaml', 'yml',
  'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift', 'c', 'h', 'cpp', 'hpp',
  'sql', 'sh', 'bash', 'zsh', 'ps1', 'bat', 'cmd',
  'env', 'ini', 'cfg', 'conf', 'toml', 'log',
]);

async function tryReadFile(resolved: string): Promise<NextResponse> {
  if (!isValidWorkingDir(resolved)) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
  }

  const stat = await fs.stat(resolved);
  if (stat.isDirectory()) {
    return NextResponse.json({ error: 'Path is a directory' }, { status: 400 });
  }
  if (stat.size > MAX_SIZE) {
    return NextResponse.json({ error: `File too large (max ${MAX_SIZE / 1024}KB)` }, { status: 400 });
  }

  const ext = path.extname(resolved).slice(1).toLowerCase();
  if (!TEXT_EXT.has(ext) && ext !== '') {
    return NextResponse.json({ error: 'Unsupported file type for preview' }, { status: 400 });
  }

  const content = await fs.readFile(resolved, 'utf-8');
  return NextResponse.json({ path: resolved, content });
}

export async function GET(request: NextRequest) {
  const pathParam = request.nextUrl.searchParams.get('path');
  if (!pathParam || typeof pathParam !== 'string') {
    return NextResponse.json({ error: 'path is required' }, { status: 400 });
  }

  const decoded = decodeURIComponent(pathParam).trim();
  const resolveMode = request.nextUrl.searchParams.get('resolve');

  let resolved: string;
  if (resolveMode === 'data') {
    resolved = path.normalize(path.resolve(getDataDir(), decoded));
  } else {
    resolved = path.normalize(path.resolve(decoded));
  }

  try {
    return await tryReadFile(resolved);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('ENOENT')) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }
    if (msg.includes('EACCES') || msg.includes('EPERM')) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }
    if (msg.includes('invalid') && msg.toLowerCase().includes('encoding')) {
      return NextResponse.json({ error: 'File is not valid UTF-8 text' }, { status: 400 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
