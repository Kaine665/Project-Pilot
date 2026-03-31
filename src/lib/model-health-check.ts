/**
 * 模型健康巡检 — 按「供应商」探测，避免对每个模型各打一次 chat。
 *
 * 策略（与 OpenCode / OpenAI 生态常见做法一致）：
 * 1. 优先 GET `/v1/models`：OpenAI 兼容端点一把校验密钥 + 网络；Anthropic 官方/多数兼容网关同路径。
 * 2. 若列表不可用（404/未实现），再对该供应商仅发 **1 次** max_tokens=1 的 chat，结果复用到该供应商下所有预设模型。
 *
 * 使用方式：
 *   CLI:  npx tsx src/lib/model-health-check.ts [--provider <id>] [--json]
 *   API:  POST /api/settings/model-health
 *   Code: import { runHealthCheck } from '@/lib/model-health-check'
 */

import { PROVIDER_REGISTRY, getKimiCandidateBaseUrls } from '@/lib/provider-registry';
import type { ModelOption, ProviderPreset } from '@/lib/provider-registry';
import { getSettings, getCredential, getEffectiveAuthMode } from '@/lib/settings-manager';
import { getDataDir, readJsonFile, writeJsonFile } from '@/lib/file-store';
import type { ProviderId } from '@/types';
import path from 'path';
import fs from 'fs/promises';

// ── Types ──

export interface ModelHealthResult {
  status: 'ok' | 'failed' | 'skipped';
  latencyMs?: number;
  error?: string;
  checkedAt: string;
  /** 本行结果对应的探测方式（列表优先，回退时为单次补全） */
  probe?: 'models_list' | 'chat_completion' | 'oauth_file';
}

export interface ModelsHealth {
  lastRunAt: string;
  /** key 格式: "providerId/modelId" */
  results: Record<string, ModelHealthResult>;
}

// ── Config ──

const HEALTH_FILE = 'models-health.json';
const REQUEST_TIMEOUT_MS = 30_000;
const LIST_PROBE_TIMEOUT_MS = 15_000;

/** 不需要验证的供应商（无远程 API 或不适合自动测试） */
const SKIP_PROVIDERS = new Set<string>(['custom', 'ollama']);

function getHealthFilePath(): string {
  return path.join(getDataDir(), 'config', HEALTH_FILE);
}

// ── Read / Write results ──

const EMPTY_HEALTH: ModelsHealth = { lastRunAt: '', results: {} };

export async function readHealthResults(): Promise<ModelsHealth | null> {
  try {
    const data = await readJsonFile<ModelsHealth>(getHealthFilePath(), EMPTY_HEALTH);
    // If lastRunAt is empty, no check has ever run
    return data.lastRunAt ? data : null;
  } catch {
    return null;
  }
}

async function writeHealthResults(data: ModelsHealth): Promise<void> {
  await writeJsonFile(getHealthFilePath(), data);
}

// ── HTTP helpers ──

interface ApiCallResult {
  ok: boolean;
  latencyMs: number;
  error?: string;
}

/**
 * Anthropic 协议：POST /v1/messages
 * 适用于 anthropic, deepseek, qwen, zhipu, minimax, kimi, openrouter
 */
async function testAnthropicProtocol(
  baseUrl: string,
  modelId: string,
  apiKey: string,
  authMethod: 'API_KEY' | 'AUTH_TOKEN',
): Promise<ApiCallResult> {
  const url = `${baseUrl.replace(/\/$/, '')}/v1/messages`;

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'anthropic-version': '2023-06-01',
  };

  if (authMethod === 'API_KEY') {
    headers['x-api-key'] = apiKey;
  } else {
    headers['authorization'] = `Bearer ${apiKey}`;
  }

  const body = JSON.stringify({
    model: modelId,
    max_tokens: 1,
    messages: [{ role: 'user', content: 'hi' }],
  });

  const start = Date.now();
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const latencyMs = Date.now() - start;

    if (res.ok) {
      // Consume body to avoid leaking
      await res.text();
      return { ok: true, latencyMs };
    }

    const text = await res.text().catch(() => '');
    let errorMsg = `HTTP ${res.status}`;
    try {
      const json = JSON.parse(text);
      errorMsg = json.error?.message || json.error?.type || json.message || errorMsg;
    } catch {
      if (text.length < 200) errorMsg = text || errorMsg;
    }

    return { ok: false, latencyMs, error: errorMsg };
  } catch (err) {
    const latencyMs = Date.now() - start;
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, latencyMs, error: msg };
  }
}

