/**
 * session-title-generator — 异步廉价 AI 生成会话标题。
 *
 * 在第 2/5/10/15 轮对话完成后自动触发。
 * 按用户配置的 chain（重试链）依次尝试不同 provider+model，
 * 一个失败就试下一个，直到成功或全部失败。
 *
 * 所有 API 调用都使用**流式 + 活跃超时**策略：
 * - 发送 stream: true 请求
 * - 只要有数据到达就重置 30s 计时器
 * - 30s 无新数据才判定超时
 * - 这比固定超时更宽容也更准确
 */

import { getSettings, getProviderScopedApiKey, getProviderScopedBaseUrl, buildClaudeEnv } from '@/lib/settings-manager';
import { getProviderPreset } from '@/lib/provider-registry';
import { spawnClaude } from '@/lib/claude-cli';
import { StreamParser, LineBuffer } from '@/lib/claude-stream-parser';
import type { ClaudeSettings, ProviderId, TitleGenerationChainEntry, TitleGenerationSettings } from '@/types';
import { DEFAULT_TITLE_GENERATION } from '@/types';

// ── 配置 ──

const LOG = '[TitleGen]';
const TITLE_TURNS = new Set([2, 5, 10, 15]);
const INACTIVITY_TIMEOUT_MS = 30_000; // 30s 无新数据 → 超时
const CLI_CHEAP_MODEL = 'claude-haiku-4-5-20251001';
const MAX_MSG_CHARS = 200;
const MAX_MSGS = 6;

/**
 * 判断某个 provider 是否使用 Anthropic 协议（/v1/messages）。
 * - 内置的 'anthropic' 和 'kimi'（api.kimi.com/coding/）走 Anthropic 协议
 * - 自定义 provider 可通过 apiProtocol 字段声明
 * - 其他一律走 OpenAI-compatible 协议（/v1/chat/completions）
 */
function isAnthropicProtocol(
  provider: ProviderId,
  preset: { apiProtocol?: 'anthropic' | 'openai' },
): boolean {
  if (provider === 'anthropic') return true;
  if (provider === 'kimi') return true;
  if (preset.apiProtocol === 'anthropic') return true;
  return false;
}

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
    const result = await callProviderApi(entry, '请回复「ok」', settings.claude);
    const latencyMs = Date.now() - t0;
    if (result !== null) return { ok: true, latencyMs };

    const hasKey = !!getProviderScopedApiKey(
      settings.claude as Parameters<typeof getProviderScopedApiKey>[0],
      entry.provider,
    );
    return {
      ok: false,
      error: hasKey ? '请求超时或模型无响应' : '请先在 AI 配置中填写该供应商的 API Key',
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
    const label = `chain[${i}] ${entry.provider}/${entry.model}`;
    try {
      console.log(`${LOG} Trying ${label}...`);
      const result = await callProviderApi(entry, prompt, settings.claude);

      if (result) {
        const cleaned = cleanTitle(result);
        if (cleaned) {
          console.log(`${LOG} ${label} → success: "${cleaned}"`);
          return cleaned;
        }
        console.warn(`${LOG} ${label} → returned text but cleanTitle rejected: "${result}"`);
      } else {
        console.warn(`${LOG} ${label} → returned null (no API key, timeout, or empty response)`);
      }
    } catch (err) {
      console.warn(`${LOG} ${label} → error:`, err instanceof Error ? err.message : err);
    }
  }

  // 直接 API 全部失败 → fallback 到 Claude CLI（流式 + 活跃超时）
  console.log(`${LOG} All chain entries failed, falling back to CLI (model: ${CLI_CHEAP_MODEL})...`);
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

// ── 流式 SSE 读取 + 活跃超时 ──

/**
 * 从 SSE 流中读取文本，30s 无新数据就超时。
 * @param res - fetch Response（必须是 stream 模式）
 * @param extractText - 从 SSE data JSON 中提取文本的函数
 * @returns 累积的完整文本，或超时/错误时 null
 */
