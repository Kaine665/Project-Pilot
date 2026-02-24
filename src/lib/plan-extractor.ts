import { getAiPlansPath, readJsonFile, modifyJsonFile } from '@/lib/file-store';
import type { AIPlan, PlansData } from '@/types';

const DEFAULT_PLANS_DATA: PlansData = { plans: [] };

/**
 * Scan assistant response text for a ```json:plan code block.
 * Returns the parsed plan data, or null if not found.
 */
export function extractPlanFromText(text: string): Partial<AIPlan> | null {
  const regex = /```json:plan\s*\n([\s\S]*?)```/;
  const match = text.match(regex);
  if (!match) return null;

  try {
    const parsed = JSON.parse(match[1]);
    if (parsed.steps && Array.isArray(parsed.steps)) {
      return parsed;
    }
  } catch {
    // Malformed JSON — ignore
  }
  return null;
}

/**
 * Save an extracted plan to ai-plans.json.
 * Returns the generated planId.
 */
export async function savePlan(
  taskId: string,
  planData: Partial<AIPlan>,
): Promise<string> {
  const plansData = await readJsonFile<PlansData>(getAiPlansPath(), DEFAULT_PLANS_DATA);
  const existingPlans = plansData.plans.filter((p) => p.task_id === taskId);

  // Determine version from existing plan IDs
  const maxVersion = existingPlans.reduce((max, p) => {
    const match = p.plan_id.match(/-v(\d+)-/);
    return match ? Math.max(max, parseInt(match[1], 10)) : max;
  }, 0);
  const version = maxVersion + 1;

  const planId = `plan-${taskId}-v${version}-${Date.now()}`;

  const fullPlan: AIPlan = {
    plan_id: planId,
    task_id: taskId,
    version,
    status: 'pending_approval',
    created_at: new Date().toISOString(),
    analysis: planData.analysis ?? '',
    steps: (planData.steps ?? []).map((s, i) => ({
      id: s.id ?? i + 1,
      type: s.type ?? 'auto',
      action: s.action ?? `Step ${i + 1}`,
      description: s.description,
      status: 'pending' as const,
      risk_level: s.risk_level,
    })),
    step_count: planData.steps?.length ?? 0,
    steps_completed: 0,
    execution_count: 0,
    expected_results: planData.expected_results,
    risks: planData.risks,
    execution_notes: planData.execution_notes,
  };

  await modifyJsonFile<PlansData>(getAiPlansPath(), DEFAULT_PLANS_DATA, (data) => ({
    ...data,
    plans: [...data.plans, fullPlan],
  }));

  return planId;
}
