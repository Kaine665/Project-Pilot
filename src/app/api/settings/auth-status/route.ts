import { NextRequest, NextResponse } from 'next/server';
import { execClaude } from '@/lib/claude-cli';
import { parseAuthState, type AuthState } from '@/lib/oauth-status';
import type { ProviderId } from '@/types';

/**
 * GET /api/settings/auth-status?provider=anthropic
 * 检查 CLI OAuth 登录状态。
 *
 * - anthropic: `claude auth status --json`
 * - openai: `codex login status` (当 codex-cli 可用时)
 * - 其他: 不支持 OAuth，返回 unknown
 */
export async function GET(request: NextRequest) {
  const provider = (request.nextUrl.searchParams.get('provider') ?? 'anthropic') as ProviderId;

  if (provider === 'openai') {
    // OpenAI Codex OAuth 检查 — 动态导入避免未安装时报错
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

  if (provider !== 'anthropic') {
    return NextResponse.json({
      provider,
      authState: 'unknown' as AuthState,
      authenticated: false,
      error: `OAuth not supported for provider: ${provider}`,
    });
  }

  // Anthropic: claude auth status
  try {
    const { stdout, stderr } = await execClaude(['auth', 'status', '--json'], { timeout: 15_000 });
    const raw = (stdout + stderr).trim();
    const authState: AuthState = parseAuthState(raw);
    return NextResponse.json({
      provider,
      authState,
      authenticated: authState === 'authenticated',
      rawOutput: raw,
    });
  } catch (err) {
    // CLI 可能 exit code 非零但 stdout 仍有有效输出（如 credentials 异常但仍可解析状态）
    const e = err as Error & { stdout?: string; stderr?: string };
    const raw = ((e.stdout ?? '') + (e.stderr ?? '')).trim();
    if (raw) {
      const authState: AuthState = parseAuthState(raw);
      if (authState !== 'unknown') {
        return NextResponse.json({
          provider,
          authState,
          authenticated: authState === 'authenticated',
          rawOutput: raw,
        });
      }
    }
    return NextResponse.json({
      provider,
      authState: 'unknown' as AuthState,
      authenticated: false,
      error: e.message || 'Unknown error',
    });
  }
}
