/**
 * Title Generation satellite task.
 *
 * Wraps the existing session-title-generator module.
 * requiresAI = false — the title generator has its own provider chain + CLI fallback.
 *
 * Configurable: triggerTurns — which assistant turn numbers trigger title generation.
 * Default: [2, 5, 10, 15]
 */

import type { SatelliteTask, SatelliteContext, TaskConfigSchema } from '../types';
import { generateSessionTitle } from '@/lib/session-title-generator';
import { getTaskParams } from '../config';

const DEFAULT_TRIGGER_TURNS = [2, 5, 10, 15];

export const titleGenerationTask: SatelliteTask<void> = {
  id: 'title-generation',
  description: '根据对话内容自动生成/更新会话标题',
  priority: 10,
  requiresAI: false,

  getConfigSchema(): TaskConfigSchema {
    return {
      triggerTurns: {
        type: 'array',
        title: '触发轮次',
        description: '在第几轮 Assistant 回复后触发标题生成（数组）',
        items: { type: 'number' },
        default: DEFAULT_TRIGGER_TURNS,
      },
    };
  },

  shouldRun(ctx: SatelliteContext): boolean {
    // shouldRun is sync but config is async — use module-level cache
    return _triggerTurnsCache.has(ctx.assistantTurnCount);
  },

  buildPrompt(): string {
    return '';
  },

  parseResult(): void {
    // no-op
  },

  async execute(_result: void, ctx: SatelliteContext): Promise<void> {
    try {
      const aiTitle = await generateSessionTitle(
        ctx.messages.map(m => ({ role: m.role, content: m.content })),
        ctx.sessionTitle,
      );
      if (aiTitle) {
        ctx.setSessionTitle(aiTitle);
      }
    } catch (err) {
      console.error('[Satellite:title-generation] Failed:', err);
    }
  },
};

// ── Trigger turns cache ──
// shouldRun() is sync but config is async. We refresh the cache periodically.

let _triggerTurnsCache = new Set(DEFAULT_TRIGGER_TURNS);
let _lastCacheRefresh = 0;
const CACHE_TTL_MS = 30_000; // 30s

/** Refresh trigger turns from config. Call before shouldRun in scheduler. */
export async function refreshTitleTriggerCache(): Promise<void> {
  const now = Date.now();
  if (now - _lastCacheRefresh < CACHE_TTL_MS) return;
  _lastCacheRefresh = now;
  try {
    const params = await getTaskParams('title-generation');
    const turns = Array.isArray(params.triggerTurns) ? params.triggerTurns : DEFAULT_TRIGGER_TURNS;
    _triggerTurnsCache = new Set(turns.filter((t): t is number => typeof t === 'number'));
  } catch {
    // Keep existing cache on error
  }
}
