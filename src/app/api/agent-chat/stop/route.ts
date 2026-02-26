import { NextRequest, NextResponse } from 'next/server';
import { agentChatManager } from '@/lib/agent-chat-manager';

/**
 * POST /api/agent-chat/stop
 * Stop a running agent chat process.
 * Body: { sessionId: string }
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { sessionId } = body as { sessionId: string };

  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
  }

  const stopped = agentChatManager.stop(sessionId);
  return NextResponse.json({ stopped });
}
