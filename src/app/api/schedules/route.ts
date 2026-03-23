import { NextRequest, NextResponse } from 'next/server';
import { sidecarFetch } from '@/lib/sidecar-bridge';

/**
 * GET /api/schedules
 * 返回所有调度规则列表。
 */
export async function GET() {
  try {
    const res = await sidecarFetch('/schedules');
    return NextResponse.json(await res.json());
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

/**
 * POST /api/schedules
 * 创建新调度规则。
 * Body: { targetType?, agentId?, todoId?, cron, message?, projectKey?, label?, enabled? }
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { targetType, agentId, todoId, cron, message, projectKey, label, enabled } = body as {
    targetType?: 'agent_message' | 'todo' | 'message';
    agentId?: string;
    todoId?: string;
    cron?: string;
    message?: string;
    projectKey?: string;
    label?: string;
    enabled?: boolean;
  };

  if (!cron || typeof cron !== 'string') {
    return NextResponse.json({ error: 'cron is required' }, { status: 400 });
  }
  const normalizedTargetType = !targetType || targetType === 'message' ? 'agent_message' : targetType;
  if (normalizedTargetType === 'agent_message' && (!agentId || typeof agentId !== 'string')) {
    return NextResponse.json({ error: 'agentId is required for agent_message schedules' }, { status: 400 });
  }
  if (normalizedTargetType === 'agent_message' && (!message || typeof message !== 'string' || message.length > 10000)) {
    return NextResponse.json({ error: 'message is required for agent_message schedules' }, { status: 400 });
  }
  if (normalizedTargetType === 'todo' && (!todoId || typeof todoId !== 'string')) {
    return NextResponse.json({ error: 'todoId is required for todo schedules' }, { status: 400 });
  }
  if (projectKey !== undefined && typeof projectKey !== 'string') {
    return NextResponse.json({ error: 'projectKey must be a string' }, { status: 400 });
  }

  try {
    const res = await sidecarFetch('/schedules', {
      method: 'POST',
      body: JSON.stringify({
        targetType: normalizedTargetType,
        agentId,
        todoId,
        cron,
        message,
        projectKey,
        label: label ? String(label).slice(0, 100) : undefined,
        enabled,
      }),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
