import { NextRequest, NextResponse } from 'next/server';
import { createOAuthSession } from '@/lib/oauth-flow';
import {
  getPkceSession,
  setPkceSession,
  getLoginProvider,
  setLoginProvider,
  getLoginProcess,
  setLoginProcess,
  setCapturedLoginUrl,
  setCapturedLoginCode,
} from '@/lib/auth-login-state';
import type { ProviderId } from '@/types';

/** 从 CLI 输出中提取 OAuth URL（仅用于 OpenAI 流程） */
function extractOAuthUrl(text: string): string | null {
  const httpsMatch = text.match(/https:\/\/[^\s"')\]]+/g);
  if (httpsMatch) {
    const authUrl = httpsMatch.find((u) => u.includes('auth.openai.com'));
    if (authUrl) return authUrl.trim();
  }
  return null;
}

/** 从 Codex 输出中提取 device code */
function extractDeviceCode(text: string): string | null {
  const patterns = [
    /(?:code|enter)[:\s]+([A-Z0-9]{4,6}-[A-Z0-9]{4,8})/i,
    /([A-Z0-9]{4,6}-[A-Z0-9]{4,8})(?:\s|$|\.)/,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return m[1].toUpperCase();
  }
  return null;
}

/**
 * POST /api/settings/auth-login
 * 启动 OAuth 登录流程。
 *
 * Body: { provider?: ProviderId }
 *
 * - anthropic: 自主 PKCE 流程（不依赖 CLI）
 * - openai: `codex login`（捕获 device code，保持原逻辑）
 */
export async function POST(request: NextRequest) {
  let provider: ProviderId = 'anthropic';
  try {
    const body = await request.json().catch(() => ({}));
    if (body.provider && typeof body.provider === 'string') {
      provider = body.provider as ProviderId;
    }
  } catch { /* use default */ }

  const currentProvider = getLoginProvider();
  const currentProcess = getLoginProcess();

  // 防止不同 provider 的并发登录
  if (currentProvider && currentProvider !== provider) {
    if (provider === 'openai' || currentProvider === 'openai') {
      // OpenAI 流程有子进程
      if (currentProcess && !currentProcess.killed) {
        return NextResponse.json(
          { error: `Another login (${currentProvider}) is already in progress.` },
          { status: 409 },
        );
      }
    }
    if (getPkceSession()) {
      return NextResponse.json(
        { error: `Another login (${currentProvider}) is already in progress.` },
        { status: 409 },
      );
    }
  }

  // 同 provider 重新请求：清理旧状态
  if (currentProcess && !currentProcess.killed) {
    try { currentProcess.kill(); } catch { /* ignore */ }
    setLoginProcess(null);
  }
  setPkceSession(null);
  setCapturedLoginUrl(null);
  setCapturedLoginCode(null);

  try {
    setLoginProvider(provider);

    if (provider === 'openai') {
      return await startOpenAILogin();
    }

    return startAnthropicLogin();
  } catch (err) {
    setLoginProcess(null);
    setPkceSession(null);
    setCapturedLoginUrl(null);
    setCapturedLoginCode(null);
    setLoginProvider(null);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to start login' },
      { status: 500 },
    );
  }
}

/**
 * Anthropic: 自主 PKCE OAuth 流程。
 * 生成 PKCE + authorize URL，前端显示给用户。
 * 用户在浏览器完成授权后，复制代码提交到 auth-code 端点。
 */
function startAnthropicLogin(): NextResponse {
  const session = createOAuthSession();
  setPkceSession(session);

  return NextResponse.json({
    success: true,
    loginUrl: session.authorizeUrl,
    message: 'OAuth session created. Open the URL and paste the authorization code.',
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
