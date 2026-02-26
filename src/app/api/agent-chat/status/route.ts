import { NextRequest, NextResponse } from 'next/server';
import { agentChatManager } from '@/lib/agent-chat-manager';

/**
 * GET /api/agent-chat/status?sessionId=xxx
 * Check whether an agent chat process is running for this session.
 */
export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get('sessionId');
  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
  }

  const info = agentChatManager.getStatus(sessionId);
  const messages = agentChatManager.getMessages(sessionId);
  return NextResponse.json({ ...info, messages }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
