/**
 * 设置页「模型」聚合列表：按供应商用真实 API 拉取模型 ID（非 registry 静态表）。
 *
 * - OpenAI + API Key：GET https://api.openai.com/v1/models
 * - OpenAI + Codex OAuth：Codex RPC model/list（无 registry 兜底）
 * - Anthropic 兼容（含 DeepSeek / Kimi / Qwen 等）：GET …/v1/models，支持分页
 * - OpenRouter 等 OpenAI 兼容：GET …/v1/models
 * - Ollama：GET …/api/tags
 */

import { fetchOpenAiCodexModelsLiveOnly } from '@/lib/codex-model-catalog';
import { PROVIDER_REGISTRY, getKimiCandidateBaseUrls, getProviderPreset, type ProviderPreset } from '@/lib/provider-registry';
import { getCredential, getEffectiveAuthMode, getSettings } from '@/lib/settings-manager';
import type { ClaudeSettings, CustomProviderConfig, ProviderId } from '@/types';

const LIST_TIMEOUT_MS = 18_000;

/** registry 中未写 baseUrl 时使用（Anthropic 直连官方 API） */
const ANTHROPIC_DEFAULT_API_BASE = 'https://api.anthropic.com';

export interface AggregateLiveModelItem {
  providerId: ProviderId;
  value: string;
  label: string;
}

/** 供应商可用性（模型页只展示 status=ok 的模型；原因用 reasonKey 走 i18n） */
export type SupplierAvailabilityStatus = 'skipped' | 'ok' | 'error';

export interface SupplierAvailabilityRow {
  providerId: ProviderId;
  status: SupplierAvailabilityStatus;
  /** settings.supplierAvailabilityReasons.<key>；skipped 时可为 no_credential / not_applicable / ollama_not_enabled */
  reasonKey?: string;
}

export interface AggregateLiveModelsResult {
  ok: boolean;
  items: AggregateLiveModelItem[];
  /** 已废弃：请用 supplierAvailability；恒为空对象 */
  errors: Partial<Record<ProviderId, string>>;
  /** 与内置注册表 + 自定义供应商一一对应 */
  supplierAvailability: SupplierAvailabilityRow[];
  fetchedAt: string;
  /** 整体失败（如读设置异常）时供前端展示 */
  fatalError?: string;
}

/** 将技术性/中英文摘要映射为前端 i18n key */
export function classifySupplierReasonKey(provider: ProviderId, raw: string): string {
  const l = raw.toLowerCase();
  if (
    provider === 'kimi' ||
    raw.includes('Kimi') ||
    raw.includes('月之暗面')
  ) {
    if (/402|membership|benefits|会员|权益/i.test(raw)) return 'kimi_membership';
  }
  if (provider === 'ollama' || /ollama/i.test(raw)) {
    if (
      /无法连接|unable to connect|econnrefused|fetch failed|networkerror|etimedout|enotfound/i.test(
        raw,
      )
    ) {
      return 'ollama_unreachable';
    }
  }
  if (/\b401\b/.test(raw) || /\b403\b/.test(raw) || l.includes('unauthorized') || l.includes('forbidden')) {
    return 'auth_failed';
  }
  if (/\b429\b/.test(raw) || l.includes('rate limit')) return 'rate_limited';
  if (l.includes('timeout') || l.includes('timed out') || l.includes('etimedout')) return 'timeout';
  if (raw.includes('No base URL')) return 'no_base_url';
  return 'generic';
}

function buildSupplierAvailabilityRows(
  settled: Array<{ pid: ProviderId; part: AggregateLiveModelItem[]; error?: string }>,
  claude: import('@/types').ClaudeSettings,
): SupplierAvailabilityRow[] {
  return settled.map(({ pid, part, error }) => {
    if (pid === 'ollama' && !claude.providerBaseUrls?.ollama?.trim()) {
      return { providerId: pid, status: 'skipped' as const, reasonKey: 'ollama_not_enabled' };
    }
    if (part.length > 0) {
      return { providerId: pid, status: 'ok' as const };
    }
    if (error) {
      return {
        providerId: pid,
        status: 'error' as const,
        reasonKey: classifySupplierReasonKey(pid, error),
      };
    }
    if (pid === 'ollama') {
      return { providerId: pid, status: 'ok' as const };
    }
    if (pid === 'custom') {
      return { providerId: pid, status: 'skipped' as const, reasonKey: 'not_applicable' };
    }
    if (!hasUsableCredential(claude, pid)) {
      return { providerId: pid, status: 'skipped' as const, reasonKey: 'no_credential' };
    }
    return { providerId: pid, status: 'ok' as const };
  });
}