function buildOpenAiModelsListUrl(baseRoot: string, relativePath = 'v1/models'): string {
  const s = baseRoot.replace(/\/+$/, '').replace(/\/v1$/i, '');
  const p = relativePath.replace(/^\/+/, '');
  return `${s}/${p}`;
}

function anthropicCompatibleModelsUrl(baseRoot: string): string {
  const s = baseRoot.replace(/\/+$/, '');
  return /\/v1$/i.test(s) ? `${s}/models` : `${s}/v1/models`;
}

/**
 * OpenAI 兼容：GET /v1/models（校验密钥，无需跑推理）
 */
async function fetchModelsListOpenAiStyle(
  baseRoot: string,
  apiKey: string,
  listRelativePath?: string,
): Promise<ApiCallResult> {
  const url = buildOpenAiModelsListUrl(baseRoot, listRelativePath ?? 'v1/models');
  const start = Date.now();
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${apiKey}`,
        accept: 'application/json',
      },
      signal: AbortSignal.timeout(LIST_PROBE_TIMEOUT_MS),
    });
    const latencyMs = Date.now() - start;
    if (res.ok) {
      await res.text();
      return { ok: true, latencyMs };
    }
    const text = await res.text().catch(() => '');
    let errorMsg = `HTTP ${res.status}`;
    try {
      const json = JSON.parse(text) as { error?: { message?: string }; message?: string };
      errorMsg = json.error?.message || json.message || errorMsg;
    } catch {
      if (text.length < 200) errorMsg = text || errorMsg;
    }
    return { ok: false, latencyMs, error: errorMsg };
  } catch (err) {
    const latencyMs = Date.now() - start;
    return { ok: false, latencyMs, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Anthropic 兼容：GET /v1/models（官方与多数代理支持）
 */
async function fetchModelsListAnthropicStyle(
  baseRoot: string,
  apiKey: string,
  authMethod: 'API_KEY' | 'AUTH_TOKEN',
): Promise<ApiCallResult> {
  const url = anthropicCompatibleModelsUrl(baseRoot);
  const headers: Record<string, string> = {
    'anthropic-version': '2023-06-01',
  };
  if (authMethod === 'API_KEY') {
    headers['x-api-key'] = apiKey;
  } else {
    headers['authorization'] = `Bearer ${apiKey}`;
  }
  const start = Date.now();
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(LIST_PROBE_TIMEOUT_MS),
    });
    const latencyMs = Date.now() - start;
    if (res.ok) {
      await res.text();
      return { ok: true, latencyMs };
    }
    const text = await res.text().catch(() => '');
    let errorMsg = `HTTP ${res.status}`;
    try {
      const json = JSON.parse(text) as { error?: { message?: string; type?: string }; message?: string };
      errorMsg = json.error?.message || json.error?.type || json.message || errorMsg;
    } catch {
      if (text.length < 200) errorMsg = text || errorMsg;
    }
    return { ok: false, latencyMs, error: errorMsg };
  } catch (err) {
    const latencyMs = Date.now() - start;
    return { ok: false, latencyMs, error: err instanceof Error ? err.message : String(err) };
  }
}

type ProbeOutcome =
  | { kind: 'list_ok'; latencyMs: number }
  | { kind: 'chat_ok'; latencyMs: number }
  | { kind: 'failed'; latencyMs: number; error: string };

/**
 * 每个内置/自定义供应商至多：1 次 models 列表，失败则 1 次最小 chat。
 */
async function probeProviderOnce(
  provider: ProviderId,
  preset: ProviderPreset,
  settings: Awaited<ReturnType<typeof getSettings>>,
  apiKey: string,
  firstModelId: string,
): Promise<ProbeOutcome> {
  if (provider === 'openai') {
    const list = await fetchModelsListOpenAiStyle('https://api.openai.com', apiKey);
    if (list.ok) return { kind: 'list_ok', latencyMs: list.latencyMs };
    const chat = await testOpenAiChatCompletions('https://api.openai.com', firstModelId, apiKey);
    return chat.ok
      ? { kind: 'chat_ok', latencyMs: chat.latencyMs }
      : { kind: 'failed', latencyMs: chat.latencyMs, error: chat.error ?? 'chat probe failed' };
  }

  if (provider === 'openrouter' && preset.baseUrl) {
    const list = await fetchModelsListOpenAiStyle(preset.baseUrl, apiKey);
    if (list.ok) return { kind: 'list_ok', latencyMs: list.latencyMs };
    const chat = await testOpenAiChatCompletions(preset.baseUrl, firstModelId, apiKey);
    return chat.ok
      ? { kind: 'chat_ok', latencyMs: chat.latencyMs }
      : { kind: 'failed', latencyMs: chat.latencyMs, error: chat.error ?? 'chat probe failed' };
  }

  if (provider === 'anthropic') {
    const list = await fetchModelsListAnthropicStyle('https://api.anthropic.com', apiKey, 'API_KEY');
    if (list.ok) return { kind: 'list_ok', latencyMs: list.latencyMs };
    const chat = await testAnthropicProtocol('https://api.anthropic.com', firstModelId, apiKey, 'API_KEY');
    return chat.ok
      ? { kind: 'chat_ok', latencyMs: chat.latencyMs }
      : { kind: 'failed', latencyMs: chat.latencyMs, error: chat.error ?? 'chat probe failed' };
  }

  if (provider.startsWith('custom-')) {
    const base = preset.baseUrl;
    if (!base) {
      return { kind: 'failed', latencyMs: 0, error: 'No base URL' };
    }
    if (preset.apiProtocol === 'openai') {
      const list = await fetchModelsListOpenAiStyle(base, apiKey);
      if (list.ok) return { kind: 'list_ok', latencyMs: list.latencyMs };
      const chat = await testOpenAiChatCompletions(base, firstModelId, apiKey);
      return chat.ok
        ? { kind: 'chat_ok', latencyMs: chat.latencyMs }
        : { kind: 'failed', latencyMs: chat.latencyMs, error: chat.error ?? 'chat probe failed' };
    }
    const authMethod = resolveAuthMethod(preset, provider);
    const list = await fetchModelsListAnthropicStyle(base, apiKey, authMethod);
    if (list.ok) return { kind: 'list_ok', latencyMs: list.latencyMs };
    const chat = await testAnthropicProtocol(base, firstModelId, apiKey, authMethod);
    return chat.ok
      ? { kind: 'chat_ok', latencyMs: chat.latencyMs }
      : { kind: 'failed', latencyMs: chat.latencyMs, error: chat.error ?? 'chat probe failed' };
  }

  const baseUrl = resolveBaseUrl(preset, settings, provider, firstModelId);
  if (!baseUrl) {
    return { kind: 'failed', latencyMs: 0, error: 'No base URL' };
  }
  const authMethod = resolveAuthMethod(preset, provider);

  // 聊天走 Anthropic 兼容、模型列表走 OpenAI 兼容（如 DeepSeek）
  if (preset.modelsListProtocol === 'openai') {
    const modelsBase = preset.modelsListBaseUrl || baseUrl;
    const list = await fetchModelsListOpenAiStyle(
      modelsBase,
      apiKey,
      preset.modelsListRelativePath,
    );
    if (list.ok) return { kind: 'list_ok', latencyMs: list.latencyMs };
    const chat = await testAnthropicProtocol(baseUrl, firstModelId, apiKey, authMethod);
    return chat.ok
      ? { kind: 'chat_ok', latencyMs: chat.latencyMs }
      : { kind: 'failed', latencyMs: chat.latencyMs, error: chat.error ?? 'chat probe failed' };
  }

  const list = await fetchModelsListAnthropicStyle(baseUrl, apiKey, authMethod);
  if (list.ok) return { kind: 'list_ok', latencyMs: list.latencyMs };
  const chat = await testAnthropicProtocol(baseUrl, firstModelId, apiKey, authMethod);
  return chat.ok
    ? { kind: 'chat_ok', latencyMs: chat.latencyMs }
    : { kind: 'failed', latencyMs: chat.latencyMs, error: chat.error ?? 'chat probe failed' };
}

/**
 * OpenAI 协议：POST /v1/chat/completions（任意 OpenAI 兼容 base）
 */
async function testOpenAiChatCompletions(
  baseRoot: string,
  modelId: string,
  apiKey: string,
): Promise<ApiCallResult> {
  const root = baseRoot.replace(/\/+$/, '').replace(/\/v1$/i, '');
  const url = `${root}/v1/chat/completions`;

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    authorization: `Bearer ${apiKey}`,
  };

  const body = JSON.stringify({
    model: modelId,
    max_tokens: 1,
    messages: [{ role: 'user', content: 'hi' }],
  });

  const start = Date.now();
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const latencyMs = Date.now() - start;

    if (res.ok) {
      await res.text();
      return { ok: true, latencyMs };
    }

    const text = await res.text().catch(() => '');
    let errorMsg = `HTTP ${res.status}`;
    try {
      const json = JSON.parse(text) as { error?: { message?: string }; message?: string };
      errorMsg = json.error?.message || json.message || errorMsg;
    } catch {
      if (text.length < 200) errorMsg = text || errorMsg;
    }

    return { ok: false, latencyMs, error: errorMsg };
  } catch (err) {
    const latencyMs = Date.now() - start;
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, latencyMs, error: msg };
  }
}

/**
 * OpenAI 官方：POST /v1/chat/completions
 */
async function testOpenAIProtocol(
  modelId: string,
  apiKey: string,
): Promise<ApiCallResult> {
  return testOpenAiChatCompletions('https://api.openai.com', modelId, apiKey);
}

// ── OAuth token reader ──

/**
 * Read OAuth access token from credentials file.
 * Anthropic: ~/.claude/.credentials.json → claudeAiOauth.accessToken
 */
async function readOAuthAccessToken(provider: ProviderId): Promise<string | null> {
  try {
    if (provider === 'anthropic') {
      const credPath = path.join(require('os').homedir(), '.claude', '.credentials.json');
      const raw = await fs.readFile(credPath, 'utf-8');
      const data = JSON.parse(raw);
      const token = data?.claudeAiOauth?.accessToken;
      if (token && typeof token === 'string') {
        // Check if token is expired
        const expiresAt = data?.claudeAiOauth?.expiresAt;
        if (expiresAt && Date.now() > expiresAt) {
          return null; // expired
        }
        return token;
      }
    }
    // OpenAI OAuth not supported for direct API calls yet
    return null;
  } catch {
    return null;
  }
}

/**
 * Check if an OAuth token file is valid (exists + not expired).
 * Anthropic REST API doesn't accept OAuth tokens — only CLI/SDK does.
 * So we verify token validity without making an API call.
 */
async function checkOAuthTokenValidity(
  provider: ProviderId,
): Promise<{ valid: boolean; error?: string }> {
  try {
    if (provider === 'anthropic') {
      const credPath = path.join(require('os').homedir(), '.claude', '.credentials.json');
      const raw = await fs.readFile(credPath, 'utf-8');
      const data = JSON.parse(raw);
      const oauth = data?.claudeAiOauth;
      if (!oauth?.accessToken) {
        return { valid: false, error: 'OAuth token file exists but no accessToken found' };
      }
      if (oauth.expiresAt && Date.now() > oauth.expiresAt) {
        return { valid: false, error: `OAuth token expired at ${new Date(oauth.expiresAt).toISOString()}` };
      }
      return { valid: true };
    }
    // OpenAI OAuth: check ~/.codex/auth.json
    if (provider === 'openai') {
      const credPath = path.join(require('os').homedir(), '.codex', 'auth.json');
      const raw = await fs.readFile(credPath, 'utf-8');
      const data = JSON.parse(raw);
      if (!data?.accessToken && !data?.token) {
        return { valid: false, error: 'Codex auth file exists but no token found' };
      }
      return { valid: true };
    }
    return { valid: false, error: `OAuth not supported for ${provider}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('ENOENT')) {
      return { valid: false, error: 'OAuth credential file not found' };
    }
    return { valid: false, error: msg };
  }
}

