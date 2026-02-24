import { NextRequest, NextResponse } from 'next/server';
import {
  getTaskArtifactsPath,
  getAiPlansPath,
  readJsonFile,
  writeJsonFile,
} from '@/lib/file-store';
import type { TaskArtifacts, PlansData, AIPlan } from '@/types';

/**
 * GET /api/task-artifacts?taskId=xxx
 * Return the side panel artifacts for a task (understanding, latest plan, result).
 */
export async function GET(request: NextRequest) {
  const taskId = request.nextUrl.searchParams.get('taskId');
  if (!taskId) {
    return NextResponse.json({ error: 'taskId is required' }, { status: 400 });
  }

  const artifacts = await readJsonFile<TaskArtifacts>(
    getTaskArtifactsPath(taskId),
    { taskId, updatedAt: '' },
  );

  // Also fetch the latest plan for this task
  const plansData = await readJsonFile<PlansData>(getAiPlansPath(), { plans: [] });
  const taskPlans = plansData.plans
    .filter((p) => p.task_id === taskId)
    .sort((a, b) => b.version - a.version);
  const latestPlan: AIPlan | null = taskPlans[0] ?? null;

  return NextResponse.json({
    ...artifacts,
    plan: latestPlan,
  });
}

/**
 * DELETE /api/task-artifacts?taskId=xxx
 * Clear all artifacts for a task (understanding, result).
 * Also clears all plans associated with this task.
 */
export async function DELETE(request: NextRequest) {
  const taskId = request.nextUrl.searchParams.get('taskId');
  if (!taskId) {
    return NextResponse.json({ error: 'taskId is required' }, { status: 400 });
  }

  // Clear task artifacts (understanding, result)
  await writeJsonFile(getTaskArtifactsPath(taskId), {
    taskId,
    updatedAt: new Date().toISOString()
  });

  // Clear all plans for this task
  const plansData = await readJsonFile<PlansData>(getAiPlansPath(), { plans: [] });
  const filteredPlans = plansData.plans.filter((p) => p.task_id !== taskId);
  await writeJsonFile(getAiPlansPath(), { plans: filteredPlans });

  return NextResponse.json({ ok: true });
}
