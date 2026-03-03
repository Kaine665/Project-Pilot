import { NextResponse } from 'next/server';
import { execClaude, spawnClaude } from '@/lib/claude-cli';
import { execCodex, spawnCodex } from '@/lib/codex-cli';
import { parseAuthState, sanitizeAuthText } from '@/lib/oauth-status';
import {
  capturedLoginUrl,
  capturedLoginCode,
  loginProcess,
  loginProvider,
  setCapturedLoginUrl,
  setCapturedLoginCode,
  setLoginProcess,
  setLoginProvider,
} from '@/lib/auth-login-state';
import type { ProviderId } from '@/types';

/**
 * POST /api/settings/auth-login
 * 启动 OAuth 登录流程并缓存 URL/设备码供前端轮询。
 */

const LOGIN_URL_REGEX = /https:\/\/[^\s"'<>]+/g;
const DEVICE_CODE_REGEX = /\b[A-Z0-9]{4,}-[A-Z0-9]{4,}(?:-[A-Z0-9]{4,})*\b/g;

function normalizeLoginUrl(url: string): string {
  return url.replace(/[)\].,;]+$/, '');
}

function isOAuthProvider(provider: ProviderId): provider is 'anthropic' | 'openai' {
  return provider === 'anthropic' || provider === 'openai';
}

function parseProvider(value: unknown): ProviderId {
  if (
    value === 'anthropic' || value === 'openai' || value === 'deepseek'
    || value === 'kimi' || value === 'qwen' || value === 'zhipu'
    || value === 'minimax' || value === 'openrouter' || value === 'ollama'
    || value === 'custom'
  ) {
    return value;
  }
  return 'anthropic';
}

type OpenAILoginMode = 'browser' | 'device';

function parseOpenAILoginMode(value: unknown): OpenAILoginMode {
  return value === 'device' ? 'device' : 'browser';
}

function extractLoginUrl(text: string, provider: 'anthropic' | 'openai'): string | null {
  const clean = sanitizeAuthText(text);
  const matches = clean.match(LOGIN_URL_REGEX);
  if (!matches || matches.length === 0) return null;

  if (provider === 'anthropic') {
    const picked = matches.find((u) => u.includes('anthropic') || u.includes('claude.ai')) || matches[0];
    return normalizeLoginUrl(picked);
  }

  const picked = matches.find((u) => u.includes('auth.openai.com')) || matches[0];
  return normalizeLoginUrl(picked);
}

function extractLoginCode(text: string): string | null {
  const clean = sanitizeAuthText(text);
  const matches = clean.match(DEVICE_CODE_REGEX);
  if (!matches || matches.length === 0) return null;
  return matches[0];
}

async function isAlreadyAuthenticated(provider: 'anthropic' | 'openai'): Promise<boolean> {
  if (provider === 'anthropic') {
    const { stdout, stderr } = await execClaude(['auth', 'status', '--json'], {
      timeout: 5_000,
      env: { ...process.env },
    });
    try {
      const parsed = JSON.parse(stdout) as { loggedIn?: boolean; authenticated?: boolean };
      return !!(parsed.loggedIn ?? parsed.authenticated);
    } catch {
      return parseAuthState(`${stdout}\n${stderr}`) === 'authenticated';
    }
  }

  const { stdout, stderr } = await execCodex(['login', 'status'], {
    timeout: 10_000,
    env: { ...process.env },
  });
  return parseAuthState(`${stdout}\n${stderr}`) === 'authenticated';
}

function formatCommandError(err: unknown): string {
  const e = err as Error & { stdout?: string; stderr?: string };
  return sanitizeAuthText(`${e.stdout ?? ''}\n${e.stderr ?? ''}\n${e.message ?? ''}`).trim();
}

async function forceOpenAILogout(): Promise<{ success: boolean; details?: string }> {
  let logoutError = '';
  try {
    await execCodex(['logout'], {
      timeout: 10_000,
      env: { ...process.env },
    });
  } catch (err) {
    logoutError = formatCommandError(err);
  }

  try {
    if (await isAlreadyAuthenticated('openai')) {
      return {
        success: false,
        details: logoutError || 'OpenAI session is still authenticated after logout attempt.',
      };
    }
  } catch {
    // If status check fails, keep best-effort behavior and continue login flow.
  }

  return { success: true, details: logoutError || undefined };
}

async function waitForLoginArtifacts(
  timeoutMs: number,
  provider: 'anthropic' | 'openai',
): Promise<{ loginUrl: string | null; loginCode: string | null }> {
  if (loginProvider === provider && (capturedLoginUrl || capturedLoginCode)) {
    return { loginUrl: capturedLoginUrl, loginCode: capturedLoginCode };
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (loginProvider === provider && (capturedLoginUrl || capturedLoginCode)) {
      return { loginUrl: capturedLoginUrl, loginCode: capturedLoginCode };
    }
    if (!loginProcess || loginProcess.killed) break;
    await new Promise((resolve) => setTimeout(resolve, 120));
  }

  return {
    loginUrl: loginProvider === provider ? capturedLoginUrl : null,
    loginCode: loginProvider === provider ? capturedLoginCode : null,
  };
}

