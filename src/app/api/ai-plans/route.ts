import { NextRequest, NextResponse } from 'next/server';
import { getAiPlansPath, readJsonFile, modifyJsonFile } from '@/lib/file-store';
import type { PlansData, PlanStatus } from '@/types';

const DEFAULT_PLANS_DATA: PlansData = { plans: [] };

/**
 * GET /api/ai-plans
 * Return plans, optionally filtered by taskId.
 * Query: ?taskId=xxx
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const taskId = searchParams.get('taskId');

  const data = await readJsonFile<PlansData>(getAiPlansPath(), DEFAULT_PLANS_DATA);

  // Enrich plans with version number extracted from plan_id (e.g. "plan-xxx-v4-123" → 4)
  const enriched = data.plans.map((p) => {
    if (p.version) return p;
    const match = p.plan_id.match(/-v(\d+)-/);
    return { ...p, version: match ? parseInt(match[1], 10) : 1 };
  });

  if (taskId) {
    const filtered = enriched.filter((p) => p.task_id === taskId);
    return NextResponse.json({ plans: filtered });
  }

  return NextResponse.json({ plans: enriched });
}

/**
 * POST /api/ai-plans
 * Update a plan's status (approve/reject).
 * Body: { planId, status }
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { planId, status } = body as { planId: string; status: PlanStatus };

  if (!planId || !status) {
    return NextResponse.json(
      { error: 'planId and status are required' },
      { status: 400 },
    );
  }

  let updatedPlan = null;

  await modifyJsonFile<PlansData>(getAiPlansPath(), DEFAULT_PLANS_DATA, (data) => {
    const index = data.plans.findIndex((p) => p.plan_id === planId);
    if (index === -1) return data;

    const plans = [...data.plans];
    plans[index] = {
      ...plans[index],
      status,
      updated_at: new Date().toISOString(),
    };
    updatedPlan = plans[index];
    return { ...data, plans };
  });

  if (!updatedPlan) {
    return NextResponse.json({ error: 'Plan not found' }, { status: 404 });
  }

  return NextResponse.json(updatedPlan);
}

/**
 * DELETE /api/ai-plans
 * Remove a plan by planId.
 * Query: ?planId=xxx
 */
export async function DELETE(request: NextRequest) {
  const planId = request.nextUrl.searchParams.get('planId');

  if (!planId) {
    return NextResponse.json({ error: 'planId is required' }, { status: 400 });
  }

  let found = false;

  await modifyJsonFile<PlansData>(getAiPlansPath(), DEFAULT_PLANS_DATA, (data) => {
    const before = data.plans.length;
    const plans = data.plans.filter((p) => p.plan_id !== planId);
    found = plans.length < before;
    return { ...data, plans };
  });

  if (!found) {
    return NextResponse.json({ error: 'Plan not found' }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
