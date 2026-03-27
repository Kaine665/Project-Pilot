/**
 * 模型健康巡检 — 逐模型验证可用性。
 *
 * 直接发 HTTP 请求到各供应商 API，不走 Claude CLI，极低开销。
 * 每次只发 max_tokens=1 的最小请求，token 消耗可忽略。
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
}

export interface ModelsHealth {
  lastRunAt: string;
  /** key 格式: "providerId/modelId" */
  results: Record<string, ModelHealthResult>;
}

// ── Config ──

const HEALTH_FILE = 'models-health.json';
const REQUEST_TIMEOUT_MS = 30_000;

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

/**
 * Anthropic 官方 API（无自定义 baseUrl 时用默认端点）
 */
async function testAnthropicOfficial(
  modelId: string,
  apiKey: string,
): Promise<ApiCallResult> {
  return testAnthropicProtocol(
    'https://api.anthropic.com',
    modelId,
    apiKey,
    'API_KEY',
  );
}

/**
 * OpenAI 协议：POST /v1/chat/completions
 */
async function testOpenAIProtocol(
  modelId: string,
  apiKey: string,
): Promise<ApiCallResult> {
  const url = 'https://api.openai.com/v1/chat/completions';

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'authorization': `Bearer ${apiKey}`,
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
      const json = JSON.parse(text);
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

  // 用户自定义的 baseUrl > preset.baseUrl
  const userUrl = claude.providerBaseUrls?.[provider];
  return userUrl || preset.baseUrl;
}

/**
 * 运行模型健康巡检。
 *
 * 遍历所有有 credentials 的供应商的所有模型，逐个发最小请求验证。
 * 结果写入 {DATA_DIR}/config/models-health.json（默认 ~/.project-pilot/config/）。
 */
export async function runHealthCheck(options: CheckOptions = {}): Promise<ModelsHealth> {
  const settings = await getSettings();
  const { providerFilter, modelFilter, onProgress, onResult } = options;

  // Collect all (provider, model) pairs to test
  const tasks: Array<{ provider: ProviderId; preset: ProviderPreset; model: ModelOption }> = [];

  for (const preset of PROVIDER_REGISTRY) {
    if (SKIP_PROVIDERS.has(preset.id)) continue;
    if (providerFilter && preset.id !== providerFilter) continue;

    // Check if we have credentials for this provider (API key or OAuth)
    const cred = getCredential(settings.claude, preset.id);
    const authMode = getEffectiveAuthMode(settings.claude, preset.id);
    if (!cred.apiKey && authMode !== 'oauth' && cred.source === 'default') continue;

    for (const model of preset.models) {
      if (modelFilter && model.id !== modelFilter) continue;
      tasks.push({ provider: preset.id, preset, model });
    }
  }

  // Also check custom providers
  if (settings.claude.customProviders) {
    for (const cp of settings.claude.customProviders) {
      if (providerFilter && cp.id !== providerFilter) continue;

      const cred = getCredential(settings.claude, cp.id);
      if (!cred.apiKey && cred.source === 'default') continue;

      for (const modelId of cp.modelIds) {
        if (modelFilter && modelId !== modelFilter) continue;
        tasks.push({
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
          model: { id: modelId, label: modelId },
        });
      }
    }
  }

  const results: Record<string, ModelHealthResult> = {};
  const now = new Date().toISOString();

  for (let i = 0; i < tasks.length; i++) {
    const { provider, preset, model } = tasks[i];
    const key = `${provider}/${model.id}`;

    if (onProgress) onProgress(provider, model.id, i + 1, tasks.length);

    const authMode = getEffectiveAuthMode(settings.claude, provider);

    // OAuth providers (Anthropic/OpenAI): REST API doesn't accept OAuth tokens directly.
    // Instead, verify the token file is valid and not expired.
    if (authMode === 'oauth' && (provider === 'anthropic' || provider === 'openai')) {
      const tokenStatus = await checkOAuthTokenValidity(provider);
      const r: ModelHealthResult = {
        status: tokenStatus.valid ? 'ok' : 'failed',
        checkedAt: now,
        ...(tokenStatus.valid ? {} : { error: tokenStatus.error }),
      };
      results[key] = r;
      onResult?.(key, r);
      continue;
    }

    const apiKey = await resolveApiKey(settings, provider);
    if (!apiKey) {
      const r: ModelHealthResult = { status: 'skipped', checkedAt: now, error: 'No API key' };
      results[key] = r;
      onResult?.(key, r);
      continue;
    }

    let result: ApiCallResult;

    if (provider === 'anthropic') {
      // Anthropic official API with API key
      result = await testAnthropicOfficial(model.id, apiKey);
    } else if (provider === 'openai') {
      // OpenAI official API
      result = await testOpenAIProtocol(model.id, apiKey);
    } else {
      // Third-party Anthropic-compatible
      const baseUrl = resolveBaseUrl(preset, settings, provider, model.id);
      if (!baseUrl) {
        const r: ModelHealthResult = { status: 'skipped', checkedAt: now, error: 'No base URL' };
        results[key] = r;
        onResult?.(key, r);
        continue;
      }
      const authMethod = resolveAuthMethod(preset, provider);
      result = await testAnthropicProtocol(baseUrl, model.id, apiKey, authMethod);
    }

    const r: ModelHealthResult = {
      status: result.ok ? 'ok' : 'failed',
      latencyMs: result.latencyMs,
      ...(result.error ? { error: result.error } : {}),
      checkedAt: now,
    };
    results[key] = r;
    onResult?.(key, r);
  }

  // Merge with existing results (preserve old results for models not tested this run)
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
