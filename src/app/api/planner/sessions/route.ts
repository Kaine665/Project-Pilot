import { NextRequest, NextResponse } from 'next/server';
import { plannerManager } from '@/lib/planner-manager';

/**
 * GET /api/planner/sessions?projectKey=xxx
 * List all planner sessions for a project (without message bodies).
 */
export async function GET(request: NextRequest) {
  const projectKey = request.nextUrl.searchParams.get('projectKey');
  if (!projectKey) {
    return NextResponse.json({ error: 'projectKey is required' }, { status: 400 });
  }

  const sessions = await plannerManager.listSessions(projectKey);
  return NextResponse.json({ sessions }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}

/**
 * DELETE /api/planner/sessions?sessionId=xxx
 * Delete a planner session.
 */
export async function DELETE(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get('sessionId');
  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
  }

  const deleted = await plannerManager.deleteSession(sessionId);
  if (!deleted) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }
  return NextResponse.json({ deleted: true });
}