async function readStreamWithActivityTimeout(
  res: Response,
  extractText: (eventData: string) => string | null,
): Promise<string | null> {
  const body = res.body;
  if (!body) return null;

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let fullText = '';
  let sseBuffer = '';

  return new Promise<string | null>((resolve) => {
    let settled = false;
    const done = (result: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reader.cancel().catch(() => {});
      resolve(result);
    };

    // 活跃超时：30s 无新数据就放弃
    let timer = setTimeout(() => {
      console.warn(`${LOG} Stream inactivity timeout (${INACTIVITY_TIMEOUT_MS}ms)`);
      done(fullText.trim() || null);
    }, INACTIVITY_TIMEOUT_MS);

    const resetTimer = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        console.warn(`${LOG} Stream inactivity timeout (${INACTIVITY_TIMEOUT_MS}ms)`);
        done(fullText.trim() || null);
      }, INACTIVITY_TIMEOUT_MS);
    };

    const processChunk = ({ done: streamDone, value }: ReadableStreamReadResult<Uint8Array>) => {
      if (settled) return;

      if (streamDone) {
        // 流正常结束
        done(fullText.trim() || null);
        return;
      }

      resetTimer();
      sseBuffer += decoder.decode(value, { stream: true });

      // 解析 SSE 事件（按 \n\n 分隔）
      const parts = sseBuffer.split('\n\n');
      sseBuffer = parts.pop() ?? ''; // 最后一段可能不完整，留着

      for (const part of parts) {
        for (const line of part.split('\n')) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') {
              done(fullText.trim() || null);
              return;
            }
            try {
              const text = extractText(data);
              if (text) fullText += text;
            } catch {
              // 忽略解析错误，继续读
            }
          }
        }
      }

      reader.read().then(processChunk).catch(() => done(fullText.trim() || null));
    };

    reader.read().then(processChunk).catch(() => done(null));
  });
}

/** 从 Anthropic SSE data 中提取文本 */
function extractAnthropicText(data: string): string | null {
  const obj = JSON.parse(data);
  if (obj.type === 'content_block_delta' && obj.delta?.type === 'text_delta') {
    return obj.delta.text ?? null;
  }
  return null;
}

/** 从 OpenAI SSE data 中提取文本 */
function extractOpenAiText(data: string): string | null {
  const obj = JSON.parse(data);
  return obj.choices?.[0]?.delta?.content ?? null;
}

// ── Provider API 调用（流式） ──

/**
 * 调用指定 provider 的 API 生成标题。
 * 根据 provider 协议自动选择 Anthropic（/v1/messages）或 OpenAI-compatible（/v1/chat/completions）。
 * 所有调用都使用流式 + 活跃超时，不设固定超时。
 */
async function callProviderApi(
  entry: TitleGenerationChainEntry,
  prompt: string,
  claude: ClaudeSettings,
): Promise<string | null> {
  const apiKey = getProviderScopedApiKey(claude, entry.provider);
  if (!apiKey) {
    console.warn(`${LOG} No API key for provider "${entry.provider}", skipping`);
    return null;
  }

  const preset = getProviderPreset(entry.provider, claude.customProviders);

  if (isAnthropicProtocol(entry.provider, preset)) {
    const baseUrl = entry.provider === 'anthropic'
      ? (claude.baseUrl || 'https://api.anthropic.com')
      : getProviderScopedBaseUrl(claude, preset, entry.provider) || 'https://api.anthropic.com';
    return callAnthropicStreamApi(apiKey, entry.model, prompt, baseUrl);
  }

  const baseUrl = getProviderScopedBaseUrl(claude, preset, entry.provider);
  if (!baseUrl) {
    console.warn(`${LOG} No base URL for provider "${entry.provider}", skipping`);
    return null;
  }
  return callOpenAiStreamApi(apiKey, entry.model, prompt, baseUrl);
}

/**
 * Anthropic Messages API — 流式请求。
 */
