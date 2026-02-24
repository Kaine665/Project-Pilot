import { NextRequest, NextResponse } from 'next/server';
import { plannerManager } from '@/lib/planner-manager';

/**
 * GET /api/planner/status?sessionId=xxx
 * Check whether a planner process is running for this session.
 */
export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get('sessionId');
  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
  }

  const info = plannerManager.getStatus(sessionId);
  const messages = plannerManager.getMessages(sessionId);
  return NextResponse.json({ ...info, messages }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
