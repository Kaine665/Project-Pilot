import { NextRequest, NextResponse } from 'next/server';
import { checkAuthFromCredentials } from '@/lib/oauth-flow';
import { parseAuthState, type AuthState } from '@/lib/oauth-status';
import type { ProviderId } from '@/types';

/**
 * GET /api/settings/auth-status?provider=anthropic
 * 检查 OAuth 登录状态。
 *
 * - anthropic: 直接读取 ~/.claude/.credentials.json（不依赖 CLI 子进程）
 * - openai: `codex login status` (当 codex-cli 可用时)
 * - 其他: 不支持 OAuth，返回 unknown
 */
export async function GET(request: NextRequest) {
  const provider = (request.nextUrl.searchParams.get('provider') ?? 'anthropic') as ProviderId;

  if (provider === 'openai') {
    return checkOpenAIStatus(provider);
  }

  if (provider !== 'anthropic') {
    return NextResponse.json({
      provider,
      authState: 'unknown' as AuthState,
      authenticated: false,
      error: `OAuth not supported for provider: ${provider}`,
    });
  }

  // Anthropic: 直接读取 credentials 文件
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
        return NextResponse.json({ provider, authState, authenticated: authState === 'authenticated', rawOutput: raw });
      }
    }
    return NextResponse.json({
      provider,
      authState: 'unknown' as AuthState,
      authenticated: false,
      error: e.message || 'Codex CLI not available',
    });
  }
}
