import { NextRequest, NextResponse } from 'next/server';
import { processManager } from '@/lib/process-manager';

/**
 * GET /api/ai-chat/status?taskId=xxx
 * Check whether a Claude process is running for this task.
 */
export async function GET(request: NextRequest) {
  const taskId = request.nextUrl.searchParams.get('taskId');
  if (!taskId) {
    return NextResponse.json({ error: 'taskId is required' }, { status: 400 });
  }

  const info = processManager.getStatus(taskId);
  const conversationId = processManager.getRunConversationId(taskId);
  return NextResponse.json({ ...info, conversationId }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
