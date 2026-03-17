import { NextResponse } from 'next/server';
import { extractAuthCode, exchangeCodeForTokens, saveTokens } from '@/lib/oauth-flow';
import {
  getPkceSession,
  setPkceSession,
  getLoginProvider,
  setLoginProvider,
} from '@/lib/auth-login-state';
import { setCredential } from '@/lib/settings-manager';
import path from 'path';
import os from 'os';

/**
 * POST /api/settings/auth-code
 * 用户从浏览器授权页复制的授权码，后端用 PKCE code_verifier 交换 token。
 *
 * Body: { code: string }
 */
export async function POST(req: Request) {
  const { code } = await req.json() as { code?: string };

  const extracted = extractAuthCode(code ?? '');
  if (!extracted) {
    return NextResponse.json({ error: 'code is required' }, { status: 400 });
  }

  const provider = getLoginProvider();

  // 仅 Anthropic 支持 PKCE 代码提交
  if (provider && provider !== 'anthropic') {
    return NextResponse.json(
      { error: `Manual code submission is not supported for ${provider}. Use the device code flow instead.` },
      { status: 400 },
    );
  }

  const session = getPkceSession();
  if (!session) {
    return NextResponse.json(
      { error: 'No active OAuth session. Please click "Login" first.' },
      { status: 409 },
    );
  }

  // 会话超时检查（10 分钟）
  if (Date.now() - session.createdAt > 10 * 60 * 1000) {
    setPkceSession(null);
    setLoginProvider(null);
    return NextResponse.json(
      { error: 'OAuth session expired. Please click "Login" to start a new session.' },
      { status: 410 },
    );
  }

  try {
    const tokens = await exchangeCodeForTokens(extracted, session.codeVerifier);
    saveTokens(tokens);

    // 同步更新 providerCredentials
    await setCredential('anthropic', {
      authMode: 'oauth',
      oauth: {
        tokenFile: path.join(os.homedir(), '.claude', '.credentials.json'),
        lastStatus: 'authenticated',
        lastCheckedAt: Date.now(),
      },
      lastVerifiedAt: Date.now(),
    });

    // 清理 PKCE 状态
    setPkceSession(null);
    setLoginProvider(null);

    return NextResponse.json({
      success: true,
      message: 'Authentication successful. Tokens saved.',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Token exchange failed';

    // 授权码一次性使用 — 如果交换失败，需要重新登录
    if (msg.includes('invalid_grant') || msg.includes('expired')) {
      setPkceSession(null);
      setLoginProvider(null);
      return NextResponse.json(
        { error: 'Authorization code expired or already used. Please click "Login" to try again.' },
        { status: 400 },
      );
    }

    return NextResponse.json(
      { error: msg },
      { status: 500 },
    );
  }
}