/**
 * Resolve effective API key for a provider, including OAuth tokens.
 */
async function resolveApiKey(
  settings: Awaited<ReturnType<typeof getSettings>>,
  provider: ProviderId,
): Promise<string | null> {
  const cred = getCredential(settings.claude, provider);

  // If we have an API key, use it
  if (cred.apiKey) return cred.apiKey;

  // If OAuth mode, try to read the access token
  const authMode = getEffectiveAuthMode(settings.claude, provider);
  if (authMode === 'oauth') {
    return readOAuthAccessToken(provider);
  }

  return null;
}

// ── Core logic ──

interface CheckOptions {
  /** 只检查指定供应商（默认全部） */
  providerFilter?: ProviderId;
  /** 只检查指定模型 */
  modelFilter?: string;
  /** 进度回调：在每个模型开始测试前调用 */
  onProgress?: (provider: string, model: string, index: number, total: number) => void;
  /** 结果回调：在每个模型测试完成后调用 */
  onResult?: (key: string, result: ModelHealthResult) => void;
}

/**
 * 判断一个供应商使用 API_KEY 还是 AUTH_TOKEN 认证。
 */
function resolveAuthMethod(preset: ProviderPreset, provider: ProviderId): 'API_KEY' | 'AUTH_TOKEN' {
  if (preset.authMethod) return preset.authMethod;
  if (preset.useApiKeyForAuth) return 'API_KEY';
  if (provider === 'anthropic') return 'API_KEY';
  if (provider === 'kimi') return 'API_KEY';
  return 'AUTH_TOKEN';
}

