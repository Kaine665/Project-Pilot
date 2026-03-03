import { NextResponse } from 'next/server';
import { execClaude } from '@/lib/claude-cli';
import { execCodex } from '@/lib/codex-cli';
import { parseAuthState, type AuthState } from '@/lib/oauth-status';
import type { ProviderId } from '@/types';

/**
 * GET /api/settings/auth-status
 * 检查 Claude CLI OAuth 登录状态。
 */
function parseProvider(value: string | null): ProviderId {
  if (value === 'openai') return 'openai';
  if (value === 'anthropic') return 'anthropic';
  return 'anthropic';
}

function boolToAuthState(value: boolean | undefined): AuthState {
  if (value === true) return 'authenticated';
  if (value === false) return 'not_authenticated';
  return 'unknown';
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const provider = parseProvider(searchParams.get('provider'));

  if (provider === 'openai') {
    try {
      const { stdout, stderr } = await execCodex(['login', 'status'], {
        timeout: 10_000,
        env: { ...process.env },
      });

      const raw = `${stdout}${stderr}`.trim();
      const authState = parseAuthState(raw);
      return NextResponse.json({
        provider,
        authState,
        authenticated: authState === 'authenticated',
        rawOutput: raw,
      });
    } catch (err) {
      const e = err as Error & { stdout?: string; stderr?: string };
      const raw = `${e.stdout ?? ''}${e.stderr ?? ''}`.trim();
      const authState = parseAuthState(raw || e.message || '');
      return NextResponse.json({
        provider,
        authState,
        authenticated: authState === 'authenticated',
        rawOutput: raw || e.message || 'Unknown error',
      });
    }
  }

  try {
    const { stdout, stderr } = await execClaude(['auth', 'status', '--json'], {
      timeout: 10_000,
      env: { ...process.env },
    });

    const raw = (stdout || stderr || '').trim();
    let authState: AuthState = 'unknown';

    try {
      const parsed = JSON.parse(raw) as { loggedIn?: boolean; authenticated?: boolean };
      authState = boolToAuthState(parsed.loggedIn ?? parsed.authenticated);
    } catch {
      authState = parseAuthState(`${stdout}${stderr}`);
    }

    return NextResponse.json({
      provider,
      authState,
      authenticated: authState === 'authenticated',
      rawOutput: raw,
    });
  } catch (err) {
    const e = err as Error & { stdout?: string; stderr?: string };
    const raw = `${e.stdout ?? ''}${e.stderr ?? ''}`.trim();

    // Some Claude CLI versions may still return useful stdout on non-zero exit.
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as { loggedIn?: boolean; authenticated?: boolean };
        const authState = boolToAuthState(parsed.loggedIn ?? parsed.authenticated);
        return NextResponse.json({
          provider,
          authState,
          authenticated: authState === 'authenticated',
          rawOutput: raw,
        });
      } catch {
        const authState = parseAuthState(raw);
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
      authState: 'unknown' as const,
      authenticated: false,
      error: e.message || 'Unknown error',
    });
  }
}
