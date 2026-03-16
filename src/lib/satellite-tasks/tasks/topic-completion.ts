/**
 * Topic Completion Detection satellite task.
 *
 * After each conversation turn, uses AI to judge whether the user's
 * original intent has been fulfilled. When detected, emits a
 * `topic_completion` SSE event so the frontend can display a subtle
 * indicator or prompt the user.
 *
 * requiresAI = true — uses callLightweightAI() via the scheduler.
 *
 * Configurable: triggerTurns — which assistant turn numbers trigger detection.
 * Default: [3, 6, 10, 15, 20]
 */

import type { SatelliteTask, SatelliteContext, TaskConfigSchema } from '../types';
import { getTaskParams } from '../config';

const DEFAULT_TRIGGER_TURNS = [3, 6, 10, 15, 20];
const LOG_PREFIX = '[Satellite:topic-completion]';

interface TopicCompletionResult {
  completed: boolean;
  confidence: number; // 0-1
  summary: string;
}

export const topicCompletionTask: SatelliteTask<TopicCompletionResult> = {
  id: 'topic-completion',
  description: '检测对话是否已完成用户最初意图，提示用户或标记会话状态',
  priority: 30,
  requiresAI: true,

  getConfigSchema(): TaskConfigSchema {
    return {
      triggerTurns: {
        type: 'array',
        title: '触发轮次',
        description: '在第几轮 Assistant 回复后触发完成检测（数组）',
        items: { type: 'number' },
        default: DEFAULT_TRIGGER_TURNS,
      },
      confidenceThreshold: {
        type: 'number',
        title: '置信度阈值',
        description: '只在置信度高于此值时标记为已完成（0-1）',
        default: 0.7,
        minimum: 0,
        maximum: 1,
      },
    };
  },

  shouldRun(ctx: SatelliteContext): boolean {
    // Only check on normal completions
    if (ctx.runStatus !== 'completed') return false;
    // Check if current turn is in trigger list
    return _triggerTurnsCache.has(ctx.assistantTurnCount);
  },

  buildPrompt(ctx: SatelliteContext): string {
    // Extract the first user message as "original intent"
    const firstUserMsg = ctx.messages.find(m => m.role === 'user');
    const firstIntent = firstUserMsg
      ? firstUserMsg.content.slice(0, 500)
      : '(无法获取)';

    // Take the last 3 message pairs for recent context
    const recentMessages = ctx.messages.slice(-6);
    const recentText = recentMessages
      .map(m => `[${m.role}]: ${m.content.slice(0, 300)}`)
      .join('\n');

    return `你是一个对话意图完成检测器。分析以下对话，判断用户最初的意图是否已经被完成。

## 用户最初意图
${firstIntent}

## 最近对话（最多 3 轮）
${recentText}

## 当前状态
- 对话轮次：${ctx.assistantTurnCount}
- 消息总数：${ctx.messages.length}

## 判断标准
- **已完成**：用户的请求已被满足，AI 已给出完整回答/执行完任务，对话可以自然结束
- **未完成**：用户还在追问、AI 仍在执行中、任务只完成了部分、等待用户确认后续操作
- 对于多步骤任务，如果所有步骤都已完成则标记为已完成
- 如果用户最初意图模糊（如闲聊），需要 AI 完整回应后也视为已完成

只输出一行 JSON，不要输出其他内容：
{"completed": true或false, "confidence": 0到1的数字, "summary": "简短总结完成状态"}`;
  },

  parseResult(raw: string): TopicCompletionResult {
    const jsonMatch = raw.match(/\{[\s\S]*?"completed"[\s\S]*?\}/);
    if (!jsonMatch) {
      return { completed: false, confidence: 0, summary: 'Failed to parse response' };
    }
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        completed: !!parsed.completed,
        confidence: typeof parsed.confidence === 'number'
          ? Math.max(0, Math.min(1, parsed.confidence))
          : 0,
        summary: typeof parsed.summary === 'string' ? parsed.summary : '',
      };
    } catch {
      return { completed: false, confidence: 0, summary: 'Failed to parse JSON' };
    }
  },

  async execute(result: TopicCompletionResult, ctx: SatelliteContext): Promise<void> {
    console.log(
      `${LOG_PREFIX} completed=${result.completed}, confidence=${result.confidence}, summary="${result.summary}"`,
    );

    // Only emit when completed with sufficient confidence
    if (!result.completed || result.confidence < _confidenceThresholdCache) {
      return;
    }

    // Emit SSE event for frontend
    ctx.emit({
      type: 'topic_completion',
      completed: true,
      confidence: result.confidence,
      summary: result.summary,
    });
  },
};

// ── Config caches ──
// shouldRun() is sync but config is async. Refresh periodically.

let _triggerTurnsCache = new Set(DEFAULT_TRIGGER_TURNS);
let _confidenceThresholdCache = 0.7;
let _lastCacheRefresh = 0;
const CACHE_TTL_MS = 30_000;

/** Refresh config from persistent storage. Call before shouldRun in scheduler. */
export async function refreshTopicCompletionCache(): Promise<void> {
  const now = Date.now();
  if (now - _lastCacheRefresh < CACHE_TTL_MS) return;
  _lastCacheRefresh = now;
  try {
    const params = await getTaskParams('topic-completion');
    // triggerTurns
    const turns = Array.isArray(params.triggerTurns) ? params.triggerTurns : DEFAULT_TRIGGER_TURNS;
    _triggerTurnsCache = new Set(turns.filter((t): t is number => typeof t === 'number'));
    // confidenceThreshold
    if (typeof params.confidenceThreshold === 'number') {
      _confidenceThresholdCache = Math.max(0, Math.min(1, params.confidenceThreshold));
    }
  } catch {
    // Keep existing cache
  }
}
