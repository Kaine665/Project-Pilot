import { NextRequest, NextResponse } from 'next/server';
import { schedulerManager } from '@/lib/scheduler-manager';

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/schedules/[id]
 * 获取单条调度规则。
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const schedules = await schedulerManager.listSchedules();
  const schedule = schedules.find(s => s.id === id);
  if (!schedule) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json({ schedule });
}

/**
 * PATCH /api/schedules/[id]
 * 更新调度规则（部分更新）。
 * Body: { cron?, message?, label?, enabled?, projectKey? }
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { cron, message, label, enabled, projectKey } = body as {
    cron?: string;
    message?: string;
    label?: string;
    enabled?: boolean;
    projectKey?: string;
  };

  if (message !== undefined && (typeof message !== 'string' || message.length > 10000)) {
    return NextResponse.json({ error: 'message must be a string up to 10000 chars' }, { status: 400 });
  }

  try {
    const updated = await schedulerManager.updateSchedule(id, {
      ...(cron !== undefined ? { cron } : {}),
      ...(message !== undefined ? { message } : {}),
      ...(label !== undefined ? { label: String(label).slice(0, 100) } : {}),
      ...(enabled !== undefined ? { enabled: Boolean(enabled) } : {}),
      ...(projectKey !== undefined ? { projectKey } : {}),
    });
    if (!updated) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ schedule: updated });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}

/**
 * DELETE /api/schedules/[id]
 * 删除调度规则。
 */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const deleted = await schedulerManager.deleteSchedule(id);
  if (!deleted) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
