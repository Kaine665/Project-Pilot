import { NextRequest, NextResponse } from 'next/server';
import { sidecarFetch } from '@/lib/sidecar-bridge';

/**
 * GET /api/agent-chat/status?sessionId=xxx
 * Check whether an agent chat process is running for this session.
 * Gracefully degrades when sidecar is unavailable (returns idle status).
 */
export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get('sessionId');
  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
  }

  try {
    const res = await sidecarFetch(
      `/agent-chat/status?sessionId=${encodeURIComponent(sessionId)}`,
    );
    return NextResponse.json(await res.json(), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch {
    // Sidecar 不可用时返回 idle 状态而非 500，避免 UI 报错和轮询风暴
    return NextResponse.json(
      { status: 'idle', messages: [] },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
