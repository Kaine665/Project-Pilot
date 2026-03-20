import { NextRequest, NextResponse } from 'next/server';
import { sidecarFetch } from '@/lib/sidecar-bridge';

/**
 * GET /api/agent-chat/runtime-snapshot?sessionId=xxx
 * Read the current runtime read model for a session.
 * Returns runtime status plus any in-memory messages available for reconnect.
 */
export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get('sessionId');
  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
  }

  try {
    const res = await sidecarFetch(
      `/agent-chat/runtime-snapshot?sessionId=${encodeURIComponent(sessionId)}`,
    );
    return NextResponse.json(await res.json(), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch {
    return NextResponse.json(
      { available: false, status: 'none', eventCount: 0, messages: [] },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
