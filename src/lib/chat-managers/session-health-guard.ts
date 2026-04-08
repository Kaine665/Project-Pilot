/**
 * Session Health Guard — lightweight Claude SDK call that checks whether
 * an Agent session ended abnormally and, if so, automatically resumes
 * the session with an error description injected as a user message.
 *
 * Design:
 * - Triggered only for `failed` or `stopped` sessions (not user-initiated stops)
 * - Uses query() from @anthropic-ai/claude-agent-sdk (no CLI subprocess needed)
 * - Checks the last 100 characters of assistant output
 * - Fires at most once per session (guardRetryCount >= 1 → skip)
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import { getAppWorkingDir } from '@/lib/app-paths';
import { buildSdkQueryOptions } from '@/lib/settings-manager';
import { SdkEventAdapter } from '@/lib/sdk-event-adapter';
import type { RunStatus } from './types';

// ── Types ──

export interface HealthCheckInput {
  sessionId: string;
  agentId: string;
  status: RunStatus;
  tailText: string;
  guardRetryCount: number;
}

interface HealthCheckResult {
  abnormal: boolean;
  reason: string;
}

// ── Constants ──

const LOG_PREFIX = '[HealthGuard]';
const MAX_GUARD_RETRIES = 1;
const GUARD_TIMEOUT_MS = 30_000; // 30 seconds

// ── Core ──

/**
 * Run a lightweight health check on a finished session.
 * Returns the check result, or null if the check was skipped or failed.
 */
export async function checkSessionHealth(
  input: HealthCheckInput,
): Promise<HealthCheckResult | null> {
  // Gate: only check failed/stopped
  if (input.status !== 'failed' && input.status !== 'stopped') {
    return null;
  }

  // Gate: respect retry limit
  if (input.guardRetryCount >= MAX_GUARD_RETRIES) {
    console.log(`${LOG_PREFIX} Skipping — guardRetryCount=${input.guardRetryCount} >= ${MAX_GUARD_RETRIES}`);
    return null;
  }

  // Gate: nothing to check
  if (!input.tailText.trim()) {
    console.log(`${LOG_PREFIX} Skipping — no tail text`);
    return null;
  }

  const prompt = buildCheckPrompt(input.status, input.tailText);

  try {
    const raw = await callClaudeLightweight(prompt);
    const result = parseCheckResult(raw);
    console.log(`${LOG_PREFIX} sessionId=${input.sessionId} abnormal=${result.abnormal} reason="${result.reason}"`);
    return result;
  } catch (err) {
    console.error(`${LOG_PREFIX} Check failed:`, err);
    return null;
  }
}

/**
 * Build the message that will be injected into the original session
 * when the guard determines an abnormal exit.
 */
export function buildGuardMessage(status: string, reason: string): string {
  return (
    `[系统健康检查] 检测到你的上一次执行异常结束。\n` +
    `状态: ${status}\n` +
    `原因: ${reason}\n` +
    `请检查并继续完成之前的任务。`
  );
}

// ── Internal helpers ──

function buildCheckPrompt(status: string, tailText: string): string {
  return `你是一个会话健康检查器。以下是一个 AI Agent 会话结束时的最后输出片段。
请判断这个会话是正常结束还是异常结束。

会话状态: ${status}
最后输出 (最后 100 字符):
---
${tailText}
---

判断标准：
- 正常：AI 完成了任务、给出了总结、或正常告别
- 异常：报错信息、未完成的句子、工具调用失败、意外中断

只输出一行 JSON，不要输出其他内容：
{"abnormal": true或false, "reason": "简短描述原因"}`;
}

function parseCheckResult(raw: string): HealthCheckResult {
  // Try to extract JSON from the response (the model might wrap it in markdown)
  const jsonMatch = raw.match(/\{[\s\S]*?"abnormal"[\s\S]*?\}/);
  if (!jsonMatch) {
    return { abnormal: false, reason: 'Failed to parse guard response' };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      abnormal: !!parsed.abnormal,
      reason: typeof parsed.reason === 'string' ? parsed.reason : 'Unknown',
    };
  } catch {
    return { abnormal: false, reason: 'Failed to parse guard JSON' };
  }
}

async function callClaudeLightweight(prompt: string): Promise<string> {
  const abortController = new AbortController();

  // 超时后中止 SDK query
  const timeoutHandle = setTimeout(() => {
    abortController.abort();
  }, GUARD_TIMEOUT_MS);

  try {
    // 使用与主流程一致的 SDK options，完全关闭工具（纯文本一次性回复）
    const sdkOpts = await buildSdkQueryOptions({
      capabilities: {
        bash: false,
        fileAccess: false,
        web: false,
        subAgent: false,
        skipReview: false,
        todoRead: false,
        exposePromptPath: false,
        dataStore: false,
        registryMcp: false,
        documentsMcp: false,
      },
      cwd: getAppWorkingDir(),
    });

    const adapter = new SdkEventAdapter();
    let fullText = '';

    const sdkQuery = query({
      prompt,
      options: { ...sdkOpts, abortController },
    });

    for await (const msg of sdkQuery) {
      for (const event of adapter.adapt(msg)) {
        if (event.type === 'text_delta') {
          fullText += event.text;
        }
      }
    }

    return fullText.trim();
  } finally {
    clearTimeout(timeoutHandle);
  }
}
