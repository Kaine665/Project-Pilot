/**
 * SatelliteScheduler — runs all registered satellite tasks sequentially
 * after each Agent conversation turn.
 *
 * - Tasks execute in priority order (lower number = earlier)
 * - Each task is error-isolated (one failure doesn't block others)
 * - Checks enabled/disabled config before running each task
 * - AI tasks call callLightweightAI() then parseResult() → execute()
 * - Non-AI tasks call execute() directly with undefined result
 */

import { satelliteRegistry } from './registry';
import { isTaskEnabled } from './config';
import { callLightweightAI } from './lightweight-ai';
import type { SatelliteContext, SatelliteTask } from './types';

const LOG_PREFIX = '[Satellite]';

export async function runSatelliteTasks(ctx: SatelliteContext): Promise<void> {
  const tasks = satelliteRegistry.getAllSorted();

  for (const task of tasks) {
    try {
      // Check enabled config
      const enabled = await isTaskEnabled(task.id);
      if (!enabled) continue;

      // Check runtime condition
      if (!task.shouldRun(ctx)) continue;

      if (task.requiresAI) {
        await runAITask(task, ctx);
      } else {
        // Non-AI task handles everything in execute()
        await task.execute(undefined as never, ctx);
      }
    } catch (err) {
      console.error(`${LOG_PREFIX} Task "${task.id}" failed:`, err);
    }
  }
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
