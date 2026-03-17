/**
 * Active Task Cleanup satellite task.
 *
 * When a session ends (any status), finds active tasks registered with
 * this session's ID and marks them as completed/failed accordingly.
 * This prevents orphaned "running" tasks from accumulating when agents
 * crash or sessions end without explicit cleanup.
 *
 * requiresAI = false — purely mechanical file mutation.
 * priority   = 5     — runs first, before title gen and everything else.
 */

import { finishTasksBySession } from '@/lib/active-tasks';
import type { SatelliteTask, SatelliteContext } from '../types';

const LOG_PREFIX = '[Satellite:active-task-cleanup]';

export const activeTaskCleanupTask: SatelliteTask<void> = {
  id: 'active-task-cleanup',
  description: 'Session 结束后自动清理该会话注册的活跃任务',
  priority: 5,
  requiresAI: false,

  shouldRun(ctx: SatelliteContext): boolean {
    // Run on any terminal status — the session is ending
    return ctx.runStatus === 'completed' ||
           ctx.runStatus === 'failed' ||
           ctx.runStatus === 'stopped';
  },

  buildPrompt(): string {
    return '';
  },

  parseResult(): void {
    return;
  },

  async execute(_result: void, ctx: SatelliteContext): Promise<void> {
    if (!ctx.sessionId) return;

    const targetStatus = ctx.runStatus === 'completed' ? 'completed' : 'failed';
    const count = await finishTasksBySession(ctx.sessionId, targetStatus);

    if (count > 0) {
      console.log(
        `${LOG_PREFIX} Auto-${targetStatus} ${count} active task(s) for session ${ctx.sessionId}`,
      );
    }
  },
};
