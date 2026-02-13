import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';

/**
 * POST /api/ai-discuss
 * Start a discussion session for a plan.
 * Body: { taskId, planId }
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { taskId, planId } = body;

  if (!taskId || !planId) {
    return NextResponse.json(
      { error: 'taskId and planId are required' },
      { status: 400 },
    );
  }

  // Spawn discussor agent as detached process
  const cmd = `node scripts/agents/discussor.js ${taskId} ${planId}`;
  exec(cmd, { cwd: process.cwd() });

  return NextResponse.json({ success: true });
}
