import { NextRequest, NextResponse } from 'next/server';
import { agentChatManager } from '@/lib/agent-chat-manager';

/**
 * POST /api/agent-chat/sessions/branch
 * Branch a session from a specific message index, creating a new session with
 * messages up to (and including) the specified index.
 */
export async function POST(req: NextRequest) {
  try {
    const { sourceSessionId, branchAtIndex } = await req.json();
    if (!sourceSessionId || typeof branchAtIndex !== 'number') {
      return NextResponse.json(
        { error: 'sourceSessionId (string) and branchAtIndex (number) are required' },
        { status: 400 },
      );
    }

    const newSession = await agentChatManager.branchSession(
      sourceSessionId,
      branchAtIndex,
    );

    return NextResponse.json({
      sessionId: newSession.id,
      title: newSession.title,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const status = message.includes('not found') || message.includes('out of range') ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