/**
 * 解析供应商的 base URL（考虑 Kimi 的多 URL 策略和用户自定义）。
 */
function resolveBaseUrl(
  preset: ProviderPreset,
  settings: Awaited<ReturnType<typeof getSettings>>,
  provider: ProviderId,
  modelId: string,
): string | undefined {
  const claude = settings.claude;

  if (provider === 'kimi') {
    const preferred = claude.providerBaseUrls?.[provider] || preset.baseUrl;
    const candidates = getKimiCandidateBaseUrls(modelId, preferred);
    return candidates[0];
  }

  if (provider === 'ollama') {
    const o = claude.providerBaseUrls?.[provider]?.trim();
    return o || undefined;
  }

  // 用户自定义的 baseUrl > preset.baseUrl
  const userUrl = claude.providerBaseUrls?.[provider];
  return userUrl || preset.baseUrl;
}

interface ProviderWorkItem {
  provider: ProviderId;
  preset: ProviderPreset;
  models: ModelOption[];
}

function outcomeToResults(
  keys: string[],
  outcome: ProbeOutcome,
  probe: ModelHealthResult['probe'],
  now: string,
): Record<string, ModelHealthResult> {
  const out: Record<string, ModelHealthResult> = {};
  const status = outcome.kind === 'failed' ? 'failed' : 'ok';
  for (const key of keys) {
    out[key] = {
      status,
      checkedAt: now,
      probe,
      latencyMs: outcome.latencyMs,
      ...(outcome.kind === 'failed' ? { error: outcome.error } : {}),
    };
  }
  return out;
}

