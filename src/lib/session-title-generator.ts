/**
 * session-title-generator — 异步廉价 AI 生成会话标题。
 *
 * 在第 2/5/10/15 轮对话完成后自动触发。
 * 按用户配置的 chain（重试链）依次尝试不同 provider+model，
 * 一个失败就试下一个，直到成功或全部失败。
 */

import { getSettings, getProviderScopedApiKey, getProviderScopedBaseUrl, buildClaudeEnv } from '@/lib/settings-manager';
import { getProviderPreset } from '@/lib/provider-registry';
import { generateShortTextAnthropic, generateShortTextOpenAICompatible } from '@/lib/ai-sdk-short-text';
import { execClaude } from '@/lib/claude-cli';
import type { ClaudeSettings, ProviderId, TitleGenerationChainEntry, TitleGenerationSettings } from '@/types';
import { DEFAULT_TITLE_GENERATION } from '@/types';

// ── 配置 ──

const TITLE_TURNS = new Set([2, 5, 10, 15]);
const ENTRY_TIMEOUT_MS = 8_000;
const CLI_TIMEOUT_MS = 15_000;
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
 * 测试单个重试链条目是否可用。
 * @returns ok/error/latencyMs
 */
export async function testTitleChainEntry(
  entry: TitleGenerationChainEntry,
): Promise<{ ok: boolean; error?: string; latencyMs: number }> {
  const settings = await getSettings();
  const t0 = Date.now();
  try {
    const result = await Promise.race([
      callProviderApi(entry, '请回复「ok」', settings.claude),
      new Promise<null>((res) => setTimeout(() => res(null), 10_000)),
    ]);
    const latencyMs = Date.now() - t0;
    if (result !== null) return { ok: true, latencyMs };

    const hasKey = !!getProviderScopedApiKey(
      settings.claude as Parameters<typeof getProviderScopedApiKey>[0],
      entry.provider,
    );
    return {
      ok: false,
      error: hasKey ? '请求超时或模型无响应' : '请先在设置 → 模型与供应商中填写该线路的 API Key',
      latencyMs,
    };
  } catch (err) {
    const latencyMs = Date.now() - t0;
    return { ok: false, error: err instanceof Error ? err.message : String(err), latencyMs };
  }
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

  // 直接 API 全部失败（如 OAuth/Max 套餐无 API Key），fallback 到 Claude CLI
  return generateTitleViaCli(prompt);
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
  claude: ClaudeSettings,
): Promise<string | null> {
  const apiKey = getProviderScopedApiKey(claude, entry.provider);
  if (!apiKey) return null;

  const preset = getProviderPreset(entry.provider, claude.customProviders);

  if (entry.provider === 'anthropic') {
    return generateShortTextAnthropic({
      apiKey,
      model: entry.model,
      prompt,
      maxOutputTokens: 50,
      baseUrlOverride: claude.baseUrl,
    });
  }

  // OpenAI-compatible API（openai, deepseek, qwen, zhipu, minimax, kimi, openrouter, ollama, custom）
  // 使用 getProviderScopedBaseUrl 正确获取 baseUrl（支持 providerBaseUrls 中保存的探测后 URL）
  const baseUrl = getProviderScopedBaseUrl(claude, preset, entry.provider, entry.model);

  if (!baseUrl) return null;
  return generateShortTextOpenAICompatible({
    apiKey,
    baseUrl,
    model: entry.model,
    prompt,
    maxOutputTokens: 50,
  });
}

function timeout(ms: number): Promise<null> {
  return new Promise(resolve => setTimeout(() => resolve(null), ms));
}

/**
 * 通过 Claude CLI 生成标题（OAuth/Max 套餐无 API Key 时的 fallback）。
 * 使用 `claude -p` 一次性调用，继承用户现有的鉴权方式（API Key 或 OAuth）。
 */
async function generateTitleViaCli(prompt: string): Promise<string | null> {
  try {
    const env = await buildClaudeEnv();
    const result = await Promise.race([
      execClaude(['-p', prompt, '--output-format', 'text'], { env }),
      timeout(CLI_TIMEOUT_MS),
    ]);

    if (!result) return null;
    return cleanTitle(result.stdout.trim()) ?? null;
  } catch {
    return null;
  }
}
