/**
 * Distiller v0 — 构建 prompt、调用轻量模型、解析 JSON。
 */

import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { generateText } from 'ai';
import type { AppSettings, ProviderId, TitleGenerationChainEntry } from '@/types';
import { DEFAULT_TITLE_GENERATION } from '@/types';
import { getProviderPreset } from '@/lib/provider-registry';
import {
  getProviderScopedApiKey,
  getProviderScopedBaseUrl,
  getProviderScopedModel,
} from '@/lib/settings-manager';
import { parseJsonSafe } from '@/lib/file-store';
import type { DistillerInput, DistillerOutput, ExtractedKnowledge, ExtractedTodo, KnowledgeKind } from './types';

const MAX_MESSAGES = 20;
const MAX_CONTENT_CHARS = 1000;
const MAX_GENERATION_TOKENS = 2000;
const DISTILLER_TIMEOUT_MS = 30_000;

const LOG_PREFIX = '[Distiller]';

const KNOWLEDGE_KINDS = new Set<KnowledgeKind>([
  'fact',
  'decision',
  'rule',
  'lesson',
  'memo',
]);

function normalizeAnthropicBaseUrl(override?: string): string | undefined {
  if (!override?.trim()) return undefined;
  const s = override.replace(/\/+$/, '');
  if (/\/v1$/i.test(s)) return s;
  return `${s}/v1`;
}

function normalizeOpenAiCompatibleBaseUrl(baseUrl: string): string {
  const s = baseUrl.replace(/\/+$/, '');
  if (/\/v\d+$/i.test(s)) return s;
  return `${s.replace(/\/v1$/i, '')}/v1`;
}

/** 截断消息供 prompt（控制 token） */
export function trimMessagesForDistiller(
  messages: DistillerInput['messages'],
  maxMessages = MAX_MESSAGES,
  maxContentChars = MAX_CONTENT_CHARS,
): DistillerInput['messages'] {
  const slice = messages.slice(-maxMessages);
  return slice.map((m) => ({
    role: m.role,
    content:
      m.content.length > maxContentChars
        ? `${m.content.slice(0, maxContentChars)}…`
        : m.content,
  }));
}

export function buildDistillerPrompt(dialogText: string): string {
  return `你是一个项目知识提炼助手。阅读以下对话，提取两类内容：

1. **知识条目**：对话中出现的事实、决策、规则、经验教训、备忘。
   - 只提取有长期价值的（下次对话还会有用的）
   - 不提取一次性的操作细节
   - 每条给出 type: fact | decision | rule | lesson | memo

2. **待办事项**：对话中明确提到的「接下来要做」的事。
   - 只提取明确的行动项，不提取模糊的想法
   - 如果对话中已经完成了某件事，不要再提取为待办

输出严格的 JSON（不要 markdown 代码块）：
{"knowledge":[{"title":"...","content":"...","type":"..."}],"todos":[{"title":"...","description":"...","priority":"medium"}]}

如果没有值得提取的内容，输出 {"knowledge":[],"todos":[]}

对话内容：
---
${dialogText}
---`;
}

function stripMarkdownFence(raw: string): string {
  const t = raw.trim();
  const m = t.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  if (m?.[1]) return m[1].trim();
  return t;
}

function extractJsonObjectSubstring(raw: string): string | null {
  const t = raw.trim();
  const start = t.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < t.length; i++) {
    const c = t[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === '{') depth++;
    if (c === '}') {
      depth--;
      if (depth === 0) return t.slice(start, i + 1);
    }
  }
  return null;
}

function isKnowledgeKind(s: unknown): s is KnowledgeKind {
  return typeof s === 'string' && KNOWLEDGE_KINDS.has(s as KnowledgeKind);
}

function isPriority(s: unknown): s is 'high' | 'medium' | 'low' {
  return s === 'high' || s === 'medium' || s === 'low';
}

