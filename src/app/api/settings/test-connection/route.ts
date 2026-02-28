/**
 * POST /api/settings/test-connection
 *
 * 测试当前 AI 配置是否可用。
 * 使用表单中的配置（或已保存的配置，当 apiKey 为掩码时）发起一次最小请求。
 */

import { NextRequest, NextResponse } from 'next/server';
import { getProviderPreset } from '@/lib/provider-registry';
import { getSettings } from '@/lib/settings-manager';
import type { ProviderId } from '@/types';

const ANTHROPIC_VERSION = '2023-06-01';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    let { provider, apiKey, model, baseUrl } = body;

    if (!provider || typeof provider !== 'string') {
      return NextResponse.json({ ok: false, error: 'Missing provider' }, { status: 400 });
    }

    const preset = getProviderPreset(provider as ProviderId);

    // 掩码回传时使用已保存的配置
    if (typeof apiKey === 'string' && apiKey.startsWith('••')) {
      const settings = await getSettings();
      if (settings.claude.provider === provider && settings.claude.apiKey) {
        apiKey = settings.claude.apiKey;
        if (!model) model = settings.claude.model;
        if (!baseUrl && settings.claude.baseUrl) baseUrl = settings.claude.baseUrl;
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
      signal: AbortSignal.timeout(15000),
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
