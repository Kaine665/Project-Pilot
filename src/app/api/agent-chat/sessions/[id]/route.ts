import { NextRequest, NextResponse } from 'next/server';
import { loadSession, markAsRead, setArchived } from '@/lib/agent-chat-manager';
import { sidecarFetch } from '@/lib/sidecar-bridge';

/**
 * GET /api/agent-chat/sessions/[id]
 * Get full session data including messages.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const session = await loadSession(id);
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
 *   { action: 'updateConfig', config: SessionConfig }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  if (body.action === 'markAsRead') {
    const found = await markAsRead(id);
    if (!found) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  }

  if (body.action === 'archive' || body.action === 'unarchive') {
    try {
      const found = await setArchived(id, body.action === 'archive');
      if (!found) {
        return NextResponse.json({ error: 'Session not found' }, { status: 404 });
      }
      return NextResponse.json({ ok: true });
    } catch (err) {
      console.error('[API] setArchived failed:', err);
      return NextResponse.json({ error: 'Internal error' }, { status: 500 });
    }
  }

  if (body.action === 'updateConfig') {
    const config = body.config ?? {};
    try {
      const res = await sidecarFetch('/agent-chat/update-config', {
        method: 'POST',
        body: JSON.stringify({ sessionId: id, config }),
      });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        return NextResponse.json({ error: data.error ?? 'Sidecar error' }, { status: res.status });
      }
    } catch {
      // Sidecar unreachable — config update is best-effort when no run is active
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
