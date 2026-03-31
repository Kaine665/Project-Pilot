/**
 * 通过 Vercel AI SDK（ai + @ai-sdk/*）发起极短文本补全。
 * 由官方 provider 包维护协议细节，减少手写 fetch 与端点变更成本。
 */

import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { generateText } from 'ai';

function normalizeAnthropicBaseUrl(override?: string): string | undefined {
  if (!override?.trim()) return undefined;
  const s = override.replace(/\/+$/, '');
  if (/\/v1$/i.test(s)) return s;
  return `${s}/v1`;
}

function normalizeOpenAiCompatibleBaseUrl(baseUrl: string): string {
  const s = baseUrl.replace(/\/+$/, '').replace(/\/v1$/i, '');
  return `${s}/v1`;
}

/** Anthropic Messages API（官方或兼容端点由 baseURL 决定） */
export async function generateShortTextAnthropic(params: {
  apiKey: string;
  model: string;
  prompt: string;
  maxOutputTokens?: number;
  baseUrlOverride?: string;
}): Promise<string | null> {
  const baseURL = normalizeAnthropicBaseUrl(params.baseUrlOverride);
  const provider = createAnthropic({
    apiKey: params.apiKey,
    ...(baseURL ? { baseURL } : {}),
  });
  try {
    const { text } = await generateText({
      model: provider(params.model),
      prompt: params.prompt,
      maxOutputTokens: params.maxOutputTokens ?? 50,
    });
    const t = text?.trim();
    return t || null;
  } catch {
    return null;
  }
}

/** OpenAI Chat Completions 或任意 OpenAI-compatible 网关（含自建 / 第三方） */
export async function generateShortTextOpenAICompatible(params: {
  apiKey: string;
  baseUrl: string;
  model: string;
  prompt: string;
  maxOutputTokens?: number;
}): Promise<string | null> {
  const baseURL = normalizeOpenAiCompatibleBaseUrl(params.baseUrl);
  const openai = createOpenAI({
    apiKey: params.apiKey,
    baseURL,
  });
  try {
    const { text } = await generateText({
      model: openai.chat(params.model),
      prompt: params.prompt,
      maxOutputTokens: params.maxOutputTokens ?? 50,
    });
    const t = text?.trim();
    return t || null;
  } catch {
    return null;
  }
}
