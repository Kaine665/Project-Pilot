import { NextRequest, NextResponse } from 'next/server';
import {
  ensureConversationIndex,
  createConversation,
  branchConversation,
  archiveConversation,
  restoreConversation,
  permanentlyDeleteConversation,
  updateConversationMeta,
} from '@/lib/conversation-migration';

/**
 * GET /api/ai-chat/conversations?taskId=xxx
 * 返回指定 task 的所有对话列表（包含已归档的）。
 */
export async function GET(request: NextRequest) {
  const taskId = request.nextUrl.searchParams.get('taskId');
  if (!taskId) {
    return NextResponse.json({ error: 'taskId is required' }, { status: 400 });
  }

  const index = await ensureConversationIndex(taskId);
  return NextResponse.json(index, {
    headers: { 'Cache-Control': 'no-store' },
  });
}

/**
 * POST /api/ai-chat/conversations
 * 创建新对话或从已有对话分支。
 * Body: { taskId: string }                                              → 创建空对话
 * Body: { taskId, action: 'branch', sourceConversationId, branchFromMessageId } → 分支
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { taskId, action, sourceConversationId, branchFromMessageId } = body as {
    taskId: string;
    action?: 'branch';
    sourceConversationId?: string;
    branchFromMessageId?: string;
  };

  if (!taskId) {
    return NextResponse.json({ error: 'taskId is required' }, { status: 400 });
  }

  // 分支操作
  if (action === 'branch') {
    if (!sourceConversationId || !branchFromMessageId) {
      return NextResponse.json(
        { error: 'sourceConversationId and branchFromMessageId are required for branch' },
        { status: 400 },
      );
    }
    try {
      const result = await branchConversation(taskId, sourceConversationId, branchFromMessageId);
      return NextResponse.json(result);
    } catch (err) {
      return NextResponse.json(
        { error: (err as Error).message },
        { status: 400 },
      );
    }
  }

  // 默认：创建空对话
  const conversationId = await createConversation(taskId);
  return NextResponse.json({ conversationId });
}

/**
 * PATCH /api/ai-chat/conversations
 * 归档或恢复对话。
 * Body: { taskId: string, conversationId: string, action: 'archive' | 'restore' }
 */
export async function PATCH(request: NextRequest) {
  const body = await request.json();
  const { taskId, conversationId, action, title } = body as {
    taskId: string;
    conversationId: string;
    action: 'archive' | 'restore' | 'rename';
    title?: string;
  };

  if (!taskId || !conversationId || !action) {
    return NextResponse.json(
      { error: 'taskId, conversationId, and action are required' },
      { status: 400 },
    );
  }

  if (action === 'archive') {
    await archiveConversation(taskId, conversationId);
  } else if (action === 'restore') {
    await restoreConversation(taskId, conversationId);
  } else if (action === 'rename') {
    if (!title) {
      return NextResponse.json({ error: 'title is required for rename' }, { status: 400 });
    }
    await updateConversationMeta(taskId, conversationId, { title });
  } else {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/ai-chat/conversations?taskId=xxx&conversationId=yyy
 * 永久删除对话（仅用于已归档的对话）。
 */
export async function DELETE(request: NextRequest) {
  const taskId = request.nextUrl.searchParams.get('taskId');
  const conversationId = request.nextUrl.searchParams.get('conversationId');

  if (!taskId || !conversationId) {
    return NextResponse.json(
      { error: 'taskId and conversationId are required' },
      { status: 400 },
    );
  }

  await permanentlyDeleteConversation(taskId, conversationId);
  return NextResponse.json({ ok: true });
}