/** OpenAI 兼容列表 URL（默认 …/v1/models；DeepSeek 官方为 …/models） */
function buildOpenAiCompatibleModelsListUrl(baseRoot: string, relativePath = 'v1/models'): string {
  const s = baseRoot.replace(/\/+$/, '').replace(/\/v1$/i, '');
  const p = relativePath.replace(/^\/+/, '');
  return `${s}/${p}`;
}

function anthropicCompatibleModelsUrl(baseRoot: string): string {
  const s = baseRoot.replace(/\/+$/, '');
  return /\/v1$/i.test(s) ? `${s}/models` : `${s}/v1/models`;
}

function parseOpenAiCompatibleModels(json: unknown): { id: string; label: string }[] {
  if (!json || typeof json !== 'object') return [];
  const data = (json as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  const out: { id: string; label: string }[] = [];
  for (const row of data) {
    if (!row || typeof row !== 'object') continue;
    const rec = row as Record<string, unknown>;
    const id = typeof rec.id === 'string' ? rec.id.trim() : '';
    if (!id) continue;
    const name = typeof rec.name === 'string' ? rec.name.trim() : '';
    out.push({ id, label: name || id });
  }
  return out;
}

function parseAnthropicCompatibleModels(json: unknown): { id: string; label: string }[] {
  if (!json || typeof json !== 'object') return [];
  const data = (json as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  const out: { id: string; label: string }[] = [];
  for (const row of data) {
    if (!row || typeof row !== 'object') continue;
    const rec = row as Record<string, unknown>;
    const id = typeof rec.id === 'string' ? rec.id.trim() : '';
    if (!id) continue;
    const displayName =
      typeof rec.display_name === 'string'
        ? rec.display_name.trim()
        : typeof rec.displayName === 'string'
          ? (rec.displayName as string).trim()
          : '';
    out.push({ id, label: displayName || id });
  }
  return out;
}

/** 过滤 OpenAI /v1/models 中非对话类条目 */
function isLikelyChatModelOpenAI(id: string): boolean {
  const x = id.toLowerCase();
  if (x.includes('embedding')) return false;
  if (x.includes('whisper')) return false;
  if (x.includes('tts')) return false;
  if (x.includes('dall-e') || x.includes('dalle')) return false;
  if (x.includes('moderation')) return false;
  if (x.endsWith('-embedding')) return false;
  return true;
}

function resolveAuthMethod(preset: ProviderPreset, provider: ProviderId): 'API_KEY' | 'AUTH_TOKEN' {
  if (preset.authMethod) return preset.authMethod;
  if (preset.useApiKeyForAuth) return 'API_KEY';
  if (provider === 'anthropic') return 'API_KEY';
  if (provider === 'kimi') return 'API_KEY';
  return 'AUTH_TOKEN';
}

function resolveBaseUrl(
  preset: ProviderPreset,
  provider: ProviderId,
  providerBaseUrls: Partial<Record<ProviderId, string>> | undefined,
  providerModels: Partial<Record<ProviderId, string>> | undefined,
): string | undefined {
  if (provider === 'kimi') {
    const preferred = providerBaseUrls?.[provider] || preset.baseUrl;
    const selectedModel = providerModels?.[provider] || preset.models[0]?.id || 'kimi-for-coding';
    const candidates = getKimiCandidateBaseUrls(selectedModel, preferred);
    return candidates[0];
  }
  return providerBaseUrls?.[provider] || preset.baseUrl;
}

async function fetchOpenAiRestModels(apiKey: string): Promise<{ items: { id: string; label: string }[]; error?: string }> {
  const url = 'https://api.openai.com/v1/models';
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(LIST_TIMEOUT_MS),
    });
    const text = await res.text().catch(() => '');
    if (!res.ok) {
      return { items: [], error: `HTTP ${res.status}: ${text.slice(0, 160)}` };
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return { items: [], error: 'Invalid JSON from OpenAI' };
    }
    const items = parseOpenAiCompatibleModels(json).filter((m) => isLikelyChatModelOpenAI(m.id));
    return { items };
  } catch (e) {
    return { items: [], error: e instanceof Error ? e.message : String(e) };
  }
}

