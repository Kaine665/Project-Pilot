import { NextRequest, NextResponse } from 'next/server';
import { getTasksPath, getAiPlansPath, readJsonFile } from '@/lib/file-store';
import type { TasksData, PlansData, AIPlan } from '@/types';

const DEFAULT_TASKS_DATA: TasksData = { tasks: [] };
const DEFAULT_PLANS_DATA: PlansData = { plans: [] };

/**
 * GET /api/ai-status
 * Return the current AI execution status for a task.
 * Query: ?taskId=xxx
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const taskId = searchParams.get('taskId');

  if (!taskId) {
    return NextResponse.json({ error: 'taskId query param is required' }, { status: 400 });
  }

  // Read task
  const tasksData = await readJsonFile<TasksData>(getTasksPath(), DEFAULT_TASKS_DATA);
  const task = tasksData.tasks.find((t) => t.id === taskId);

  if (!task) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 });
  }

  // Find latest plan for this task
  const plansData = await readJsonFile<PlansData>(getAiPlansPath(), DEFAULT_PLANS_DATA);
  const taskPlans = plansData.plans
    .filter((p) => p.task_id === taskId)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const latestPlan: AIPlan | null = taskPlans[0] ?? null;

  return NextResponse.json({
    ai_execution: task.ai_execution ?? null,
    latest_plan: latestPlan,
  });
}
