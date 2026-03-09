/**
 * GET  /api/project-prompt/[projectKey]  — 读取项目级 prompt
 * PUT  /api/project-prompt/[projectKey]  — 写入项目级 prompt（body: { content: string }）
 */

import { NextResponse } from 'next/server';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { getProjectPromptPath, getProjectPromptsDir } from '@/lib/file-store';

type Params = { params: Promise<{ projectKey: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { projectKey } = await params;
  try {
    const content = await readFile(getProjectPromptPath(projectKey), 'utf-8');
    return NextResponse.json({ content });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return NextResponse.json({ content: '' });
    }
    console.error('[project-prompt] GET error:', err);
    return NextResponse.json({ error: 'Failed to read project prompt' }, { status: 500 });
  }
}

export async function PUT(req: Request, { params }: Params) {
  const { projectKey } = await params;
  try {
    const { content } = await req.json() as { content?: string };
    if (typeof content !== 'string') {
      return NextResponse.json({ error: 'content must be a string' }, { status: 400 });
    }

    await mkdir(getProjectPromptsDir(), { recursive: true });
    await writeFile(getProjectPromptPath(projectKey), content, 'utf-8');
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[project-prompt] PUT error:', err);
    return NextResponse.json({ error: 'Failed to write project prompt' }, { status: 500 });
  }
}