async function fetchOpenAiCompatibleAtBase(
  baseRoot: string,
  apiKey: string,
  modelsListRelativePath?: string,
): Promise<{ items: { id: string; label: string }[]; error?: string }> {
  const url = buildOpenAiCompatibleModelsListUrl(baseRoot, modelsListRelativePath ?? 'v1/models');
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${apiKey}`,
        accept: 'application/json',
      },
      signal: AbortSignal.timeout(LIST_TIMEOUT_MS),
    });
    const text = await res.text().catch(() => '');
    if (!res.ok) {
      return { items: [], error: `HTTP ${res.status}: ${text.slice(0, 160)}` };
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return { items: [], error: 'Invalid JSON' };
    }
    return { items: parseOpenAiCompatibleModels(json) };
  } catch (e) {
    return { items: [], error: e instanceof Error ? e.message : String(e) };
  }
}

async function fetchAnthropicCompatibleAllPages(
  baseRoot: string,
  apiKey: string,
  authMethod: 'API_KEY' | 'AUTH_TOKEN',
): Promise<{ items: { id: string; label: string }[]; error?: string }> {
  const all: { id: string; label: string }[] = [];
  const seen = new Set<string>();
  let afterId: string | undefined;
  let firstError: string | undefined;

  for (let page = 0; page < 25; page++) {
    const url = new URL(anthropicCompatibleModelsUrl(baseRoot));
    url.searchParams.set('limit', '100');
    if (afterId) url.searchParams.set('after_id', afterId);

    const headers: Record<string, string> = { 'anthropic-version': '2023-06-01' };
    if (authMethod === 'API_KEY') headers['x-api-key'] = apiKey;
    else headers['authorization'] = `Bearer ${apiKey}`;

    try {
      const res = await fetch(url.toString(), {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(LIST_TIMEOUT_MS),
      });
      const text = await res.text().catch(() => '');
      if (!res.ok) {
        firstError = firstError ?? `HTTP ${res.status}: ${text.slice(0, 160)}`;
        break;
      }
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        firstError = firstError ?? 'Invalid JSON';
        break;
      }
      const batch = parseAnthropicCompatibleModels(json);
      for (const b of batch) {
        if (!seen.has(b.id)) {
          seen.add(b.id);
          all.push(b);
        }
      }
      const obj = json && typeof json === 'object' ? (json as Record<string, unknown>) : {};
      const hasMore = obj.has_more === true;
      const lastId = typeof obj.last_id === 'string' ? obj.last_id : undefined;
      if (!hasMore || !lastId || batch.length === 0) break;
      afterId = lastId;
    } catch (e) {
      firstError = firstError ?? (e instanceof Error ? e.message : String(e));
      break;
    }
  }

  if (all.length === 0 && firstError) return { items: [], error: firstError };
  return { items: all };
}

/**
 * 当 /models 接口不兼容或不稳定时，回退用最小 Messages 请求探测可用性。
 * 成功即说明该供应商聊天通道可用（即便模型列表接口失败）。
 */
async function probeAnthropicMessages(
  baseRoot: string,
  apiKey: string,
  model: string,
  authMethod: 'API_KEY' | 'AUTH_TOKEN',
): Promise<{ ok: boolean; error?: string }> {
  const root = baseRoot.replace(/\/+$/, '');
  const url = /\/v1$/i.test(root) ? `${root}/messages` : `${root}/v1/messages`;
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'anthropic-version': '2023-06-01',
  };
  if (authMethod === 'API_KEY') headers['x-api-key'] = apiKey;
  else headers['authorization'] = `Bearer ${apiKey}`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        max_tokens: 8,
        messages: [{ role: 'user', content: 'ok' }],
      }),
      signal: AbortSignal.timeout(LIST_TIMEOUT_MS),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 160)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 设置页「部分供应商失败」时的可读说明（非程序 bug，多为环境或账号侧） */
function friendlyOllamaModelsError(baseUrl: string, raw: string): string {
  const l = raw.toLowerCase();
  if (
    l.includes('unable to connect') ||
    l.includes('econnrefused') ||
    l.includes('fetch failed') ||
    l.includes('networkerror') ||
    l.includes('etimedout') ||
    l.includes('enotfound')
  ) {
    return `无法连接 Ollama（${baseUrl}）。请在本机启动 Ollama 服务（默认 http://127.0.0.1:11434），或在设置里填写可访问的根地址。`;
  }
  return raw;
}

