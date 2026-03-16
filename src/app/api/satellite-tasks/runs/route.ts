import { NextRequest, NextResponse } from 'next/server';
import { getRunsByTask, clearRunsByTask, getRunStats } from '@/lib/satellite-tasks/run-store';

/**
 * GET /api/satellite-tasks/runs?taskId=xxx&limit=50&offset=0
 *
 * Returns paginated execution records for a specific satellite task.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const taskId = searchParams.get('taskId');

  if (!taskId) {
    return NextResponse.json(
      { error: 'Missing required query parameter: taskId' },
      { status: 400 },
    );
  }

  const limit = Math.min(Number(searchParams.get('limit')) || 50, 200);
  const offset = Math.max(Number(searchParams.get('offset')) || 0, 0);

  const [{ runs, total }, stats] = await Promise.all([
    getRunsByTask(taskId, limit, offset),
    getRunStats(taskId),
  ]);

  return NextResponse.json({ runs, total, stats });
}

/**
 * DELETE /api/satellite-tasks/runs
 *
 * Clear all execution records for a specific task.
 * Body: { taskId: string }
 */
export async function DELETE(request: NextRequest) {
  const body = await request.json();
  const { taskId } = body as { taskId?: string };

  if (!taskId) {
    return NextResponse.json(
      { error: 'Missing required field: taskId' },
      { status: 400 },
    );
  }

  await clearRunsByTask(taskId);

  return NextResponse.json({ ok: true });
}