/**
 * 运行模型健康巡检。
 *
 * 按供应商聚合：每个供应商至多 1 次 models 列表 +（必要时）1 次最小 chat，结果写入各模型行。
 */
export async function runHealthCheck(options: CheckOptions = {}): Promise<ModelsHealth> {
  const settings = await getSettings();
  const { providerFilter, modelFilter, onProgress, onResult } = options;

  const workItems: ProviderWorkItem[] = [];

  for (const preset of PROVIDER_REGISTRY) {
    if (SKIP_PROVIDERS.has(preset.id)) continue;
    if (providerFilter && preset.id !== providerFilter) continue;

    const cred = getCredential(settings.claude, preset.id);
    const authMode = getEffectiveAuthMode(settings.claude, preset.id);
    if (!cred.apiKey && authMode !== 'oauth' && cred.source === 'default') continue;

    const models = preset.models.filter((m) => !modelFilter || m.id === modelFilter);
    if (models.length === 0) continue;

    workItems.push({ provider: preset.id, preset, models });
  }

  if (settings.claude.customProviders) {
    for (const cp of settings.claude.customProviders) {
      if (providerFilter && cp.id !== providerFilter) continue;

      const cred = getCredential(settings.claude, cp.id);
      if (!cred.apiKey && cred.source === 'default') continue;

      const modelOpts = cp.modelIds
        .filter((id) => !modelFilter || id === modelFilter)
        .map((id) => ({ id, label: id }));
      if (modelOpts.length === 0) continue;

      workItems.push({
        provider: cp.id,
        preset: {
          id: cp.id,
          nameKey: cp.name,
          baseUrl: cp.baseUrl,
          models: [],
          supportsOAuth: false,
          editableBaseUrl: false,
          editableModel: true,
          apiProtocol: cp.apiProtocol,
          authMethod: cp.authMethod,
        },
        models: modelOpts,
      });
    }
  }

  const results: Record<string, ModelHealthResult> = {};
  const now = new Date().toISOString();
  const totalSteps = workItems.length;

  for (let i = 0; i < workItems.length; i++) {
    const { provider, preset, models } = workItems[i];
    const keys = models.map((m) => `${provider}/${m.id}`);
    const firstModelId = models[0].id;

    if (onProgress) onProgress(provider, firstModelId, i + 1, totalSteps);

    const authMode = getEffectiveAuthMode(settings.claude, provider);

    if (authMode === 'oauth' && (provider === 'anthropic' || provider === 'openai')) {
      const tokenStatus = await checkOAuthTokenValidity(provider);
      const r: ModelHealthResult = {
        status: tokenStatus.valid ? 'ok' : 'failed',
        checkedAt: now,
        probe: 'oauth_file',
        ...(tokenStatus.valid ? {} : { error: tokenStatus.error }),
      };
      for (const key of keys) {
        results[key] = { ...r };
        onResult?.(key, results[key]);
      }
      continue;
    }

    const apiKey = await resolveApiKey(settings, provider);
    if (!apiKey) {
      for (const key of keys) {
        const r: ModelHealthResult = { status: 'skipped', checkedAt: now, error: 'No API key' };
        results[key] = r;
        onResult?.(key, r);
      }
      continue;
    }

    const probe = await probeProviderOnce(provider, preset, settings, apiKey, firstModelId);
    const probeTag: ModelHealthResult['probe'] = probe.kind === 'list_ok' ? 'models_list' : 'chat_completion';
    const batch = outcomeToResults(keys, probe, probeTag, now);
    for (const key of keys) {
      results[key] = batch[key]!;
      onResult?.(key, results[key]);
    }
  }

  const existing = await readHealthResults();
  const merged: ModelsHealth = {
    lastRunAt: now,
    results: {
      ...(existing?.results ?? {}),
      ...results,
    },
  };

  await writeHealthResults(merged);
  return merged;
}

