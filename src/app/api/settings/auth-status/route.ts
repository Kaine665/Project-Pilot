import { NextResponse } from 'next/server';
import { execClaude } from '@/lib/claude-cli';
import { execCodex } from '@/lib/codex-cli';
import { parseAuthStatusText } from '@/lib/oauth-status';
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
      return NextResponse.json({
        provider,
        authenticated: parseAuthStatusText(raw),
        rawOutput: raw,
      });
    } catch (err) {
      const e = err as Error & { stdout?: string; stderr?: string };
      const raw = `${e.stdout ?? ''}${e.stderr ?? ''}`.trim();
      return NextResponse.json({
        provider,
        authenticated: parseAuthStatusText(raw),
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
    let isLoggedIn = false;

    try {
      const parsed = JSON.parse(raw) as { loggedIn?: boolean; authenticated?: boolean };
      isLoggedIn = !!(parsed.loggedIn ?? parsed.authenticated);
    } catch {
      isLoggedIn = parseAuthStatusText(`${stdout}${stderr}`);
    }

    return NextResponse.json({
      provider,
      authenticated: isLoggedIn,
      rawOutput: raw,
    });
  } catch (err) {
    const e = err as Error & { stdout?: string; stderr?: string };
    const raw = `${e.stdout ?? ''}${e.stderr ?? ''}`.trim();

    // Some Claude CLI versions may still return useful stdout on non-zero exit.
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as { loggedIn?: boolean; authenticated?: boolean };
        return NextResponse.json({
          provider,
          authenticated: !!(parsed.loggedIn ?? parsed.authenticated),
          rawOutput: raw,
        });
      } catch {
        return NextResponse.json({
          provider,
          authenticated: parseAuthStatusText(raw),
          rawOutput: raw,
        });
      }
    }

    return NextResponse.json({
      provider,
      authenticated: false,
      error: e.message || 'Unknown error',
    });
  }
}
