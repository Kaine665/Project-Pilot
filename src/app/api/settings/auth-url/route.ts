import { NextResponse } from 'next/server';
import { capturedLoginCode, capturedLoginUrl, loginProcess, loginProvider } from '@/lib/auth-login-state';
import type { ProviderId } from '@/types';

/**
 * GET /api/settings/auth-url
 * 前端轮询此接口，获取 claude auth login 输出的 OAuth URL。
 */
function parseProvider(value: string | null): ProviderId {
  if (value === 'openai') return 'openai';
  if (value === 'anthropic') return 'anthropic';
  return 'anthropic';
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const provider = parseProvider(searchParams.get('provider'));
  const providerMatches = !loginProvider || loginProvider === provider;
  const loginUrl =
    providerMatches
      ? (capturedLoginUrl || (provider === 'openai' ? 'https://auth.openai.com/codex/device' : null))
      : null;

  return NextResponse.json({
    provider: loginProvider,
    loginUrl,
    loginCode: providerMatches ? capturedLoginCode : null,
    processAlive: !!(loginProcess && !loginProcess.killed && providerMatches),
  });
}
