/**
 * session-title-generator — 异步廉价 AI 生成会话标题。
 *
 * 在第 2/5/10/15 轮对话完成后自动触发。
 * 按用户配置的 chain（重试链）依次尝试不同 provider+model，
 * 一个失败就试下一个，直到成功或全部失败。
 */

import { getSettings, getProviderScopedApiKey } from '@/lib/settings-manager';
import { getProviderPreset } from '@/lib/provider-registry';
import type { ProviderId, TitleGenerationChainEntry, TitleGenerationSettings } from '@/types';
import { DEFAULT_TITLE_GENERATION } from '@/types';

// ── 配置 ──

const TITLE_TURNS = new Set([2, 5, 10, 15]);
const ENTRY_TIMEOUT_MS = 8_000;
const MAX_MSG_CHARS = 200;
const MAX_MSGS = 6;

// ── 公开 API ──

/**
 * 判断当前轮次是否需要生成/更新标题。
 */
export function shouldGenerateTitle(assistantTurnCount: number): boolean {
  return TITLE_TURNS.has(assistantTurnCount);
}

/**
 * 按配置的重试链依次尝试生成标题。
 * @returns 标题字符串，全部失败返回 null
 */
export async function generateSessionTitle(
  messages: Array<{ role: string; content: string }>,
  existingTitle?: string,
): Promise<string | null> {
  const settings = await getSettings();
  const titleConfig: TitleGenerationSettings = {
    ...DEFAULT_TITLE_GENERATION,
    ...settings.titleGeneration,
  };

  if (titleConfig.enabled === false) return null;

  const chain = titleConfig.chain?.length
    ? titleConfig.chain
    : DEFAULT_TITLE_GENERATION.chain!;

  const conversationSummary = buildConversationSummary(messages);
  const prompt = buildTitlePrompt(conversationSummary, existingTitle);

  // 依次尝试链中的每个 provider+model
  for (let i = 0; i < chain.length; i++) {
    const entry = chain[i];
    try {
      const result = await Promise.race([
        callProviderApi(entry, prompt, settings.claude),
        timeout(ENTRY_TIMEOUT_MS),
      ]);

      if (result) {
        const cleaned = cleanTitle(result);
        if (cleaned) return cleaned;
      }
      // 结果为空或清理后无效 → 试下一个
    } catch {
      // 当前条目失败 → 试下一个
    }
  }

  return null;
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
  if (existingTitle && existingTitle !== '新会话' && !existingTitle.endsWith('...')) {
    return `当前会话标题是「${existingTitle}」。根据最新的对话内容，判断标题是否仍然准确。如果话题已经变化，输出新标题；如果没变，输出原标题。要求：5-15个字，中文，只输出标题本身。

${summary}`;
  }
  return `根据以下对话内容，生成一个简短的会话标题。要求：5-15个字，中文，只输出标题本身。

${summary}`;
}

function cleanTitle(raw: string): string | null {
  const cleaned = raw.replace(/^["'「『""]+|["'」』""]+$/g, '').trim();
  return cleaned.length > 0 && cleaned.length <= 30 ? cleaned : null;
}

/**
 * 调用指定 provider 的 API 生成标题。
 * 支持 Anthropic 直接 API 和通用 OpenAI-compatible API。
 */
async function callProviderApi(
  entry: TitleGenerationChainEntry,
  prompt: string,
  claude: { authMode?: string; baseUrl?: string; providerApiKeys?: Partial<Record<ProviderId, string>>; apiKey?: string; provider?: ProviderId },
): Promise<string | null> {
  const apiKey = getProviderScopedApiKey(
    claude as Parameters<typeof getProviderScopedApiKey>[0],
    entry.provider,
  );
  if (!apiKey) return null;

  const preset = getProviderPreset(entry.provider);

  if (entry.provider === 'anthropic') {
    return callAnthropicApi(apiKey, entry.model, prompt, claude.baseUrl);
  }

  // OpenAI-compatible API（openai, deepseek, qwen, zhipu, minimax, kimi, openrouter, ollama, custom）
  const baseUrl = claude.provider === entry.provider && claude.baseUrl
    ? claude.baseUrl
    : preset.baseUrl;

  if (!baseUrl) return null;
  return callOpenAiCompatibleApi(apiKey, entry.model, prompt, baseUrl);
}

/**
 * 直接调 Anthropic Messages API。
 */
async function callAnthropicApi(
  apiKey: string,
  model: string,
  prompt: string,
  baseUrlOverride?: string,
): Promise<string | null> {
  const baseUrl = baseUrlOverride || 'https://api.anthropic.com';
  const res = await fetch(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 50,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) return null;

  const data = await res.json() as {
    content?: Array<{ type: string; text?: string }>;
  };
  return data.content?.[0]?.text?.trim() ?? null;
}

/**
 * 调 OpenAI-compatible API（/v1/chat/completions）。
 */
async function callOpenAiCompatibleApi(
  apiKey: string,
  model: string,
  prompt: string,
  baseUrl: string,
): Promise<string | null> {
  // 标准化 baseUrl（去掉尾部 /v1 等）
  const cleanBase = baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '');
  const res = await fetch(`${cleanBase}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: 50,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) return null;

  const data = await res.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content?.trim() ?? null;
}

function timeout(ms: number): Promise<null> {
  return new Promise(resolve => setTimeout(() => resolve(null), ms));
}
