import { NextRequest, NextResponse } from 'next/server';
import { agentChatManager, generateSessionId } from '@/lib/agent-chat-manager';
import { isValidSessionId } from '@/lib/security';

/**
 * POST /api/agent-chat/guest
 * Start a guest agent session (旁听 Agent).
 *
 * Body: {
 *   agentId: string,         // guest agent ID
 *   message: string,         // 用户的第一条消息
 *   parentSessionId: string, // 宿主会话 ID
 *   guestSessionId?: string, // 继续已有 guest 会话（可选）
 *   importedTurns?: number[] | 'all', // 导入哪些轮次，默认 'all'
 * }
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const {
    agentId,
    message,
    parentSessionId,
    guestSessionId: requestedGuestSessionId,
    importedTurns,
  } = body as {
    agentId: string;
    message: string;
    parentSessionId: string;
    guestSessionId?: string;
    importedTurns?: number[] | 'all';
  };

  // 🔒 Validate required fields
  if (!agentId) {
    return NextResponse.json({ error: 'agentId is required' }, { status: 400 });
  }
  if (!parentSessionId) {
    return NextResponse.json({ error: 'parentSessionId is required' }, { status: 400 });
  }

  // 🔒 Validate message
  if (typeof message !== 'string' || message.length === 0 || message.length > 10000) {
    return NextResponse.json(
      { error: 'message must be a non-empty string up to 10000 characters' },
      { status: 400 },
    );
  }

  // 🔒 Validate session IDs
  if (!isValidSessionId(parentSessionId)) {
    return NextResponse.json({ error: 'Invalid parentSessionId format' }, { status: 400 });
  }
  if (requestedGuestSessionId && !isValidSessionId(requestedGuestSessionId)) {
    return NextResponse.json({ error: 'Invalid guestSessionId format' }, { status: 400 });
  }

  // 🔒 Validate importedTurns
  const resolvedImportedTurns: number[] | 'all' = importedTurns ?? 'all';
  if (resolvedImportedTurns !== 'all') {
    if (!Array.isArray(resolvedImportedTurns) || !resolvedImportedTurns.every(n => typeof n === 'number' && n >= 0)) {
      return NextResponse.json({ error: 'importedTurns must be "all" or an array of non-negative integers' }, { status: 400 });
    }
  }

  const guestSessionId = requestedGuestSessionId || generateSessionId();

  try {
    const runId = await agentChatManager.startGuest(
      guestSessionId,
      agentId,
      message,
      parentSessionId,
      resolvedImportedTurns,
    );
    return NextResponse.json({ runId, sessionId: guestSessionId, parentSessionId });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}

/**
 * GET /api/agent-chat/guest?parentSessionId=xxx
 * List guest sessions for a given host session.
 */
export async function GET(request: NextRequest) {
  const parentSessionId = request.nextUrl.searchParams.get('parentSessionId');
  if (!parentSessionId) {
    return NextResponse.json({ error: 'parentSessionId is required' }, { status: 400 });
  }

  const sessions = await agentChatManager.listGuestSessions(parentSessionId);
  return NextResponse.json({ sessions }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
