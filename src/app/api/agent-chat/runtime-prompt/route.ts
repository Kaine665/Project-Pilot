import { NextRequest, NextResponse } from 'next/server';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { getPromptRuntimeDir, getPromptRuntimePath } from '@/lib/file-store';

function getParams(request: NextRequest) {
  const agentId = request.nextUrl.searchParams.get('agentId');
  const sessionId = request.nextUrl.searchParams.get('sessionId');

  if (!agentId || !sessionId) {
    return null;
  }

  return { agentId, sessionId };
}

export async function GET(request: NextRequest) {
  const params = getParams(request);
  if (!params) {
    return NextResponse.json({ error: 'agentId and sessionId are required' }, { status: 400 });
  }

  try {
    const content = await readFile(
      getPromptRuntimePath(params.agentId, params.sessionId),
      'utf-8',
    );
    return NextResponse.json({ content });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return NextResponse.json({ content: '' });
    }
    console.error('[runtime-prompt] GET error:', error);
    return NextResponse.json({ error: 'Failed to read runtime prompt' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const params = getParams(request);
  if (!params) {
    return NextResponse.json({ error: 'agentId and sessionId are required' }, { status: 400 });
  }

  try {
    const { content } = (await request.json()) as { content?: string };
    if (typeof content !== 'string') {
      return NextResponse.json({ error: 'content must be a string' }, { status: 400 });
    }

    await mkdir(getPromptRuntimeDir(params.agentId), { recursive: true });
    await writeFile(
      getPromptRuntimePath(params.agentId, params.sessionId),
      content,
      'utf-8',
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[runtime-prompt] PUT error:', error);
    return NextResponse.json({ error: 'Failed to write runtime prompt' }, { status: 500 });
  }
}
