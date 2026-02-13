import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { getTasksPath, getAiPlansPath, readJsonFile, modifyJsonFile } from '@/lib/file-store';
import type { TasksData, PlansData } from '@/types';

const DEFAULT_TASKS_DATA: TasksData = { tasks: [] };
const DEFAULT_PLANS_DATA: PlansData = { plans: [] };

/**
 * POST /api/ai-execute
 * Start execution of an approved plan.
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

  // 1. Read and verify plan is approved
  const plansData = await readJsonFile<PlansData>(getAiPlansPath(), DEFAULT_PLANS_DATA);
  const plan = plansData.plans.find((p) => p.plan_id === planId);

  if (!plan) {
    return NextResponse.json({ error: 'Plan not found' }, { status: 404 });
  }

  if (plan.status !== 'approved') {
    return NextResponse.json(
      { error: `Plan status is '${plan.status}', expected 'approved'` },
      { status: 400 },
    );
  }

  // 2. Update task's ai_execution to 'running'
  const now = new Date().toISOString();
  await modifyJsonFile<TasksData>(getTasksPath(), DEFAULT_TASKS_DATA, (data) => {
    const index = data.tasks.findIndex((t) => t.id === taskId);
    if (index === -1) return data;

    const tasks = [...data.tasks];
    const existing = tasks[index].ai_execution;
    tasks[index] = {
      ...tasks[index],
      updatedAt: now,
      ai_execution: {
        status: 'running',
        current_plan_id: planId,
        current_execution_id: `exec-${planId}-${Date.now()}`,
        plan_count: existing?.plan_count ?? 0,
        execution_count: (existing?.execution_count ?? 0) + 1,
        last_update: now,
      },
    };
    return { ...data, tasks };
  });

  // 3. Spawn executor agent as detached process
  const cmd = `node scripts/agents/executor.js ${taskId} ${planId}`;
  exec(cmd, { cwd: process.cwd() });

  return NextResponse.json({ success: true });
}
