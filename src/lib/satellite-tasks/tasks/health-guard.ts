/**
 * Health Guard satellite task.
 *
 * Detects abnormal session endings (crashes, tool failures, incomplete output)
 * and auto-resumes the session with an error description.
 *
 * requiresAI = true — uses callLightweightAI() for the health check judgment.
 */

import type { SatelliteTask, SatelliteContext } from '../types';

interface HealthCheckResult {
  abnormal: boolean;
  reason: string;
}

export const healthGuardTask: SatelliteTask<HealthCheckResult> = {
  id: 'health-guard',
  description: '检测异常结束的会话并自动恢复',
  priority: 20,
  requiresAI: true,

  shouldRun(ctx: SatelliteContext): boolean {
    // Only check failed/stopped sessions
    if (ctx.runStatus !== 'failed' && ctx.runStatus !== 'stopped') return false;
    // Respect retry limit (max 1)
    if (ctx.guardRetryCount >= 1) return false;
    // Need tail text to judge
    const tailText = ctx.assistantText.slice(-100).trim();
    if (!tailText) return false;
    return true;
  },

  buildPrompt(ctx: SatelliteContext): string {
    const tailText = ctx.assistantText.slice(-100);
    return `你是一个会话健康检查器。以下是一个 AI Agent 会话结束时的最后输出片段。
请判断这个会话是正常结束还是异常结束。

会话状态: ${ctx.runStatus}
最后输出 (最后 100 字符):
---
${tailText}
---

判断标准：
- 正常：AI 完成了任务、给出了总结、或正常告别
- 异常：报错信息、未完成的句子、工具调用失败、意外中断

只输出一行 JSON，不要输出其他内容：
{"abnormal": true或false, "reason": "简短描述原因"}`;
  },

  parseResult(raw: string): HealthCheckResult {
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
  },

  async execute(result: HealthCheckResult, ctx: SatelliteContext): Promise<void> {
    if (!result.abnormal) return;

    console.log(`[Satellite:health-guard] Abnormal exit detected: ${result.reason}`);

    const guardMsg =
      `[系统健康检查] 检测到你的上一次执行异常结束。\n` +
      `状态: ${ctx.runStatus}\n` +
      `原因: ${result.reason}\n` +
      `请检查并继续完成之前的任务。`;

    // Defer resume to after finalization completes
    ctx.resumeSession(guardMsg);
  },
};