function friendlyKimiModelsError(raw: string): string {
  if (
    raw.includes('402') ||
    /membership|verify your membership|benefits/i.test(raw)
  ) {
    return 'Kimi（月之暗面）返回 402：当前无法校验会员/权益。请到开放平台确认套餐有效、余额与用量正常，或稍后重试。';
  }
  return raw;
}

async function fetchOllamaTags(baseRoot: string): Promise<{ items: { id: string; label: string }[]; error?: string }> {
  const root = baseRoot.replace(/\/+$/, '');
  const url = `${root}/api/tags`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(LIST_TIMEOUT_MS) });
    const text = await res.text().catch(() => '');
    if (!res.ok) return { items: [], error: `HTTP ${res.status}: ${text.slice(0, 120)}` };
    const json = JSON.parse(text) as { models?: { name?: string }[] };
    const models = Array.isArray(json.models) ? json.models : [];
    const items = models
      .map((m) => {
        const name = typeof m.name === 'string' ? m.name.trim() : '';
        return name ? { id: name, label: name } : null;
      })
      .filter((x): x is { id: string; label: string } => !!x);
    return { items };
  } catch (e) {
    return { items: [], error: e instanceof Error ? e.message : String(e) };
  }
}

function hasUsableCredential(claude: import('@/types').ClaudeSettings, provider: ProviderId): boolean {
  const cred = getCredential(claude, provider);
  if (cred.apiKey?.trim()) return true;
  const authMode = getEffectiveAuthMode(claude, provider);
  if (authMode === 'oauth') return true;
  return false;
}