/** 解析模型输出为结构化结果；失败返回空 */
export function parseDistillerJson(raw: string): DistillerOutput {
  const empty: DistillerOutput = { knowledge: [], todos: [] };
  if (!raw?.trim()) return empty;

  const stripped = stripMarkdownFence(raw);
  let parsed: unknown;
  try {
    parsed = parseJsonSafe<unknown>(stripped);
  } catch {
    try {
      const sub = extractJsonObjectSubstring(stripped);
      if (sub) parsed = parseJsonSafe<unknown>(sub);
      else return empty;
    } catch {
      return empty;
    }
  }

  if (!parsed || typeof parsed !== 'object') return empty;
  const o = parsed as Record<string, unknown>;
  const knowledge: ExtractedKnowledge[] = [];
  const todos: ExtractedTodo[] = [];

  if (Array.isArray(o.knowledge)) {
    for (const item of o.knowledge) {
      if (!item || typeof item !== 'object') continue;
      const k = item as Record<string, unknown>;
      const title = typeof k.title === 'string' ? k.title.trim() : '';
      const content = typeof k.content === 'string' ? k.content.trim() : '';
      const type = k.type;
      if (!title || !content || !isKnowledgeKind(type)) continue;
      knowledge.push({ title, content, type });
    }
  }

  if (Array.isArray(o.todos)) {
    for (const item of o.todos) {
      if (!item || typeof item !== 'object') continue;
      const t = item as Record<string, unknown>;
      const title = typeof t.title === 'string' ? t.title.trim() : '';
      if (!title) continue;
      const description =
        typeof t.description === 'string' ? t.description.trim() : undefined;
      const priority = isPriority(t.priority) ? t.priority : undefined;
      todos.push({ title, description, priority });
    }
  }

  return { knowledge, todos };
}

/**
 * 候选线路顺序：
 * 1. 显式 distiller 配置
 * 2. 当前会话的 provider/model（调用方传入）
 * 3. 标题生成链
 * 4. 当前主界面供应商
 * 5. 所有已配置 API key 的供应商（兜底）
 */
function buildDistillerModelCandidates(settings: AppSettings): TitleGenerationChainEntry[] {
  const out: TitleGenerationChainEntry[] = [];
  const push = (provider: ProviderId, model: string) => {
    const m = model.trim();
    if (!m) return;
    if (!out.some((e) => e.provider === provider && e.model === m)) {
      out.push({ provider, model: m });
    }
  };

  const d = settings.distiller;
  const claude = settings.claude;
  if (d?.provider && d?.model?.trim()) {
    push(d.provider, d.model);
  } else if (d?.model?.trim()) {
    push((d.provider ?? claude.provider ?? 'anthropic') as ProviderId, d.model);
  } else if (d?.provider) {
    push(d.provider, getProviderScopedModel(claude, d.provider));
  }

  const chain =
    settings.titleGeneration?.chain?.length &&
    settings.titleGeneration.chain.length > 0
      ? settings.titleGeneration.chain
      : DEFAULT_TITLE_GENERATION.chain!;
  for (const e of chain) {
    push(e.provider, e.model);
  }

  const primary = (claude.provider ?? 'anthropic') as ProviderId;
  push(primary, getProviderScopedModel(claude, primary));

  const allKeys = claude.providerApiKeys ?? {};
  for (const pid of Object.keys(allKeys)) {
    const key = allKeys[pid]?.trim();
    if (key) {
      push(pid as ProviderId, getProviderScopedModel(claude, pid as ProviderId));
    }
  }

  return out;
}

async function generateDistillerTextOneProvider(
  settings: AppSettings,
  provider: ProviderId,
  model: string,
  prompt: string,
): Promise<{ text: string | null; error?: string }> {
  const claude = settings.claude;
  const apiKey = getProviderScopedApiKey(claude, provider);
  if (!apiKey) return { text: null, error: 'no API key' };

  const preset = getProviderPreset(provider, claude.customProviders);

  const run = async (): Promise<string | null> => {
    if (provider === 'anthropic') {
      const baseURL = normalizeAnthropicBaseUrl(claude.baseUrl);
      const anthropic = createAnthropic({
        apiKey,
        ...(baseURL ? { baseURL } : {}),
      });
      const resolvedModel = model || getProviderScopedModel(claude, 'anthropic');
      const { text } = await generateText({
        model: anthropic(resolvedModel),
        prompt,
        maxTokens: MAX_GENERATION_TOKENS,
        temperature: 0,
      });
      const t = text?.trim();
      return t || null;
    }

    const baseUrl = getProviderScopedBaseUrl(claude, preset, provider, model, 'openai');
    if (!baseUrl) return null;
    const baseURL = normalizeOpenAiCompatibleBaseUrl(baseUrl);
    const openai = createOpenAI({ apiKey, baseURL });
    const resolvedModel = model || getProviderScopedModel(claude, provider);
    const { text } = await generateText({
      model: openai.chat(resolvedModel),
      prompt,
      maxTokens: MAX_GENERATION_TOKENS,
      temperature: 1,
    });
    const t = text?.trim();
    return t || null;
  };

  try {
    const text = await Promise.race([
      run(),
      new Promise<null>((res) => setTimeout(() => res(null), DISTILLER_TIMEOUT_MS)),
    ]);
    return { text };
  } catch (e) {
    const errMsg = (e as Error).message || String(e);
    console.warn(`${LOG_PREFIX} ${provider}/${model}:`, e);
    return { text: null, error: errMsg };
  }
}

