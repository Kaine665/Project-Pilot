/**
 * GET  /api/global-prompt  — 读取全局 prompt
 * PUT  /api/global-prompt  — 写入全局 prompt（body: { content: string }）
 */

import { NextResponse } from 'next/server';
import { readFile, writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { getGlobalPromptPath, getPromptsDir } from '@/lib/file-store';

export async function GET() {
  try {
    const content = await readFile(getGlobalPromptPath(), 'utf-8');
    return NextResponse.json({ content });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return NextResponse.json({ content: '' });
    }
    console.error('[global-prompt] GET error:', err);
    return NextResponse.json({ error: 'Failed to read global prompt' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const { content } = await req.json() as { content?: string };
    if (typeof content !== 'string') {
      return NextResponse.json({ error: 'content must be a string' }, { status: 400 });
    }

    await mkdir(getPromptsDir(), { recursive: true });
    await writeFile(getGlobalPromptPath(), content, 'utf-8');
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[global-prompt] PUT error:', err);
    return NextResponse.json({ error: 'Failed to write global prompt' }, { status: 500 });
  }
}

// 原子写入可在未来按需加入；当前规模下 writeFile 已足够
// 此文件不含敏感数据，无需额外访问控制
