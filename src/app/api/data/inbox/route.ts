import { NextRequest, NextResponse } from 'next/server';
import { readInbox, writeInbox } from '@/lib/file-store';
import type { InboxItem, ProjectInbox } from '@/types';

/** Sanitize project key — only allow safe characters */
function sanitizeKey(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, '');
}

/** Extract and validate the project key from query params */
function getProjectKey(request: NextRequest): string | null {
  const raw = request.nextUrl.searchParams.get('project');
  if (!raw) return null;
  const safe = sanitizeKey(raw);
  return safe || null;
}

/** Generate inbox item ID: inbox-{timestamp}-{random4} */
function generateInboxId(): string {
  return `inbox-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * GET /api/data/inbox?project={key}
 * 返回该项目的收件箱数据
 */
export async function GET(request: NextRequest) {
  try {
    const projectKey = getProjectKey(request);
    if (!projectKey) {
      return NextResponse.json({ error: 'project query parameter is required' }, { status: 400 });
    }

    const inbox = await readInbox(projectKey);
    return NextResponse.json(inbox);
  } catch (error) {
    console.error('[inbox GET]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    );
  }
}

/**
 * POST /api/data/inbox?project={key}
 * Body: { content: string }
 * 创建新的 inbox item
 */
export async function POST(request: NextRequest) {
  try {
    const projectKey = getProjectKey(request);
    if (!projectKey) {
      return NextResponse.json({ error: 'project query parameter is required' }, { status: 400 });
    }

    const body = await request.json();
    const { content } = body;
    if (!content || typeof content !== 'string') {
      return NextResponse.json({ error: 'content is required and must be a string' }, { status: 400 });
    }

    const now = new Date().toISOString();
    const item: InboxItem = {
      id: generateInboxId(),
      content: content.trim(),
      createdAt: now,
      status: 'inbox',
    };

    const inbox = await readInbox(projectKey);
    inbox.items.push(item);
    await writeInbox(projectKey, inbox);

    return NextResponse.json(item, { status: 201 });
  } catch (error) {
    console.error('[inbox POST]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    );
  }
}

/**
 * PATCH /api/data/inbox?project={key}
 * Body: { id: string, content?: string, status?: 'inbox' | 'archived', archivedTo?: { sectionId, taskId } }
 * 更新指定 item
 */
export async function PATCH(request: NextRequest) {
  try {
    const projectKey = getProjectKey(request);
    if (!projectKey) {
      return NextResponse.json({ error: 'project query parameter is required' }, { status: 400 });
    }

    const body = await request.json();
    const { id, content, status, archivedTo } = body;
    if (!id || typeof id !== 'string') {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    const inbox = await readInbox(projectKey);
    const item = inbox.items.find(i => i.id === id);
    if (!item) {
      return NextResponse.json({ error: 'item not found' }, { status: 404 });
    }

    if (content !== undefined) item.content = content;
    if (status !== undefined) item.status = status;
    if (archivedTo !== undefined) item.archivedTo = archivedTo;

    await writeInbox(projectKey, inbox);
    return NextResponse.json(item);
  } catch (error) {
    console.error('[inbox PATCH]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/data/inbox?project={key}&id={itemId}
 * 删除指定 item
 */
export async function DELETE(request: NextRequest) {
  try {
    const projectKey = getProjectKey(request);
    if (!projectKey) {
      return NextResponse.json({ error: 'project query parameter is required' }, { status: 400 });
    }

    const itemId = request.nextUrl.searchParams.get('id');
    if (!itemId) {
      return NextResponse.json({ error: 'id query parameter is required' }, { status: 400 });
    }

    const inbox = await readInbox(projectKey);
    const idx = inbox.items.findIndex(i => i.id === itemId);
    if (idx === -1) {
      return NextResponse.json({ error: 'item not found' }, { status: 404 });
    }

    inbox.items.splice(idx, 1);
    await writeInbox(projectKey, inbox);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[inbox DELETE]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
