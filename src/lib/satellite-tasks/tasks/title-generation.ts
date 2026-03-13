/**
 * Title Generation satellite task.
 *
 * Migrated from session-title-generator.ts.
 * Generates/updates session titles at turn 2/5/10/15 using the configured
 * provider chain (direct API) with CLI fallback.
 *
 * The original session-title-generator.ts remains as a thin utility module
 * (exports generateSessionTitle, shouldGenerateTitle, testTitleChainEntry).
 * This satellite task wraps it in the SatelliteTask interface.
 */

import type { SatelliteTask, SatelliteContext } from '../types';
import { shouldGenerateTitle, generateSessionTitle } from '@/lib/session-title-generator';

// ── Types ──

interface TitleResult {
  title: string | null;
}

// ── Task Definition ──

export const titleGenerationTask: SatelliteTask<TitleResult> = {
  id: 'title-generation',
  description: 'Generate or update session title at key conversation turns',
  priority: 10,
  requiresAI: false, // Uses its own provider chain, not the shared lightweight AI

  shouldRun(ctx: SatelliteContext): boolean {
    return shouldGenerateTitle(ctx.assistantTurnCount);
  },

  // Not used (requiresAI = false), but required by interface
  buildPrompt(): string {
    return '';
  },

  parseResult(): TitleResult {
    return { title: null };
  },

  async execute(_result: TitleResult, ctx: SatelliteContext): Promise<void> {
    const title = await generateSessionTitle(
      ctx.messages.map(m => ({ role: m.role, content: m.content })),
      ctx.sessionTitle,
    );

    if (title) {
      ctx.setSessionTitle(title);
    }
  },
};
