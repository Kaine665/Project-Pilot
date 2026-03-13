/**
 * SatelliteScheduler — runs eligible satellite tasks after each conversation turn.
 *
 * Called from AgentChatManager.finalizeRun() after agent actions are processed.
 * Tasks run sequentially in priority order. Each task is isolated —
 * a failure in one task does not affect others.
 */

import type { SatelliteContext, SatelliteTask } from './types';
import { satelliteRegistry } from './registry';
import { callLightweightAI } from './lightweight-ai';

const LOG_PREFIX = '[Satellite]';

/**
 * Run all eligible satellite tasks for the current turn.
 *
 * @param ctx - The satellite context built from the current run state
 */
export async function runSatelliteTasks(ctx: SatelliteContext): Promise<void> {
  const tasks = satelliteRegistry.getAllSorted();
  if (tasks.length === 0) return;

  for (const task of tasks) {
    try {
      if (!task.shouldRun(ctx)) continue;

      console.log(`${LOG_PREFIX} Running: ${task.id}`);

      if (task.requiresAI) {
        await runAITask(task, ctx);
      } else {
        // Non-AI task: execute directly with undefined result
        await task.execute(undefined as never, ctx);
      }

      console.log(`${LOG_PREFIX} Completed: ${task.id}`);
    } catch (err) {
      // Isolate failures — log and continue to next task
      console.error(`${LOG_PREFIX} Failed: ${task.id}`, err);
    }
  }
}

async function runAITask(task: SatelliteTask, ctx: SatelliteContext): Promise<void> {
  const prompt = task.buildPrompt(ctx);
  const raw = await callLightweightAI(prompt);
  const result = task.parseResult(raw);
  await task.execute(result, ctx);
}
