import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { getTasksPath, getAiPlansPath, readJsonFile, modifyJsonFile } from '@/lib/file-store';
import type { TasksData, PlansData } from '@/types';

const DEFAULT_TASKS_DATA: TasksData = { tasks: [] };
const DEFAULT_PLANS_DATA: PlansData = { plans: [] };

/**
 * POST /api/ai-plan
 * Start plan generation for a task.
 * Body: { taskId }
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { taskId } = body;

  if (!taskId) {
    return NextResponse.json({ error: 'taskId is required' }, { status: 400 });
  }

  // 1. Read the task
  const tasksData = await readJsonFile<TasksData>(getTasksPath(), DEFAULT_TASKS_DATA);
  const task = tasksData.tasks.find((t) => t.id === taskId);

  if (!task) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 });
  }

  // 2. Determine version number from existing plans
  const plansData = await readJsonFile<PlansData>(getAiPlansPath(), DEFAULT_PLANS_DATA);
  const existingPlans = plansData.plans.filter((p) => p.task_id === taskId);
  const version = existingPlans.length + 1;

  // 3. Generate planId
  const planId = `plan-${taskId}-v${version}-${Date.now()}`;

  // 4. Update task's ai_execution status to 'planning'
  const now = new Date().toISOString();
  await modifyJsonFile<TasksData>(getTasksPath(), DEFAULT_TASKS_DATA, (data) => {
    const index = data.tasks.findIndex((t) => t.id === taskId);
    if (index === -1) return data;

    const tasks = [...data.tasks];
    tasks[index] = {
      ...tasks[index],
      updatedAt: now,
      ai_execution: {
        status: 'planning',
        current_plan_id: planId,
        plan_count: (tasks[index].ai_execution?.plan_count ?? 0) + 1,
        execution_count: tasks[index].ai_execution?.execution_count ?? 0,
        last_update: now,
      },
    };
    return { ...data, tasks };
  });

  // 5. Spawn planner agent as detached process
  const cmd = `node scripts/agents/planner.js ${taskId} ${planId}`;
  exec(cmd, { cwd: process.cwd() });

  return NextResponse.json({ success: true, planId });
}
