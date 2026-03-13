/**
 * Title Generation satellite task.
 *
 * Wraps the existing session-title-generator module.
 * requiresAI = false — the title generator has its own provider chain + CLI fallback.
 *
 * Triggers at turns 2, 5, 10, 15 (same as before).
 */

import type { SatelliteTask, SatelliteContext } from '../types';
import { shouldGenerateTitle, generateSessionTitle } from '@/lib/session-title-generator';

export const titleGenerationTask: SatelliteTask<void> = {
  id: 'title-generation',
  description: '根据对话内容自动生成/更新会话标题',
  priority: 10,
  requiresAI: false,

  shouldRun(ctx: SatelliteContext): boolean {
    return shouldGenerateTitle(ctx.assistantTurnCount);
  },

  // Not used for non-AI tasks
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