async function collectBuiltInProvider(
  provider: ProviderId,
  preset: ProviderPreset,
  claude: import('@/types').ClaudeSettings,
): Promise<{ items: AggregateLiveModelItem[]; error?: string }> {
  /**
   * 可用性判定策略（统一口径）：
   * 1) 先测“聊天链路”是否可用（/v1/messages，和实际对话一致）
   * 2) 聊天可用后，再尝试拉模型列表（/models 或 OpenAI models）
   * 3) 若模型列表失败但聊天可用，回退预置模型，不标记为不可用
   *
   * 这样可以避免“能聊但设置页显示不可用”的误判。
   */
  if (provider === 'custom') return { items: [] };

  const cred = getCredential(claude, provider);
  const authMode = getEffectiveAuthMode(claude, provider);
  const apiKey = cred.apiKey?.trim() ?? '';
  const baseUrls = claude.providerBaseUrls;

  if (provider === 'ollama') {
    const base = baseUrls?.ollama?.trim();
    if (!base) {
      return { items: [] };
    }
    const { items, error } = await fetchOllamaTags(base);
    if (items.length === 0 && error) {
      return { items: [], error: friendlyOllamaModelsError(base, error) };
    }
    return { items: items.map((m) => ({ providerId: provider, value: m.id, label: m.label })) };
  }

  if (!hasUsableCredential(claude, provider)) return { items: [] };

  if (provider === 'openai') {
    if (apiKey) {
      const { items, error } = await fetchOpenAiRestModels(apiKey);
      if (items.length === 0) return { items: [], error };
      return { items: items.map((m) => ({ providerId: provider, value: m.id, label: m.label })) };
    }
    if (authMode === 'oauth' && claude.openaiOAuthEnabled) {
      try {
        const rows = await fetchOpenAiCodexModelsLiveOnly();
        return {
          items: rows.map((m) => ({
            providerId: provider,
            value: m.id.trim(),
            label: (m.displayName || m.id).trim(),
          })),
        };
      } catch (e) {
        return { items: [], error: e instanceof Error ? e.message : String(e) };
      }
    }
    return { items: [] };
  }

  if (provider === 'openrouter') {
    if (!apiKey) return { items: [] };
    const base = resolveBaseUrl(preset, provider, baseUrls, claude.providerModels) || preset.baseUrl;
    if (!base) return { items: [], error: 'No base URL' };
    const { items, error } = await fetchOpenAiCompatibleAtBase(base, apiKey, preset.modelsListRelativePath);
    if (error && items.length === 0) return { items: [], error };
    return { items: items.map((m) => ({ providerId: provider, value: m.id, label: m.label })) };
  }

  // Anthropic 兼容网关（官方 Anthropic 在 registry 中可无 baseUrl）
  if (!apiKey) return { items: [] };

  const presetItems = preset.models.map((m) => ({
    providerId: provider,
    value: m.id,
    label: m.label || m.id,
  }));

  const selectedModel = claude.providerModels?.[provider] || preset.models[0]?.id || '';
  const authMethod = resolveAuthMethod(preset, provider);

  // 部分供应商聊天走 Anthropic 协议，但模型列表走 OpenAI 协议（如 DeepSeek、智谱、MiniMax）
  if (preset.modelsListProtocol === 'openai') {
    // 先按“聊天同链路”探测：与 Runner 一致，避免“能聊但显示不可用”。
    const chatBase = resolveBaseUrl(preset, provider, baseUrls, claude.providerModels) || preset.baseUrl;
    if (!chatBase) return { items: [], error: 'No base URL' };
    if (!selectedModel) return { items: [], error: 'No model configured' };
    const chatProbe = await probeAnthropicMessages(chatBase, apiKey, selectedModel, authMethod);
    if (!chatProbe.ok) {
      return { items: [], error: chatProbe.error || 'Chat probe failed' };
    }

    const modelsBase = preset.modelsListBaseUrl || preset.baseUrl;
    if (!modelsBase) return { items: [], error: 'No base URL for models listing' };
    const { items, error } = await fetchOpenAiCompatibleAtBase(
      modelsBase,
      apiKey,
      preset.modelsListRelativePath,
    );
    if (error && items.length === 0) {
      return { items: presetItems };
    }
    return { items: items.map((m) => ({ providerId: provider, value: m.id, label: m.label })) };
  }

  // Kimi: 兼容 code/moonshot 双通道。若当前模型通道不匹配 key，回退尝试其它候选地址。
  if (provider === 'kimi') {
    // Kimi 可能出现“key 绑定 moonshot 通道，但当前模型/地址走 code 通道”的错配。
    // 因此这里会按候选地址 + 候选模型做组合探测，命中任一可聊组合即判可用。
    const preferred = baseUrls?.kimi || preset.baseUrl;
    const selectedModel = claude.providerModels?.kimi || preset.models[0]?.id || 'kimi-for-coding';
    const primaryCandidates = getKimiCandidateBaseUrls(selectedModel, preferred);
    const fallbackCandidates = getKimiCandidateBaseUrls('', preferred);
    const candidates = [...new Set([...primaryCandidates, ...fallbackCandidates])];
    const probeModels = [
      selectedModel,
      'kimi-k2.5',
      'kimi-k2',
      'kimi-for-coding',
    ].filter((m, i, arr) => !!m && arr.indexOf(m) === i);
    let lastError: string | undefined;
    for (const base of candidates) {
      // Step 1: 先按聊天链路探测可用性
      let chatOk = false;
      for (const probeModel of probeModels) {
        const probe = await probeAnthropicMessages(base, apiKey, probeModel, authMethod);
        if (probe.ok) {
          chatOk = true;
          break;
        }
        if (probe.error) lastError = probe.error;
      }
      if (!chatOk) continue;

      // Step 2: 聊天可用后再拉模型列表，失败则回退内置模型，保持“可聊即可用”。
      const { items, error } = await fetchAnthropicCompatibleAllPages(base, apiKey, authMethod);
      if (items.length > 0) {
        return { items: items.map((m) => ({ providerId: provider, value: m.id, label: m.label })) };
      }
      if (error) lastError = error;
      return { items: presetItems };
    }
    return {
      items: [],
      error: friendlyKimiModelsError(lastError || 'All Kimi candidate base URLs failed'),
    };
  }

  const base =
    resolveBaseUrl(preset, provider, baseUrls, claude.providerModels) ||
    preset.baseUrl ||
    (provider === 'anthropic' ? ANTHROPIC_DEFAULT_API_BASE : undefined);
  if (!base) return { items: [], error: 'No base URL' };
  if (!selectedModel) return { items: [], error: 'No model configured' };

  // 先按聊天链路探测，保证可用性判断与 Runner 一致。
  const chatProbe = await probeAnthropicMessages(base, apiKey, selectedModel, authMethod);
  if (!chatProbe.ok) {
    return { items: [], error: chatProbe.error || 'Chat probe failed' };
  }

  // 聊天可用后再尝试拉模型列表；失败回退预置模型。
  const { items, error } = await fetchAnthropicCompatibleAllPages(base, apiKey, authMethod);
  if (error && items.length === 0) {
    return { items: presetItems };
  }
  return { items: items.map((m) => ({ providerId: provider, value: m.id, label: m.label })) };
}