// ── CLI entry ──

async function main() {
  const args = process.argv.slice(2);
  const providerIndex = args.indexOf('--provider');
  const providerFilter = providerIndex >= 0 ? (args[providerIndex + 1] as ProviderId) : undefined;
  const jsonMode = args.includes('--json');

  if (!jsonMode) {
    console.log('🔍 Starting model health check...');
    if (providerFilter) console.log(`   Provider filter: ${providerFilter}`);
    console.log();
  }

  const result = await runHealthCheck({
    providerFilter,
    onProgress: jsonMode ? undefined : (_provider, _model, index, total) => {
      process.stdout.write(`  [${index}/${total}] `);
    },
    onResult: jsonMode ? undefined : (key, r) => {
      const icon = r.status === 'ok' ? '✅' : r.status === 'failed' ? '❌' : '⏭️';
      const latency = r.latencyMs ? ` (${r.latencyMs}ms)` : '';
      const error = r.error ? ` — ${r.error}` : '';
      console.log(`${icon} ${key}${latency}${error}`);
    },
  });

  if (jsonMode) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  // Print summary
  const entries = Object.entries(result.results);
  const okCount = entries.filter(([, r]) => r.status === 'ok').length;
  const failCount = entries.filter(([, r]) => r.status === 'failed').length;
  const skipCount = entries.filter(([, r]) => r.status === 'skipped').length;

  console.log();
  console.log('━'.repeat(60));
  console.log(`Total: ${okCount} ok, ${failCount} failed, ${skipCount} skipped`);
  console.log(`Saved to: ${getHealthFilePath()}`);
}

// Run CLI if executed directly
const isDirectRun = process.argv[1]?.replace(/\\/g, '/').includes('model-health-check');
if (isDirectRun) {
  main().catch((err) => {
    console.error('Health check failed:', err);
    process.exit(1);
  });
}
