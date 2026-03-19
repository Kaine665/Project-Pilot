import { NextRequest, NextResponse } from 'next/server';
import {
  loadSession,
  markAsRead,
  setArchived,
  updatePendingUserQueueOnDisk,
  updateUserMessageContentOnDisk,
} from '@/lib/agent-chat-manager';
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
 *   { action: 'updatePendingUserQueue', queue: PendingUserQueueState }
 *   { action: 'updateUserMessage', messageIndex: number, content: string, frontendMessageCount?: number }
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

  if (body.action === 'updatePendingUserQueue') {
    const queue = body.queue;
    const items = Array.isArray(queue?.items) ? queue.items : null;
    if (!items) {
      return NextResponse.json({ error: 'queue.items must be an array' }, { status: 400 });
    }

    const normalizedItems = items
      .map((item: unknown) => {
        if (!item || typeof item !== 'object') return null;
        const text = typeof (item as { text?: unknown }).text === 'string'
          ? (item as { text: string }).text.trim()
          : '';
        const images = Array.isArray((item as { images?: unknown }).images)
          ? (item as { images: unknown[] }).images.filter((img): img is string => typeof img === 'string' && img.length > 0)
          : [];
        if (!text && images.length === 0) return null;
        return { text, images: images.length > 0 ? images : undefined };
      })
      .filter((item: { text: string; images?: string[] } | null): item is { text: string; images?: string[] } => item !== null);

    const found = await updatePendingUserQueueOnDisk(id, {
      items: normalizedItems,
      expanded: queue?.expanded === false ? false : undefined,
    });
    if (!found) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  }

  if (body.action === 'updateUserMessage') {
    if (typeof body.messageIndex !== 'number' || body.messageIndex < 0) {
      return NextResponse.json({ error: 'messageIndex must be a non-negative number' }, { status: 400 });
    }
    if (typeof body.content !== 'string') {
      return NextResponse.json({ error: 'content must be a string' }, { status: 400 });
    }

    const result = await updateUserMessageContentOnDisk(
      id,
      body.messageIndex,
      body.content,
      typeof body.frontendMessageCount === 'number' ? body.frontendMessageCount : undefined,
    );

    if (result === 'not_found') {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }
    if (result === 'out_of_range') {
      return NextResponse.json({ error: 'Message index out of range' }, { status: 400 });
    }
    if (result === 'not_user') {
      return NextResponse.json({ error: 'Only user messages can be edited' }, { status: 400 });
    }
    if (result === 'empty') {
      return NextResponse.json({ error: 'Message content cannot be empty' }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
