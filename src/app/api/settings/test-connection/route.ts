/**
 * POST /api/settings/test-connection
 *
 * 通过一次不计入会话列表的快速对话测试，验证 AI 配置是否可用。
 * 比单纯 API 连通性检查更可靠，能发现会话层面的问题。
 *
 * 支持 api_key 和 oauth 两种认证模式。
 */

import { NextRequest, NextResponse } from 'next/server';
import { getProviderPreset } from '@/lib/provider-registry';
import { getSettings, saveSettings, getProviderScopedApiKey, getProviderScopedModel } from '@/lib/settings-manager';
import { agentChatManager } from '@/lib/agent-chat-manager';
import { BUTLER_AGENT_ID } from '@/lib/default-agents';
import { parseAuthStatusText } from '@/lib/oauth-status';
import { execClaude } from '@/lib/claude-cli';
import type { ProviderId } from '@/types';

const TEST_POLL_MS = 500;
const TEST_TIMEOUT_MS = 60_000;

const OAUTH_CHECK_TIMEOUT_MS = 25_000;

/**
 * OAuth 模式：通过 Claude CLI 检测认证状态。
 * 使用 execClaude 以兼容 Windows 上的 .cmd/.bat 路径解析。
 */
async function testOAuthConnection(_provider: ProviderId): Promise<NextResponse> {
  try {
    const { stdout, stderr } = await execClaude(['auth', 'status'], { timeout: OAUTH_CHECK_TIMEOUT_MS });
    const output = (stdout + stderr).trim();
    if (parseAuthStatusText(output)) {
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({
      ok: false,
      error: output || '尚未完成 OAuth 认证',
    });
  } catch (err) {
    const e = err as Error & { stdout?: string; stderr?: string };
    const output = ((e.stdout || '') + (e.stderr || '')).trim();
    return NextResponse.json({
      ok: false,
      error: output || `CLI 不可用或未安装: ${e.message}`,
    });
  }
}

/**
 * Ollama：无认证，直接请求 /api/tags。
 */
async function testOllamaConnection(
  baseUrl: string | undefined,
  preset: { baseUrl?: string },
): Promise<NextResponse> {
  const url = (baseUrl || preset.baseUrl || 'http://localhost:11434').replace(/\/$/, '') + '/api/tags';
  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({
        ok: false,
        error: res.status === 404 ? 'Ollama 未运行或地址错误' : text || `HTTP ${res.status}`,
      });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg });
  }
}

/**
 * 使用指定 baseUrl 执行一次 ephemeral 对话测试。
 * 成功时持久化 providerBaseUrls[provider]，失败时恢复原 baseUrl。
 */
async function runSingleTest(
  provider: ProviderId,
  apiKey: string,
  model: string,
  baseUrl: string,
  current: Awaited<ReturnType<typeof getSettings>>,
): Promise<{ ok: boolean; error?: string }> {
  const preset = getProviderPreset(provider);
  const prevBaseUrl = current.claude.baseUrl;

  const mergedForTest = {
    ...current,
    claude: {
      ...current.claude,
      provider,
      authMode: 'api_key' as const,
      providerApiKeys: { ...current.claude.providerApiKeys, [provider]: apiKey },
      providerModels: { ...current.claude.providerModels, [provider]: model || preset.models[0]?.id },
      baseUrl,
    },
  };
  await saveSettings(mergedForTest);

  const sessionId = `__test-${Date.now()}`;
  let testOk = false;
  try {
    await agentChatManager.start(
      sessionId,
      BUTLER_AGENT_ID,
      '回复 ok',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      provider,
      model || preset.models[0]?.id,
      undefined,
      true, // ephemeral
    );
  } catch (err) {
    await saveSettings({
      ...current,
      claude: { ...current.claude, baseUrl: prevBaseUrl },
    });
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }

  const deadline = Date.now() + TEST_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const status = agentChatManager.getStatus(sessionId);
    if (status.status === 'completed') {
      testOk = true;
      agentChatManager.clear(sessionId);
      break;
    }
    if (status.status === 'failed' || status.status === 'stopped') {
      agentChatManager.clear(sessionId);
      await saveSettings({
        ...current,
        claude: { ...current.claude, baseUrl: prevBaseUrl },
      });
      const errMsg = status.errorMessage;
      return {
        ok: false,
        error: errMsg?.trim() || '会话测试失败，请检查模型、API 地址或网络',
      };
    }
    await new Promise((r) => setTimeout(r, TEST_POLL_MS));
  }

  if (!testOk) {
    agentChatManager.stop(sessionId);
    agentChatManager.clear(sessionId);
    await saveSettings({
      ...current,
      claude: { ...current.claude, baseUrl: prevBaseUrl },
    });
    return { ok: false, error: '会话测试超时' };
  }

  // 成功：持久化 providerBaseUrls，恢复全局 baseUrl
  const mergedSuccess = {
    ...current,
    claude: {
      ...current.claude,
      provider,
      authMode: 'api_key' as const,
      providerApiKeys: { ...current.claude.providerApiKeys, [provider]: apiKey },
      providerModels: { ...current.claude.providerModels, [provider]: model || preset.models[0]?.id },
      providerBaseUrls: { ...current.claude.providerBaseUrls, [provider]: baseUrl },
      baseUrl: prevBaseUrl,
    },
  };
  await saveSettings(mergedSuccess);
  return { ok: true };
}

