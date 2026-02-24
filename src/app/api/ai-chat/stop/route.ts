import { NextRequest, NextResponse } from 'next/server';
import { processManager } from '@/lib/process-manager';

/**
 * POST /api/ai-chat/stop
 * Explicitly stop a running Claude process.
 * Body: { taskId: string }
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { taskId } = body as { taskId: string };

  if (!taskId) {
    return NextResponse.json({ error: 'taskId is required' }, { status: 400 });
  }

  const stopped = processManager.stop(taskId);
  return NextResponse.json({ stopped });
}
