/**
 * SatelliteScheduler — runs all registered satellite tasks sequentially
 * after each Agent conversation turn.
 *
 * - Tasks execute in priority order (lower number = earlier)
 * - Each task is error-isolated (one failure doesn't block others)
 * - Checks enabled/disabled config before running each task
 * - AI tasks call callLightweightAI() then parseResult() → execute()
 * - Non-AI tasks call execute() directly with undefined result
 * - Every execution is recorded via run-store for observability
 */

import { satelliteRegistry } from './registry';
import { isTaskEnabled } from './config';
import { callLightweightAI } from './lightweight-ai';
import { appendRun } from './run-store';
import { getSettings } from '@/lib/settings-manager';
import { refreshTitleTriggerCache } from './tasks/title-generation';
import { refreshHealthGuardCache } from './tasks/health-guard';
import { refreshKnowledgeExtractionCache } from './tasks/knowledge-extraction';
import { refreshTopicCompletionCache } from './tasks/topic-completion';
import { refreshTaskCardCache } from './tasks/task-card-generation';
import { refreshCodeCardRefreshCache } from './tasks/code-card-refresh';
import type { SatelliteContext, SatelliteTask } from './types';

const LOG_PREFIX = '[Satellite]';

export async function runSatelliteTasks(ctx: SatelliteContext): Promise<void> {
  const settings = await getSettings();
  if (settings.developer?.satelliteTasksEnabled === false) {
    ctx.emit({ type: 'stream_end' });
    return;
  }

  // Refresh config caches before evaluating shouldRun (which is sync)
  await Promise.all([
    refreshTitleTriggerCache(),
    refreshHealthGuardCache(),
    refreshKnowledgeExtractionCache(),
    refreshTopicCompletionCache(),
    refreshTaskCardCache(ctx.sessionId),
    refreshCodeCardRefreshCache(),
  ]);

  const tasks = satelliteRegistry.getAllSorted();

  for (const task of tasks) {
    try {
      // Check enabled config
      const enabled = await isTaskEnabled(task.id);
      if (!enabled) continue;

      // Check runtime condition
      if (!task.shouldRun(ctx)) {
        // Record skipped runs (shouldRun returned false)
        await recordRun(task.id, ctx, 0, 'skipped', 'shouldRun returned false');
        continue;
      }

      // Execute with timing
      const startMs = Date.now();
      try {
        if (task.requiresAI) {
          await runAITask(task, ctx);
        } else {
          await task.execute(undefined as never, ctx);
        }
        const durationMs = Date.now() - startMs;
        await recordRun(task.id, ctx, durationMs, 'success');
      } catch (execErr) {
        const durationMs = Date.now() - startMs;
        const detail = execErr instanceof Error ? execErr.message : String(execErr);
        await recordRun(task.id, ctx, durationMs, 'failed', detail);
        // Re-throw so the outer catch logs it
        throw execErr;
      }
    } catch (err) {
      console.error(`${LOG_PREFIX} Task "${task.id}" failed:`, err);
    }
  }

  // Signal that all satellite tasks are done — the SSE connection can now be closed.
  // The frontend uses 'done' to finalize the UI immediately; 'stream_end' is the actual
  // close signal so that satellite SSE events (e.g. task_card_updated) are not lost.
  ctx.emit({ type: 'stream_end' });
}

async function runAITask(task: SatelliteTask, ctx: SatelliteContext): Promise<void> {
  const prompt = task.buildPrompt(ctx);
  const raw = await callLightweightAI(prompt);
  if (!raw) {
    console.warn(`${LOG_PREFIX} AI returned empty for task "${task.id}"`);
    return;
  }
  const result = task.parseResult(raw);
  await task.execute(result, ctx);
}

/** Fire-and-forget run record. Never throws. */
async function recordRun(
  taskId: string,
  ctx: SatelliteContext,
  durationMs: number,
  status: 'success' | 'skipped' | 'failed',
  detail?: string,
): Promise<void> {
  try {
    await appendRun({
      taskId,
      sessionId: ctx.sessionId,
      agentId: ctx.agentId,
      timestamp: Date.now(),
      durationMs,
      status,
      detail,
    });
  } catch (err) {
    // Recording failure must never break the scheduler
    console.warn(`${LOG_PREFIX} Failed to record run for "${taskId}":`, err);
  }
}
