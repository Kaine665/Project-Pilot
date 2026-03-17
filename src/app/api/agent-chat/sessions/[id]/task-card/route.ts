import { NextRequest, NextResponse } from 'next/server';
import { readTaskCard } from '@/lib/task-card-store';

/**
 * GET /api/agent-chat/sessions/[id]/task-card
 * Returns the task card for a session, or null if none exists.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const card = await readTaskCard(id);
  return NextResponse.json({ card }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
