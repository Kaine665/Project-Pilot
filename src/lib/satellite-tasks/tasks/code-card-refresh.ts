/**
 * Code Card Refresh satellite task.
 *
 * After a Self-Dev Agent session completes (merged code into develop-static),
 * detects which Code Cards cover changed files and triggers AI regeneration.
 *
 * Also runs periodically for any agent session that ends on project-pilot
 * to catch manual code changes.
 *
 * requiresAI = false — the task internally calls callLightweightAI() per card.
 * priority   = 90    — runs last, after all other satellites.
 */

import { refreshStaleCodeCards, stampAllCardsWithCurrentCommit } from '@/lib/code-card-updater';
import type { SatelliteTask, SatelliteContext, TaskConfigSchema } from '../types';
import { getTaskParams } from '../config';

const LOG = '[Satellite:code-card-refresh]';

// ── Defaults ──

const DEFAULT_MIN_TURNS = 2;
/** Only refresh cards for project-pilot sessions or self-dev agents */
const SELF_DEV_AGENT_PREFIX = 'agent-builtin-self-dev';

// ── Per-session guard (don't run multiple times in same session) ──

const sessionRefreshed = new Set<string>();

export const codeCardRefreshTask: SatelliteTask<void> = {
  id: 'code-card-refresh',
  description: 'Self-Dev 会话结束后自动检测并刷新过期的 Code Cards',
  priority: 90,
  requiresAI: false,

  getConfigSchema(): TaskConfigSchema {
    return {
      minTurns: {
        type: 'number',
        title: '最低触发轮次',
        description: '至少多少轮对话后才触发 Code Card 刷新检测',
        default: DEFAULT_MIN_TURNS,
        minimum: 1,
        maximum: 20,
      },
    };
  },

  shouldRun(ctx: SatelliteContext): boolean {
    // Only on completed sessions
    if (ctx.runStatus !== 'completed') return false;

    // Must be a project-pilot project session or self-dev agent
    const isSelfDev = ctx.agentId.startsWith(SELF_DEV_AGENT_PREFIX);
    const isPPProject = ctx.projectKey === 'project-pilot';
    if (!isSelfDev && !isPPProject) return false;

    // Need enough turns to indicate real work was done
    if (ctx.assistantTurnCount < _minTurnsCache) return false;

    // Don't re-run in the same session
    if (sessionRefreshed.has(ctx.sessionId)) return false;

    return true;
  },

  buildPrompt(): string {
    return '';
  },

  parseResult(): void {
    return;
  },

  async execute(_result: void, ctx: SatelliteContext): Promise<void> {
    sessionRefreshed.add(ctx.sessionId);

    console.log(`${LOG} Starting Code Card refresh check for session ${ctx.sessionId}`);

    try {
      // Check if cards have baselines; stamp if not
      const result = await refreshStaleCodeCards();

      if (result.stale === 0) {
        console.log(`${LOG} All ${result.checked} Code Cards up to date.`);
        return;
      }

      console.log(
        `${LOG} Refresh complete: ${result.updated} updated, ${result.failed} failed out of ${result.stale} stale cards.`,
      );

      // Emit event so frontend knows cards were refreshed
      if (result.updated > 0) {
        ctx.emit({
          type: 'system_notification',
          message: `Code Cards 自动刷新：${result.updated} 张卡片已更新`,
        } as never);
      }
    } catch (err) {
      console.error(`${LOG} Refresh failed:`, err);
    }
  },
};

// ── Config cache ──

let _minTurnsCache = DEFAULT_MIN_TURNS;
let _lastCacheRefresh = 0;
const CACHE_TTL_MS = 30_000;

export async function refreshCodeCardRefreshCache(): Promise<void> {
  const now = Date.now();
  if (now - _lastCacheRefresh < CACHE_TTL_MS) return;
  _lastCacheRefresh = now;
  try {
    const params = await getTaskParams('code-card-refresh');
    if (typeof params.minTurns === 'number') {
      _minTurnsCache = Math.max(1, Math.min(20, params.minTurns));
    }
  } catch {
    // Keep existing cache
  }
}
