import { NextRequest, NextResponse } from 'next/server';
import {
  getConversationFilePath,
  readJsonFile,
  writeJsonFile,
} from '@/lib/file-store';
import { ensureConversationIndex } from '@/lib/conversation-migration';
import { processManager } from '@/lib/process-manager';
import type { ChatSession } from '@/types';

const DEFAULT_SESSION = (taskId: string, conversationId: string): ChatSession => ({
  sessionId: taskId,
  conversationId,
  messages: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

/**
 * GET /api/ai-chat?taskId=xxx&conversationId=yyy
 * Return conversation history.
 * - 有 conversationId → 返回指定对话
 * - 无 conversationId → 返回活跃对话（或空）
 */
export async function GET(request: NextRequest) {
  const taskId = request.nextUrl.searchParams.get('taskId');
  if (!taskId) {
    return NextResponse.json({ error: 'taskId is required' }, { status: 400 });
  }

  const index = await ensureConversationIndex(taskId);
  const conversationId = request.nextUrl.searchParams.get('conversationId')
    ?? index.activeConversationId;

  if (!conversationId) {
    // 没有任何对话
    return NextResponse.json(DEFAULT_SESSION(taskId, ''), {
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  const session = await readJsonFile<ChatSession>(
    getConversationFilePath(taskId, conversationId),
    DEFAULT_SESSION(taskId, conversationId),
  );

  return NextResponse.json(session, {
    headers: { 'Cache-Control': 'no-store' },
  });
}

/**
 * POST /api/ai-chat
 * Start a Claude process for this task. Returns immediately with { runId, conversationId }.
 * Body: { taskId: string, message: string, conversationId?: string }
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { taskId, message, conversationId } = body as {
    taskId: string;
    message: string;
    conversationId?: string;
  };

  if (!taskId || !message) {
    return NextResponse.json(
      { error: 'taskId and message are required' },
      { status: 400 },
    );
  }

  // Check for already-running process
  const status = processManager.getStatus(taskId);
  if (status.status === 'running') {
    return NextResponse.json(
      { error: 'A process is already running for this task', runId: status.runId },
      { status: 409 },
    );
  }

  try {
    const runId = await processManager.start(taskId, message, conversationId);
    const runConvId = processManager.getRunConversationId(taskId);
    return NextResponse.json({ runId, conversationId: runConvId });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/ai-chat?taskId=xxx&conversationId=yyy
 * Clear conversation history.
 * - 有 conversationId → 清空指定对话
 * - 无 conversationId → 清空活跃对话
 */
export async function DELETE(request: NextRequest) {
  const taskId = request.nextUrl.searchParams.get('taskId');
  if (!taskId) {
    return NextResponse.json({ error: 'taskId is required' }, { status: 400 });
  }

  const conversationId = request.nextUrl.searchParams.get('conversationId');
  const index = await ensureConversationIndex(taskId);
  const targetConvId = conversationId ?? index.activeConversationId;

  if (targetConvId) {
    await writeJsonFile(
      getConversationFilePath(taskId, targetConvId),
      DEFAULT_SESSION(taskId, targetConvId),
    );
  }

  return NextResponse.json({ ok: true });
}
