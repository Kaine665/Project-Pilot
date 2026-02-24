import { NextRequest, NextResponse } from 'next/server';
import { plannerManager } from '@/lib/planner-manager';

/**
 * GET /api/planner/sessions/[id]
 * Get full session data including messages.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const session = await plannerManager.loadSession(id);
  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  return NextResponse.json(session, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
