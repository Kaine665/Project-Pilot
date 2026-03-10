import { NextRequest, NextResponse } from 'next/server';
import { schedulerManager } from '@/lib/scheduler-manager';

/**
 * GET /api/schedules
 * 返回所有调度规则列表。
 */
export async function GET() {
  try {
    const schedules = await schedulerManager.listSchedules();
    return NextResponse.json({ schedules });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

/**
 * POST /api/schedules
 * 创建新调度规则。
 * Body: { agentId, cron, message, projectKey?, label?, enabled? }
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { agentId, cron, message, projectKey, label, enabled } = body as {
    agentId?: string;
    cron?: string;
    message?: string;
    projectKey?: string;
    label?: string;
    enabled?: boolean;
  };

  if (!agentId || typeof agentId !== 'string') {
    return NextResponse.json({ error: 'agentId is required' }, { status: 400 });
  }
  if (!cron || typeof cron !== 'string') {
    return NextResponse.json({ error: 'cron is required' }, { status: 400 });
  }
  if (!message || typeof message !== 'string' || message.length > 10000) {
    return NextResponse.json({ error: 'message is required (max 10000 chars)' }, { status: 400 });
  }
  if (projectKey !== undefined && typeof projectKey !== 'string') {
    return NextResponse.json({ error: 'projectKey must be a string' }, { status: 400 });
  }

  try {
    const schedule = await schedulerManager.createSchedule({
      agentId,
      cron,
      message,
      projectKey,
      label: label ? String(label).slice(0, 100) : undefined,
      enabled: enabled !== false,
    });
    return NextResponse.json({ schedule }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
