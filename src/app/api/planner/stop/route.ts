import { NextRequest, NextResponse } from 'next/server';
import { plannerManager } from '@/lib/planner-manager';

/**
 * POST /api/planner/stop
 * Stop a running planner process.
 * Body: { sessionId: string }
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { sessionId } = body as { sessionId: string };

  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
  }

  const stopped = plannerManager.stop(sessionId);
  return NextResponse.json({ stopped });
}