async function collectCustomProvider(cp: CustomProviderConfig): Promise<{ items: AggregateLiveModelItem[]; error?: string }> {
  if (!cp.apiKey?.trim()) return { items: [] };
  const preset = getProviderPreset(cp.id, [cp]);
  const protocol = cp.apiProtocol ?? 'anthropic';
  if (protocol === 'openai') {
    const { items, error } = await fetchOpenAiCompatibleAtBase(cp.baseUrl, cp.apiKey.trim());
    if (error && items.length === 0) return { items: [], error };
    return { items: items.map((m) => ({ providerId: cp.id, value: m.id, label: m.label })) };
  }
  const authMethod = resolveAuthMethod(preset, cp.id);
  const { items, error } = await fetchAnthropicCompatibleAllPages(cp.baseUrl, cp.apiKey.trim(), authMethod);
  if (error && items.length === 0) return { items: [], error };
  return { items: items.map((m) => ({ providerId: cp.id, value: m.id, label: m.label })) };
}

function isMaskedKeyPlaceholder(k: string | null | undefined): boolean {
  return typeof k === 'string' && k.startsWith('••');
}

/**
 * 单供应商拉取模型列表以判断可用性（供设置页输入框旁自动检测）。
 * - apiKey 不传或 masked：使用磁盘已保存凭据
 * - 传空字符串：视为已清空该供应商 Key（仅内置走 providerApiKeys）
 * - ollamaBaseUrl：探测时临时合并进 providerBaseUrls（未保存也能测）
 */