/**
 * API Key 模式：临时保存配置，运行 ephemeral 对话测试。
 * Kimi：若无已保存 baseUrl，依次尝试 candidateBaseUrls，成功后持久化到 providerBaseUrls。
 */
async function testConversationConnection(
  provider: ProviderId,
  apiKey: string,
  model: string,
  baseUrl: string | undefined,
): Promise<NextResponse> {
  const preset = getProviderPreset(provider);
  const key = typeof apiKey === 'string' ? apiKey.trim() : '';
  if (!key || key.startsWith('••')) {
    return NextResponse.json({ ok: false, error: '请先填写 API 密钥' }, { status: 400 });
  }

  const current = await getSettings();
  const savedProviderUrl = current.claude.providerBaseUrls?.[provider];
  const userProvidedUrl = baseUrl?.trim() || undefined;

  // 用户手动填了 baseUrl，或已有探测成功的 URL：直接测试
  const effectiveBaseUrl = userProvidedUrl || savedProviderUrl;
  if (effectiveBaseUrl) {
    const result = await runSingleTest(provider, key, model, effectiveBaseUrl, current);
    if (result.ok) {
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ ok: false, error: result.error });
  }

  // Kimi 等：无保存 URL 时依次尝试候选
  const candidates = preset.candidateBaseUrls;
  if (!candidates?.length) {
    return NextResponse.json({ ok: false, error: '缺少 API 地址' }, { status: 400 });
  }

  for (const url of candidates) {
    const result = await runSingleTest(provider, key, model, url, current);
    if (result.ok) {
      // 成功：providerBaseUrls 已在 runSingleTest 的 merged 中写入并保存
      return NextResponse.json({ ok: true, baseUrl: url });
    }
  }

  return NextResponse.json({
    ok: false,
    error: `所有候选地址均不可用，请检查 API 密钥或网络`,
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    let { provider, authMode, apiKey, model, baseUrl } = body;

    if (!provider || typeof provider !== 'string') {
      return NextResponse.json({ ok: false, error: 'Missing provider' }, { status: 400 });
    }

    const preset = getProviderPreset(provider as ProviderId);

    if (typeof apiKey === 'string' && apiKey.startsWith('••')) {
      const settings = await getSettings();
      const savedKey = getProviderScopedApiKey(settings.claude, provider as ProviderId);
      if (savedKey) apiKey = savedKey;
      if (!model) model = getProviderScopedModel(settings.claude, provider as ProviderId);
      if (!baseUrl && settings.claude.baseUrl) baseUrl = settings.claude.baseUrl;
    }

    if (authMode === 'oauth') {
      return await testOAuthConnection(provider as ProviderId);
    }

    if (provider === 'ollama') {
      return await testOllamaConnection(baseUrl, preset);
    }

    return await testConversationConnection(
      provider as ProviderId,
      apiKey,
      model,
      baseUrl,
    );
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const isTimeout = errMsg.includes('timeout') || errMsg.includes('abort');
    return NextResponse.json({
      ok: false,
      error: isTimeout ? '请求超时，请检查网络或 API 地址' : errMsg,
    });
  }
}
