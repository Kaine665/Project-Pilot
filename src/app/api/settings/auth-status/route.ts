import { NextRequest, NextResponse } from 'next/server';
import { checkAuthFromCredentials } from '@/lib/oauth-flow';
import { parseAuthState, type AuthState } from '@/lib/oauth-status';
import { getSettings, getCredential, getEffectiveAuthMode } from '@/lib/settings-manager';
import type { ProviderId } from '@/types';

/**
 * GET /api/settings/auth-status?provider=anthropic
 * 检查认证状态。
 *
 * - anthropic (oauth): 直接读取 ~/.claude/.credentials.json
 * - openai (oauth): `codex login status`
 * - api_key 模式（任何供应商）: 检查是否有 API Key
 */
export async function GET(request: NextRequest) {
  const provider = (request.nextUrl.searchParams.get('provider') ?? 'anthropic') as ProviderId;

  const settings = await getSettings();
  const claude = settings.claude;
  const authMode = getEffectiveAuthMode(claude, provider);
  const cred = getCredential(claude, provider);

  // api_key 模式：直接检查是否配置了 API Key
  if (authMode === 'api_key') {
    const hasKey = Boolean(cred.apiKey);
    return NextResponse.json({
      provider,
      authMode: 'api_key',
      authState: (hasKey ? 'authenticated' : 'not_authenticated') as AuthState,
      authenticated: hasKey,
      hasApiKey: hasKey,
    });
  }

  // OAuth 模式
  if (provider === 'openai') {
    return checkOpenAIStatus(provider);
  }

  if (provider !== 'anthropic') {
    return NextResponse.json({
      provider,
      authMode,
      authState: 'unknown' as AuthState,
      authenticated: false,
      error: `OAuth not supported for provider: ${provider}`,
    });
  }

  // Anthropic OAuth: 直接读取 credentials 文件
  const status = checkAuthFromCredentials();

  let authState: AuthState;
  if (status.authenticated) {
    authState = 'authenticated';
  } else if (status.expired) {
    authState = 'not_authenticated'; // token 过期，需要刷新或重新登录
  } else {
    authState = 'not_authenticated';
  }

  return NextResponse.json({
    provider,
    authMode,
    authState,
    authenticated: status.authenticated,
    expired: status.expired,
    expiresAt: status.expiresAt,
  });
}

async function checkOpenAIStatus(provider: ProviderId) {
  try {
    const { execCodex } = await import('@/lib/codex-cli');
    const { stdout, stderr } = await execCodex(['login', 'status'], { timeout: 15_000 });
    const raw = (stdout + stderr).trim();
    const authState: AuthState = parseAuthState(raw);
    return NextResponse.json({
      provider,
      authMode: 'oauth',
      authState,
      authenticated: authState === 'authenticated',
      rawOutput: raw,
    });
  } catch (err) {
    const e = err as Error & { stdout?: string; stderr?: string };
    const raw = ((e.stdout ?? '') + (e.stderr ?? '')).trim();
    if (raw) {
      const authState: AuthState = parseAuthState(raw);
      if (authState !== 'unknown') {
        return NextResponse.json({ provider, authMode: 'oauth', authState, authenticated: authState === 'authenticated', rawOutput: raw });
      }
    }
    return NextResponse.json({
      provider,
      authMode: 'oauth',
      authState: 'unknown' as AuthState,
      authenticated: false,
      error: e.message || 'Codex CLI not available',
    });
  }
}
