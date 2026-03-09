/**
 * session-title-generator — 异步廉价 AI 生成会话标题。
 *
 * 在第 2/5/10/15 轮对话完成后自动触发，用廉价模型（Haiku）
 * 根据对话内容生成/更新标题。优先直接调 Anthropic API（无进程开销），
 * 无 key 时降级到 Claude CLI。
 */

import { getSettings, getProviderScopedApiKey } from '@/lib/settings-manager';
import type { ProviderId } from '@/types';

// ── 配置 ──

const TITLE_TURNS = new Set([2, 5, 10, 15]);
const TITLE_TIMEOUT_MS = 8_000;
const HAIKU_MODEL = 'claude-haiku-4-5-20251001';
const MAX_MSG_CHARS = 200;
const MAX_MSGS = 6;

// ── 公开 API ──

/**
 * 判断当前轮次是否需要生成/更新标题。
 * @param assistantTurnCount 已完成的 assistant 回复轮数
 */
export function shouldGenerateTitle(assistantTurnCount: number): boolean {
  return TITLE_TURNS.has(assistantTurnCount);
}

/**
 * 调用廉价 AI 生成会话标题。
 * @returns 标题字符串，失败返回 null
 */
export async function generateSessionTitle(
  messages: Array<{ role: string; content: string }>,
  existingTitle?: string,
): Promise<string | null> {
  const conversationSummary = buildConversationSummary(messages);
  const prompt = buildTitlePrompt(conversationSummary, existingTitle);

  // 带超时的标题生成
  const result = await Promise.race([
    tryGenerateTitle(prompt),
    timeout(TITLE_TIMEOUT_MS),
  ]);

  if (!result) return null;

  // 清理：去掉引号、多余空白
  const cleaned = result.replace(/^["'「『]+|["'」』]+$/g, '').trim();
  return cleaned.length > 0 && cleaned.length <= 30 ? cleaned : null;
}

// ── 内部实现 ──

function buildConversationSummary(
  messages: Array<{ role: string; content: string }>,
): string {
  const recent = messages.slice(-MAX_MSGS);
  return recent
    .map(m => {
      const label = m.role === 'user' ? '用户' : 'AI';
      const text = m.content.slice(0, MAX_MSG_CHARS);
      return `${label}: ${text}`;
    })
    .join('\n');
}

function buildTitlePrompt(summary: string, existingTitle?: string): string {
  if (existingTitle && existingTitle !== '新会话') {
    return `当前会话标题是「${existingTitle}」。根据最新的对话内容，判断标题是否仍然准确。如果话题已经变化，输出新标题；如果没变，输出原标题。要求：5-15个字，中文，只输出标题本身。

${summary}`;
  }
  return `根据以下对话内容，生成一个简短的会话标题。要求：5-15个字，中文，只输出标题本身。

${summary}`;
}

async function tryGenerateTitle(prompt: string): Promise<string | null> {
  // 策略 1：直接调 Anthropic API（无进程开销）
  const directResult = await tryDirectAnthropicApi(prompt);
  if (directResult) return directResult;

  // 策略 2：降级到 Claude CLI
  return tryClaudeCli(prompt);
}

/**
 * 直接调 Anthropic Messages API。需要 Anthropic API key。
 */
async function tryDirectAnthropicApi(prompt: string): Promise<string | null> {
  try {
    const settings = await getSettings();
    const claude = settings.claude;

    // 仅 api_key 模式才能直接调 API
    if (claude.authMode !== 'api_key') return null;

    const apiKey = getProviderScopedApiKey(claude, 'anthropic' as ProviderId);
    if (!apiKey) return null;

    const baseUrl = (claude.provider === 'anthropic' && claude.baseUrl)
      ? claude.baseUrl
      : 'https://api.anthropic.com';

    const res = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: HAIKU_MODEL,
        max_tokens: 50,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) return null;

    const data = await res.json() as {
      content?: Array<{ type: string; text?: string }>;
    };
    return data.content?.[0]?.text?.trim() ?? null;
  } catch {
    return null;
  }
}

/**
 * 降级方案：通过 Claude CLI 调用。
 * 复用 session-health-guard 的 callClaudeLightweight 模式。
 */
async function tryClaudeCli(prompt: string): Promise<string | null> {
  try {
    // 动态导入避免循环依赖
    const { buildClaudeEnv, buildClaudeModelArgs } = await import('@/lib/settings-manager');
    const { spawnClaude } = await import('@/lib/claude-cli');
    const { StreamParser, LineBuffer } = await import('@/lib/claude-stream-parser');

    const env = await buildClaudeEnv();
    const modelArgs = await buildClaudeModelArgs();

    const claude = spawnClaude([
      '-p', '--verbose',
      '--output-format', 'stream-json',
      ...modelArgs,
    ], { cwd: process.cwd(), shell: false, env });

    return await new Promise<string | null>((resolve) => {
      const lineBuffer = new LineBuffer();
      const streamParser = new StreamParser();
      let fullText = '';
      let settled = false;

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          claude.kill('SIGTERM');
          resolve(null);
        }
      }, TITLE_TIMEOUT_MS);

      claude.stdout?.on('data', (chunk: Buffer) => {
        for (const line of lineBuffer.feed(chunk.toString('utf-8'))) {
          for (const event of streamParser.parse(line)) {
            if (event.type === 'text_delta') {
              fullText += (event as { type: 'text_delta'; text: string }).text;
            }
          }
        }
      });

      claude.on('close', (code) => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        resolve(code === 0 ? fullText.trim() || null : null);
      });

      claude.on('error', () => {
        clearTimeout(timer);
        if (!settled) { settled = true; resolve(null); }
      });

      claude.stdin?.write(prompt);
      claude.stdin?.end();
    });
  } catch {
    return null;
  }
}

function timeout(ms: number): Promise<null> {
  return new Promise(resolve => setTimeout(() => resolve(null), ms));
}
