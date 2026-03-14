import { NextRequest, NextResponse } from 'next/server';
import { sidecarFetch } from '@/lib/sidecar-bridge';

/**
 * POST /api/agent-chat/stop
 * Stop a running agent chat session.
 * Body: { sessionId: string }
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { sessionId } = body as { sessionId: string };

  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
  }

  try {
    const res = await sidecarFetch('/agent-chat/stop', {
      method: 'POST',
      body: JSON.stringify({ sessionId }),
    });
    return NextResponse.json(await res.json());
  } catch {
    // Sidecar 不可用 → 没有活跃 run，等同于已停止
    return NextResponse.json({ stopped: false });
  }
}
