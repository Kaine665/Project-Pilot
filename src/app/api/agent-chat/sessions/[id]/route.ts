import { NextRequest, NextResponse } from 'next/server';
import { agentChatManager } from '@/lib/agent-chat-manager';

/**
 * GET /api/agent-chat/sessions/[id]
 * Get full session data including messages.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const session = await agentChatManager.loadSession(id);
  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  return NextResponse.json(session, {
    headers: { 'Cache-Control': 'no-store' },
  });
}

/**
 * PATCH /api/agent-chat/sessions/[id]
 * Update session metadata. Supports:
 *   { action: 'markAsRead' }
 *   { action: 'archive' }
 *   { action: 'unarchive' }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  if (body.action === 'markAsRead') {
    const found = await agentChatManager.markAsRead(id);
    if (!found) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  }

  if (body.action === 'archive' || body.action === 'unarchive') {
    const found = await agentChatManager.setArchived(id, body.action === 'archive');
    if (!found) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
