/**
 * Task Card Generation satellite task.
 *
 * After each agent reply, generates/updates a structured task card
 * summarizing what this session is about, who's doing it, and what stage it's at.
 *
 * Uses incremental updates: first generation looks at recent messages,
 * subsequent updates only see the previous card + latest messages.
 *
 * requiresAI = true — uses lightweight AI (Haiku) via the scheduler.
 */

import type { SatelliteTask, SatelliteContext } from '../types';
import { readTaskCard, writeTaskCard, type TaskCard } from '@/lib/task-card-store';

const LOG = '[Satellite:task-card]';

// ── Prompt templates ──

function buildFirstTimePrompt(ctx: SatelliteContext): string {
  // Take last 10 turns max to control token usage
  const recentMessages = ctx.messages.slice(-20); // 10 pairs of user+assistant
  const conversationText = recentMessages
    .map(m => `[${m.role}]: ${m.content.slice(0, 1500)}`)
    .join('\n\n');

  return `You are analyzing an AI agent conversation to extract a task summary card.

Agent: ${ctx.agentId}
${ctx.projectKey ? `Project: ${ctx.projectKey}` : ''}

Conversation (last messages):
${conversationText}

Output a JSON object with these fields:
- "title": short task name (under 30 chars, in Chinese if the conversation is in Chinese)
- "executor": agent name (from the agent ID, e.g. "Self-Dev Agent", "AI 管家")
- "stage": one of "planning", "developing", "testing", "merging", "done", "discussing"
- "summary": 1-2 sentence current status (in the conversation language)
- "scope": optional array of file paths being modified (if applicable)
- "blockers": optional array of things blocking progress (if any)

Rules:
- "discussing" stage is for non-development conversations (Q&A, brainstorming, design discussion)
- Be concise. The summary should tell someone what's happening at a glance.
- If the conversation just started or has no clear task, still output a card with stage "discussing"

Output ONLY valid JSON, no markdown fences, no explanation.`;
}

function buildIncrementalPrompt(ctx: SatelliteContext, prevCard: TaskCard): string {
  // Only show the latest user+assistant exchange
  const lastMessages = ctx.messages.slice(-2);
  const newText = lastMessages
    .map(m => `[${m.role}]: ${m.content.slice(0, 1500)}`)
    .join('\n\n');

  return `You are updating a task summary card for an AI agent conversation.

Previous card:
${JSON.stringify(prevCard, null, 2)}

New messages since last update:
${newText}

If the new messages don't change the task status meaningfully (e.g. just an acknowledgment like "好的", "收到"), output:
{"changed": false}

Otherwise, output the updated card JSON with all fields:
- "title": short task name (under 30 chars)
- "executor": agent name
- "stage": one of "planning", "developing", "testing", "merging", "done", "discussing"
- "summary": 1-2 sentence current status
- "scope": optional file paths array
- "blockers": optional blockers array

Output ONLY valid JSON, no markdown fences.`;
}

// ── Parse result ──

interface TaskCardResult {
  changed: boolean;
  card?: Omit<TaskCard, 'version' | 'sessionId' | 'updatedAt'>;
}

function parseAIResponse(raw: string): TaskCardResult {
  // Clean up common AI response formatting
  let cleaned = raw.trim();
  // Remove markdown code fences if present
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  const parsed = JSON.parse(cleaned);

  // Check for "no change" response
  if (parsed.changed === false) {
    return { changed: false };
  }

  // Validate required fields
  if (!parsed.title || !parsed.stage || !parsed.summary) {
    throw new Error('Missing required fields in task card response');
  }

  return {
    changed: true,
    card: {
      title: String(parsed.title).slice(0, 60),
      executor: String(parsed.executor || ''),
      stage: parsed.stage,
      summary: String(parsed.summary).slice(0, 300),
      scope: Array.isArray(parsed.scope) ? parsed.scope.map(String) : undefined,
      blockers: Array.isArray(parsed.blockers) ? parsed.blockers.map(String) : undefined,
    },
  };
}

// ── Task definition ──

export const taskCardGenerationTask: SatelliteTask<TaskCardResult> = {
  id: 'task-card-generation',
  description: '每轮对话后自动生成/更新任务状态卡片',
  priority: 15, // After title generation (10), before health guard (20)
  requiresAI: true,

  shouldRun(ctx: SatelliteContext): boolean {
    // Run on every completed turn that has assistant text
    return ctx.runStatus === 'completed' && ctx.assistantText.trim().length > 0;
  },

  buildPrompt(ctx: SatelliteContext): string {
    // We need to check if a previous card exists synchronously...
    // Since buildPrompt is sync, we use the cached card from the module-level variable.
    // The cache is populated in execute() or on first run.
    if (_cachedCard) {
      return buildIncrementalPrompt(ctx, _cachedCard);
    }
    return buildFirstTimePrompt(ctx);
  },

  parseResult(raw: string): TaskCardResult {
    try {
      return parseAIResponse(raw);
    } catch (err) {
      console.warn(`${LOG} Failed to parse AI response:`, err);
      return { changed: false };
    }
  },

  async execute(result: TaskCardResult, ctx: SatelliteContext): Promise<void> {
    // Pre-populate cache for buildPrompt (which runs before execute in the scheduler)
    // Actually the flow is: buildPrompt → AI call → parseResult → execute
    // So we need to load the card BEFORE buildPrompt. We do this via refreshTaskCardCache().

    if (!result.changed || !result.card) {
      console.log(`${LOG} No change for session ${ctx.sessionId}`);
      return;
    }

    const prevCard = _cachedCard;
    const newCard: TaskCard = {
      version: prevCard ? prevCard.version + 1 : 1,
      sessionId: ctx.sessionId,
      updatedAt: new Date().toISOString(),
      ...result.card,
    };

    await writeTaskCard(newCard);
    _cachedCard = newCard;

    // Emit SSE event so frontend can update in real-time
    ctx.emit({ type: 'task_card_updated', card: newCard });

    console.log(`${LOG} Updated card v${newCard.version} for session ${ctx.sessionId}: "${newCard.title}" [${newCard.stage}]`);
  },
};

// ── Cache for buildPrompt (sync access) ──

let _cachedCard: TaskCard | null = null;

/**
 * Load the existing task card into cache before the scheduler calls buildPrompt().
 * Called by the scheduler before evaluating tasks.
 */
export async function refreshTaskCardCache(sessionId?: string): Promise<void> {
  if (!sessionId) {
    _cachedCard = null;
    return;
  }
  try {
    _cachedCard = await readTaskCard(sessionId);
  } catch {
    _cachedCard = null;
  }
}
