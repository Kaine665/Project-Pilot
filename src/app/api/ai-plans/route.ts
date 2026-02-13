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

  if (taskId) {
    const filtered = data.plans.filter((p) => p.task_id === taskId);
    return NextResponse.json({ plans: filtered });
  }

  return NextResponse.json(data);
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