async function callDistillerModel(
  settings: AppSettings,
  prompt: string,
  sessionProvider?: ProviderId,
  sessionModel?: string,
): Promise<{ text: string | null; diagnostic: DistillerDiagnostic }> {
  const candidates = buildDistillerModelCandidates(settings);
  // If sessionProvider+model are known (from the active session), prepend as highest priority
  if (sessionProvider && sessionModel?.trim()) {
    const already = candidates.some(
      (c) => c.provider === sessionProvider && c.model === sessionModel,
    );
    if (!already) {
      candidates.unshift({ provider: sessionProvider, model: sessionModel });
    }
  }
  const diagnostic: DistillerDiagnostic = { triedModels: [], errors: [] };
  let tried = 0;
  for (const { provider, model } of candidates) {
    const label = `${provider}/${model}`;
    const result = await generateDistillerTextOneProvider(settings, provider, model, prompt);
    if (result.error === 'no API key') {
      diagnostic.errors.push(`${label}: no API key`);
      continue;
    }
    tried++;
    diagnostic.triedModels.push(label);
    if (result.text) return { text: result.text, diagnostic };
    diagnostic.errors.push(`${label}: ${result.error || 'returned empty or timed out'}`);
  }
  if (tried === 0) {
    const msg = 'no API key for any Distiller candidate (configure keys or titleGeneration.chain)';
    console.warn(`${LOG_PREFIX} ${msg}`);
    diagnostic.errors.push(msg);
  } else {
    const msg = `all ${tried} Distiller model attempt(s) returned empty or timed out`;
    console.warn(`${LOG_PREFIX} ${msg}`);
  }
  return { text: null, diagnostic };
}

function formatDialog(messages: DistillerInput['messages']): string {
  return messages
    .map((m) => {
      const label = m.role === 'user' ? '用户' : '助手';
      return `${label}: ${m.content}`;
    })
    .join('\n\n');
}

export interface DistillerDiagnostic {
  triedModels: string[];
  errors: string[];
}

export interface DistillerResult {
  output: DistillerOutput;
  diagnostic: DistillerDiagnostic;
}

/** 从会话消息提炼结构化输出（含模型调用） */
export async function extractDistillerOutput(
  settings: AppSettings,
  input: DistillerInput,
  opts?: { sessionProvider?: ProviderId; sessionModel?: string },
): Promise<DistillerResult> {
  const empty: DistillerResult = {
    output: { knowledge: [], todos: [] },
    diagnostic: { triedModels: [], errors: [] },
  };
  const trimmed = trimMessagesForDistiller(input.messages);
  if (trimmed.length === 0) return empty;

  const prompt = buildDistillerPrompt(formatDialog(trimmed));
  const result = await callDistillerModel(settings, prompt, opts?.sessionProvider, opts?.sessionModel);
  if (!result.text) {
    console.warn(`${LOG_PREFIX} extract: no model text (keys/timeout/parse upstream)`);
    return { output: { knowledge: [], todos: [] }, diagnostic: result.diagnostic };
  }
  const parsed = parseDistillerJson(result.text);
  if (parsed.knowledge.length === 0 && parsed.todos.length === 0 && result.text.length > 80) {
    console.warn(
      `${LOG_PREFIX} extract: JSON parsed but 0 items; preview=${JSON.stringify(result.text.slice(0, 500))}`,
    );
  }
  return { output: parsed, diagnostic: result.diagnostic };
}
