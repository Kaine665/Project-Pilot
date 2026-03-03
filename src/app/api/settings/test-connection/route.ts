/**
 * POST /api/settings/test-connection
 *
 * 测试当前 AI 配置是否可用。
 * 使用表单中的配置（或已保存的配置，当 apiKey 为掩码时）发起一次最小请求。
 */

import { NextRequest, NextResponse } from 'next/server';
import { getProviderPreset } from '@/lib/provider-registry';
import { getSettings } from '@/lib/settings-manager';
import { execClaude } from '@/lib/claude-cli';
import { execCodex } from '@/lib/codex-cli';
import { parseAuthState, type AuthState } from '@/lib/oauth-status';
import type { ProviderId } from '@/types';

const ANTHROPIC_VERSION = '2023-06-01';

function boolToAuthState(value: boolean | undefined): AuthState {
  if (value === true) return 'authenticated';
  if (value === false) return 'not_authenticated';
  return 'unknown';
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { provider } = body;
    const authMode = body.authMode;
    let { apiKey, model, baseUrl } = body;

    if (!provider || typeof provider !== 'string') {
      return NextResponse.json({ ok: false, error: 'Missing provider' }, { status: 400 });
    }

    const preset = getProviderPreset(provider as ProviderId);
    const providerId = provider as ProviderId;

    // OAuth providers: test by checking CLI auth status.
    if (authMode === 'oauth') {
      if (provider === 'anthropic') {
        try {
          const { stdout, stderr } = await execClaude(['auth', 'status', '--json'], {
            timeout: 8_000,
            env: { ...process.env },
          });
          let authState: AuthState = 'unknown';
          try {
            const parsed = JSON.parse(stdout) as { loggedIn?: boolean; authenticated?: boolean };
            authState = boolToAuthState(parsed.loggedIn ?? parsed.authenticated);
          } catch {
            authState = parseAuthState(`${stdout}${stderr}`);
          }
          if (authState === 'authenticated') {
            return NextResponse.json({ ok: true });
          }
          if (authState === 'unknown') {
            return NextResponse.json({ ok: false, error: 'Anthropic OAuth 状态不确定，请重新登录' }, { status: 400 });
          }
          return NextResponse.json({ ok: false, error: 'Anthropic OAuth 未认证' }, { status: 400 });
        } catch (err) {
          return NextResponse.json(
            { ok: false, error: err instanceof Error ? err.message : 'Anthropic OAuth 检查失败' },
            { status: 500 },
          );
        }
      }

      if (provider === 'openai') {
        try {
          const { stdout, stderr } = await execCodex(['login', 'status'], {
            timeout: 8_000,
            env: { ...process.env },
          });
          const authState = parseAuthState(`${stdout}${stderr}`);
          if (authState === 'authenticated') {
            return NextResponse.json({ ok: true });
          }
          if (authState === 'unknown') {
            return NextResponse.json({ ok: false, error: 'OpenAI/Codex OAuth 状态不确定，请重新登录' }, { status: 400 });
          }
          return NextResponse.json({ ok: false, error: 'OpenAI/Codex OAuth 未认证' }, { status: 400 });
        } catch (err) {
          return NextResponse.json(
            { ok: false, error: err instanceof Error ? err.message : 'OpenAI/Codex OAuth 检查失败' },
            { status: 500 },
          );
        }
      }

      {
        return NextResponse.json(
          { ok: false, error: `${provider} 不支持 OAuth，请改用 API Key` },
          { status: 400 },
        );
      }
    }

    // 掩码回传或未传 key 时，尝试回填已保存配置
    if ((typeof apiKey === 'string' && apiKey.startsWith('••')) || !apiKey) {
      const settings = await getSettings();
      const scopedKey = settings.claude.providerApiKeys?.[providerId];
      const scopedModel = settings.claude.providerModels?.[providerId];
      const isActiveProvider = settings.claude.provider === provider;

      if (scopedKey) {
        apiKey = scopedKey;
      } else if (isActiveProvider && settings.claude.apiKey) {
        apiKey = settings.claude.apiKey;
      }

      if (!model) {
        model = scopedModel || (isActiveProvider ? settings.claude.model : model);
      }

      // baseUrl 是全局字段，仅在当前激活 provider 匹配时回填，避免误用其他 provider 的地址
      if (!baseUrl && isActiveProvider && settings.claude.baseUrl) {
        baseUrl = settings.claude.baseUrl;
      }
    }

    // Ollama: 无认证，直接请求 /api/tags
    if (provider === 'ollama') {
      const url = (baseUrl || preset.baseUrl || 'http://localhost:11434').replace(/\/$/, '') + '/api/tags';
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
    }

    // 其他供应商：需要 API Key
    const key = typeof apiKey === 'string' ? apiKey.trim() : '';
    if (!key || key.startsWith('••')) {
      return NextResponse.json({ ok: false, error: '请先填写 API 密钥' }, { status: 400 });
    }

    const effectiveBaseUrl = baseUrl || preset.baseUrl;
    if (!effectiveBaseUrl && provider !== 'anthropic') {
      return NextResponse.json({ ok: false, error: '缺少 API 地址' }, { status: 400 });
    }

    const messagesUrl = (() => {
      const base = (provider === 'anthropic' ? baseUrl || 'https://api.anthropic.com' : effectiveBaseUrl)!.replace(/\/$/, '');
      return base.endsWith('/v1') ? `${base}/messages` : `${base}/v1/messages`;
    })();

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'anthropic-version': ANTHROPIC_VERSION,
      ...(preset.useApiKeyForAuth ? { 'x-api-key': key } : { Authorization: `Bearer ${key}` }),
    };

    const res = await fetch(messagesUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: model || preset.models[0]?.id || 'claude-sonnet-4-5-20250929',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Hi' }],
      }),
      signal: AbortSignal.timeout(60000),
    });

    if (!res.ok) {
      const errBody = await res.text();
      let errMsg = errBody;
      try {
        const parsed = JSON.parse(errBody);
        errMsg = parsed.error?.message || parsed.message || errBody;
      } catch {
        // use raw body
      }
      return NextResponse.json({
        ok: false,
        error: errMsg || `HTTP ${res.status}`,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const isTimeout = errMsg.includes('timeout') || errMsg.includes('abort');
    return NextResponse.json({
      ok: false,
      error: isTimeout ? '请求超时，请检查网络或 API 地址' : errMsg,
    });
  }
}