export async function POST(req: Request) {
  let provider: ProviderId = 'anthropic';
  let forceLogin = false;
  let openaiLoginMode: OpenAILoginMode = 'browser';
  try {
    const body = await req.json() as { provider?: ProviderId; force?: boolean; openaiLoginMode?: OpenAILoginMode };
    provider = parseProvider(body?.provider);
    forceLogin = body?.force === true;
    openaiLoginMode = parseOpenAILoginMode(body?.openaiLoginMode);
  } catch {
    provider = 'anthropic';
    forceLogin = false;
    openaiLoginMode = 'browser';
  }

  if (!isOAuthProvider(provider)) {
    return NextResponse.json(
      { error: `Provider ${provider} does not support OAuth login.` },
      { status: 400 },
    );
  }
  const oauthProvider: 'anthropic' | 'openai' = provider;

  if (!forceLogin) {
    try {
      if (await isAlreadyAuthenticated(oauthProvider)) {
        return NextResponse.json({
          success: true,
          alreadyAuthenticated: true,
          provider: oauthProvider,
          message: 'Already authenticated.',
        });
      }
    } catch {
      // Ignore status check failures; continue login flow.
    }
  }

  if (loginProcess && !loginProcess.killed) {
    if (loginProvider && loginProvider !== oauthProvider) {
      return NextResponse.json(
        {
          error: `OAuth login is already running for provider: ${loginProvider}`,
          provider: loginProvider,
        },
        { status: 409 },
      );
    }
    return NextResponse.json({
      success: true,
      provider: oauthProvider,
      message: 'Login already in progress.',
      loginUrl: capturedLoginUrl,
      loginCode: capturedLoginCode,
    });
  }

  try {
    if (forceLogin && oauthProvider === 'openai') {
      const logout = await forceOpenAILogout();
      if (!logout.success) {
        return NextResponse.json(
          {
            error: 'OpenAI CLI is still logged in. Run `codex logout` and retry.',
            provider: oauthProvider,
            details: logout.details ?? 'Unable to clear existing OpenAI session.',
          },
          { status: 409 },
        );
      }
    }

    setCapturedLoginUrl(null);
    setCapturedLoginCode(null);
    setLoginProvider(oauthProvider);

    const openaiArgs = openaiLoginMode === 'device' ? ['login', '--device-auth'] : ['login'];
    const child = oauthProvider === 'anthropic'
      ? spawnClaude(['auth', 'login'], {
          detached: false,
          stdio: ['pipe', 'pipe', 'pipe'],
          shell: false,
          windowsHide: true,
          env: { ...process.env },
        })
      : spawnCodex(openaiArgs, {
          detached: false,
          stdio: ['pipe', 'pipe', 'pipe'],
          shell: false,
          windowsHide: true,
          env: { ...process.env },
        });

    setLoginProcess(child);
    let stderrPreview = '';
    let exited = false;
    let exitCode: number | null = null;

    const parseChunk = (chunk: Buffer) => {
      const text = sanitizeAuthText(chunk.toString('utf-8'));
      const url = extractLoginUrl(text, oauthProvider);
      if (url) {
        setCapturedLoginUrl(url);
      }
      if (oauthProvider === 'openai') {
        const code = extractLoginCode(text);
        if (code) {
          setCapturedLoginCode(code);
        }
      }
      return text;
    };

    child.stdout?.on('data', (chunk: Buffer) => { parseChunk(chunk); });
    child.stderr?.on('data', (chunk: Buffer) => {
      const text = parseChunk(chunk);
      stderrPreview += text;
      if (stderrPreview.length > 1200) {
        stderrPreview = stderrPreview.slice(-1200);
      }
    });

    child.on('exit', (code: number | null) => {
      exited = true;
      exitCode = code;
      setLoginProcess(null);
    });
    child.on('error', () => {
      setLoginProcess(null);
    });

    const waitTimeoutMs = oauthProvider === 'openai' ? 12_000 : 2_500;
    const { loginUrl: rawLoginUrl, loginCode } = await waitForLoginArtifacts(waitTimeoutMs, oauthProvider);
    if (!rawLoginUrl && !loginCode && exited && exitCode !== 0) {
      if (oauthProvider === 'openai') {
        try {
          if (await isAlreadyAuthenticated('openai')) {
            return NextResponse.json({
              success: true,
              alreadyAuthenticated: true,
              provider: oauthProvider,
              message: 'Already authenticated.',
            });
          }
        } catch {
          // ignore status check failure and fall through to error
        }
      }

      setCapturedLoginUrl(null);
      setCapturedLoginCode(null);
      return NextResponse.json(
        {
          error: `${oauthProvider} login process exited before producing auth data.`,
          provider: oauthProvider,
          details: stderrPreview.trim() || `exit code ${exitCode}`,
        },
        { status: 500 },
      );
    }

    if (oauthProvider === 'openai' && openaiLoginMode === 'device' && !loginCode) {
      try {
        if (await isAlreadyAuthenticated('openai')) {
          return NextResponse.json({
            success: true,
            alreadyAuthenticated: true,
            provider: oauthProvider,
            message: 'Already authenticated.',
          });
        }
      } catch {
        // ignore status check failure and return the original error
      }

      setCapturedLoginUrl(null);
      setCapturedLoginCode(null);
      return NextResponse.json(
        {
          error: 'OpenAI device code was not received. Please retry login.',
          provider: oauthProvider,
          loginMode: openaiLoginMode,
          details: stderrPreview.trim() || 'missing device code',
        },
        { status: 500 },
      );
    }

    const loginUrl = rawLoginUrl
      || (oauthProvider === 'openai' && openaiLoginMode === 'device' && loginCode ? 'https://auth.openai.com/codex/device' : null);

    return NextResponse.json({
      success: true,
      provider: oauthProvider,
      loginMode: oauthProvider === 'openai' ? openaiLoginMode : undefined,
      message: 'Login flow started. Check your browser.',
      loginUrl,
      loginCode,
    });
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
