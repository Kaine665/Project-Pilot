import { NextRequest, NextResponse } from 'next/server';
import { spawnClaude } from '@/lib/claude-cli';
import {
  loginProcess as currentProcess,
  setLoginProcess,
  setCapturedLoginUrl,
  setCapturedLoginCode,
  setLoginProvider,
  loginProvider as currentLoginProvider,
} from '@/lib/auth-login-state';
import type { ProviderId } from '@/types';

/** 从 CLI 输出中提取 OAuth URL */
function extractOAuthUrl(text: string): string | null {
  const visitMatch = text.match(/visit:\s*(https:\/\/[^\s]+)/i);
  if (visitMatch) return visitMatch[1].trim();
  const urlMatch = text.match(/https:\/\/claude\.ai\/oauth\/authorize\?[^\s]+/);
  if (urlMatch) return urlMatch[0].trim();
  // OpenAI device flow URL
  const openaiMatch = text.match(/https:\/\/auth\.openai\.com\/[^\s]+/);
  if (openaiMatch) return openaiMatch[0].trim();
  return null;
}

/** 从 Codex 输出中提取 device code */
function extractDeviceCode(text: string): string | null {
  // Codex outputs something like "Enter code: XXXX-XXXX" or "code: XXXX-XXXX"
  const match = text.match(/code[:\s]+([A-Z0-9]{4}-[A-Z0-9]{4})/i);
  return match ? match[1].toUpperCase() : null;
}

/**
 * POST /api/settings/auth-login
 * 启动 OAuth 登录流程。
 *
 * Body: { provider?: ProviderId }
 *
 * - anthropic: `claude auth login`（BROWSER=echo 捕获 URL）
 * - openai: `codex login`（捕获 device code）
 */
export async function POST(request: NextRequest) {
  let provider: ProviderId = 'anthropic';
  try {
    const body = await request.json().catch(() => ({}));
    if (body.provider && typeof body.provider === 'string') {
      provider = body.provider as ProviderId;
    }
  } catch { /* use default */ }

  // 防止不同 provider 的并发登录
  if (currentProcess && !currentProcess.killed) {
    if (currentLoginProvider && currentLoginProvider !== provider) {
      return NextResponse.json(
        { error: `Another login (${currentLoginProvider}) is already in progress.` },
        { status: 409 },
      );
    }
    return NextResponse.json({
      success: true,
      message: 'Login already in progress.',
    });
  }

  try {
    setCapturedLoginUrl(null);
    setCapturedLoginCode(null);
    setLoginProvider(provider);

    if (provider === 'openai') {
      return await startOpenAILogin();
    }

    return await startAnthropicLogin();
  } catch (err) {
    setLoginProcess(null);
    setCapturedLoginUrl(null);
    setCapturedLoginCode(null);
    setLoginProvider(null);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to start login' },
      { status: 500 },
    );
  }
}

async function startAnthropicLogin(): Promise<NextResponse> {
  const env = { ...process.env, BROWSER: 'echo' };
  const child = spawnClaude(['auth', 'login'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env,
  });

  setLoginProcess(child);

  let buffer = '';
  const collect = (chunk: Buffer) => {
    buffer += chunk.toString();
    const url = extractOAuthUrl(buffer);
    if (url) setCapturedLoginUrl(url);
  };

  child.stdout?.on('data', collect);
  child.stderr?.on('data', collect);

  child.on('exit', () => { setLoginProcess(null); });
  child.on('error', () => { setLoginProcess(null); });

  return NextResponse.json({
    success: true,
    message: 'Login started. Poll /api/settings/auth-url for the link.',
  });
}

async function startOpenAILogin(): Promise<NextResponse> {
  try {
    const { spawnCodex } = await import('@/lib/codex-cli');
    const child = spawnCodex(['login'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, BROWSER: 'echo' },
    });

    setLoginProcess(child);

    let buffer = '';
    const collect = (chunk: Buffer) => {
      buffer += chunk.toString();
      const url = extractOAuthUrl(buffer);
      if (url) setCapturedLoginUrl(url);
      const code = extractDeviceCode(buffer);
      if (code) setCapturedLoginCode(code);
    };

    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);

    child.on('exit', () => { setLoginProcess(null); });
    child.on('error', () => { setLoginProcess(null); });

    return NextResponse.json({
      success: true,
      message: 'OpenAI login started. Poll /api/settings/auth-url for the device code.',
    });
  } catch {
    setLoginProvider(null);
    return NextResponse.json(
      { error: 'Codex CLI not available. Install @openai/codex globally.' },
      { status: 500 },
    );
  }
}
