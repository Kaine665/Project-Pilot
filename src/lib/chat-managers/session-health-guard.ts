/**
 * Session Health Guard — lightweight Claude CLI call that checks whether
 * an Agent session ended abnormally and, if so, automatically resumes
 * the session with an error description injected as a user message.
 *
 * Design:
 * - Triggered only for `failed` or `stopped` sessions
 * - Uses a one-shot `claude -p` call (no AgentChatManager overhead)
 * - Checks the last 100 characters of assistant output
 * - Fires at most once per session (guardRetryCount >= 1 → skip)
 */

import { spawnClaude } from '@/lib/claude-cli';
import { buildClaudeEnv, buildClaudeModelArgs } from '@/lib/settings-manager';
import { StreamParser, LineBuffer } from '@/lib/claude-stream-parser';
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

function callClaudeLightweight(prompt: string): Promise<string> {
  return new Promise(async (resolve, reject) => {
    let env: NodeJS.ProcessEnv;
    let modelArgs: string[];

    try {
      env = await buildClaudeEnv();
      modelArgs = await buildClaudeModelArgs();
    } catch (err) {
      return reject(err);
    }

    const claude = spawnClaude([
      '-p',
      '--verbose',
      '--output-format', 'stream-json',
      ...modelArgs,
    ], {
      cwd: process.cwd(),
      shell: false,
      env,
    });

    const lineBuffer = new LineBuffer();
    const streamParser = new StreamParser();
    let fullText = '';
    let settled = false;

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        claude.kill('SIGTERM');
        reject(new Error('Health guard timed out'));
      }
    }, GUARD_TIMEOUT_MS);

    claude.stdout?.on('data', (chunk: Buffer) => {
      for (const line of lineBuffer.feed(chunk.toString('utf-8'))) {
        for (const event of streamParser.parse(line)) {
          if (event.type === 'text_delta') {
            fullText += event.text;
          }
        }
      }
    });

    claude.on('close', (code) => {
      clearTimeout(timeout);
      if (settled) return;
      settled = true;

      // Flush remaining
      const remaining = lineBuffer.flush();
      if (remaining) {
        for (const event of streamParser.parse(remaining)) {
          if (event.type === 'text_delta') {
            fullText += event.text;
          }
        }
      }

      if (code === 0) {
        resolve(fullText.trim());
      } else {
        reject(new Error(`Claude exited with code ${code}`));
      }
    });

    claude.on('error', (err) => {
      clearTimeout(timeout);
      if (!settled) {
        settled = true;
        reject(err);
      }
    });

    claude.stdin?.write(prompt);
    claude.stdin?.end();
  });
}
