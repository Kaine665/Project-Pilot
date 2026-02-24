import { NextRequest, NextResponse } from 'next/server';
import { processManager } from '@/lib/process-manager';

/**
 * GET /api/recovery — List interrupted sessions that can be resumed.
 */
export async function GET() {
  try {
    const interrupted = await processManager.detectInterruptedSessions();
    return NextResponse.json({ interrupted });
  } catch (err) {
    console.error('[Recovery] Failed to detect interrupted sessions:', err);
    return NextResponse.json({ interrupted: [] });
  }
}

/**
 * POST /api/recovery — Resume an interrupted session.
 * Body: { taskId: string }
 *
 * Starts a new Claude process with --resume using the persisted claudeSessionId.
 */
export async function POST(request: NextRequest) {
  try {
    const { taskId } = await request.json();
    if (!taskId || typeof taskId !== 'string') {
      return NextResponse.json({ error: 'taskId is required' }, { status: 400 });
    }

    const runId = await processManager.start(taskId, '继续执行之前中断的任务。请从上次离开的地方继续。');
    return NextResponse.json({ runId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[Recovery] Failed to resume session:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