export async function probeSupplierLive(
  providerId: ProviderId,
  apiKeyFromClient?: string | null,
  options?: { ollamaBaseUrl?: string | null },
): Promise<SupplierAvailabilityRow> {
  const settings = await getSettings();
  const claude = settings.claude;

  if (providerId.startsWith('custom-')) {
    const cp = claude.customProviders?.find((c) => c.id === providerId);
    if (!cp) {
      return { providerId, status: 'skipped', reasonKey: 'no_credential' };
    }
    let effectiveKey = '';
    if (apiKeyFromClient != null) {
      const raw = String(apiKeyFromClient).trim();
      if (raw === '') {
        effectiveKey = '';
      } else if (!isMaskedKeyPlaceholder(raw)) {
        effectiveKey = raw;
      } else {
        effectiveKey = (getCredential(claude, providerId).apiKey ?? cp.apiKey ?? '').trim();
      }
    } else {
      effectiveKey = (getCredential(claude, providerId).apiKey ?? cp.apiKey ?? '').trim();
    }
    if (!effectiveKey) {
      return { providerId, status: 'skipped', reasonKey: 'no_credential' };
    }
    const { items: part, error } = await collectCustomProvider({ ...cp, apiKey: effectiveKey });
    const claudeForRow: ClaudeSettings = {
      ...claude,
      providerApiKeys: { ...claude.providerApiKeys, [providerId]: effectiveKey },
    };
    return buildSupplierAvailabilityRows([{ pid: providerId, part, error }], claudeForRow)[0]!;
  }

  const preset = PROVIDER_REGISTRY.find((p) => p.id === providerId);
  if (!preset) {
    return { providerId, status: 'skipped', reasonKey: 'not_applicable' };
  }

  let claudeProbe = claude;
  if (providerId === 'ollama') {
    const fromOpt = options?.ollamaBaseUrl != null ? String(options.ollamaBaseUrl).trim() : '';
    if (fromOpt) {
      claudeProbe = {
        ...claude,
        providerBaseUrls: { ...claude.providerBaseUrls, ollama: fromOpt },
      };
    }
    if (!claudeProbe.providerBaseUrls?.ollama?.trim()) {
      return { providerId, status: 'skipped', reasonKey: 'ollama_not_enabled' };
    }
  }

  if (apiKeyFromClient !== undefined && apiKeyFromClient !== null && providerId !== 'ollama') {
    const v = String(apiKeyFromClient).trim();
    if (v && !isMaskedKeyPlaceholder(v)) {
      claudeProbe = {
        ...claude,
        providerApiKeys: { ...claude.providerApiKeys, [providerId]: v },
      };
    } else if (v === '') {
      const nk: Partial<Record<ProviderId, string>> = { ...claude.providerApiKeys };
      delete nk[providerId];
      claudeProbe = {
        ...claude,
        providerApiKeys: Object.keys(nk).length ? nk : undefined,
      };
    }
  }

  const { items: part, error } = await collectBuiltInProvider(providerId, preset, claudeProbe);
  return buildSupplierAvailabilityRows([{ pid: providerId, part, error }], claudeProbe)[0]!;
}

/**
 * 并行拉取所有「已配置凭据」的内置与自定义供应商的线上模型列表。
 * 单供应商异常不会拖垮整次请求；读设置等致命错误返回 ok: false + fatalError。
 */
export async function getAggregateLiveModels(): Promise<AggregateLiveModelsResult> {
  const fetchedAt = new Date().toISOString();
  try {
    const settings = await getSettings();
    const claude = settings.claude;
    const items: AggregateLiveModelItem[] = [];

    const builtInTasks = PROVIDER_REGISTRY.map(async (preset) => {
      const pid = preset.id as ProviderId;
      try {
        const { items: part, error } = await collectBuiltInProvider(pid, preset, claude);
        return { pid, part, error };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { pid, part: [] as AggregateLiveModelItem[], error: msg };
      }
    });

    const customList = claude.customProviders ?? [];
    const customTasks = customList.map(async (cp) => {
      try {
        const { items: part, error } = await collectCustomProvider(cp);
        return { pid: cp.id, part, error };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { pid: cp.id, part: [] as AggregateLiveModelItem[], error: msg };
      }
    });

    const settled = await Promise.all([...builtInTasks, ...customTasks]);

    for (const { pid, part } of settled) {
      items.push(...part);
    }

    items.sort((a, b) => {
      const c = a.providerId.localeCompare(b.providerId);
      if (c !== 0) return c;
      return a.label.localeCompare(b.label, undefined, { sensitivity: 'base' });
    });

    const supplierAvailability = buildSupplierAvailabilityRows(settled, claude);
    const okProviderIds = new Set(
      supplierAvailability.filter((r) => r.status === 'ok').map((r) => r.providerId),
    );
    const itemsVisibleOnModelTab = items.filter((m) => okProviderIds.has(m.providerId));

    return {
      ok: true,
      items: itemsVisibleOnModelTab,
      errors: {},
      supplierAvailability,
      fetchedAt,
    };
  } catch (e) {
    const fatalError = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      items: [],
      errors: {},
      supplierAvailability: [],
      fetchedAt,
      fatalError,
    };
  }
}