async function callAnthropicStreamApi(
  apiKey: string,
  model: string,
  prompt: string,
  baseUrl: string,
): Promise<string | null> {
  const cleanBase = baseUrl.replace(/\/+$/, '');
  const url = `${cleanBase}/v1/messages`;
  console.log(`${LOG} Streaming Anthropic API: ${url} (model: ${model})`);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 50,
      stream: true,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.warn(`${LOG} Anthropic API ${res.status}: ${body.slice(0, 200)}`);
    return null;
  }

  return readStreamWithActivityTimeout(res, extractAnthropicText);
}

/**
 * OpenAI-compatible API — 流式请求。
 */
async function callOpenAiStreamApi(
  apiKey: string,
  model: string,
  prompt: string,
  baseUrl: string,
): Promise<string | null> {
  const cleanBase = baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '');
  const url = `${cleanBase}/v1/chat/completions`;
  console.log(`${LOG} Streaming OpenAI API: ${url} (model: ${model})`);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: 50,
      stream: true,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.warn(`${LOG} OpenAI API ${res.status}: ${body.slice(0, 200)}`);
    return null;
  }

  return readStreamWithActivityTimeout(res, extractOpenAiText);
}

// ── CLI Fallback（流式 + 活跃超时） ──

/**
 * 通过 Claude CLI 生成标题（OAuth/Max 套餐无 API Key 时的 fallback）。
 * 使用 spawnClaude 流式读取，强制指定 Haiku 模型。
 * 30s 无新输出即超时。
 */
async function generateTitleViaCli(prompt: string): Promise<string | null> {
  return new Promise(async (resolve) => {
    let env: NodeJS.ProcessEnv;
    try {
      env = await buildClaudeEnv();
    } catch (err) {
      console.error(`${LOG} CLI: failed to build env:`, err instanceof Error ? err.message : err);
      return resolve(null);
    }

    console.log(`${LOG} CLI: spawning claude --model ${CLI_CHEAP_MODEL} (inactivity timeout: ${INACTIVITY_TIMEOUT_MS}ms)`);

    let settled = false;
    let fullText = '';
    const streamParser = new StreamParser();
    const lineBuffer = new LineBuffer();

    const done = (result: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    let timer = setTimeout(() => {
      console.warn(`${LOG} CLI: inactivity timeout (${INACTIVITY_TIMEOUT_MS}ms)`);
      claude.kill();
      done(fullText.trim() ? cleanTitle(fullText.trim()) : null);
    }, INACTIVITY_TIMEOUT_MS);

    const resetTimer = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        console.warn(`${LOG} CLI: inactivity timeout (${INACTIVITY_TIMEOUT_MS}ms)`);
        claude.kill();
        done(fullText.trim() ? cleanTitle(fullText.trim()) : null);
      }, INACTIVITY_TIMEOUT_MS);
    };

    const claude = spawnClaude([
      '-p', prompt,
      '--verbose',
      '--output-format', 'stream-json',
      '--model', CLI_CHEAP_MODEL,
    ], {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    claude.stdin?.end();

    claude.stdout?.on('data', (chunk: Buffer) => {
      resetTimer();
      const lines = lineBuffer.feed(chunk.toString('utf-8'));
      for (const line of lines) {
        for (const event of streamParser.parse(line)) {
          if (event.type === 'text_delta') {
            fullText += event.text;
          }
        }
      }
    });

    claude.stderr?.on('data', () => resetTimer()); // stderr 活动也算活跃

    claude.on('close', (code) => {
      // Flush remaining
      const remaining = lineBuffer.flush();
      if (remaining) {
        for (const event of streamParser.parse(remaining)) {
          if (event.type === 'text_delta') {
            fullText += event.text;
          }
        }
      }
      const text = fullText.trim();
      const cleaned = text ? cleanTitle(text) : null;
      if (code === 0 && cleaned) {
        console.log(`${LOG} CLI → success: "${cleaned}"`);
      } else {
        console.warn(`${LOG} CLI → code=${code}, text=${text ? `"${text}"` : 'empty'}`);
      }
      done(code === 0 ? cleaned : null);
    });

    claude.on('error', (err) => {
      console.error(`${LOG} CLI spawn error:`, err.message);
      done(null);
    });
  });
}
