import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import {
  loginProcess as currentProcess,
  setLoginProcess,
  setCapturedLoginUrl,
} from '@/lib/auth-login-state';

/** 从 claude auth login 输出中提取 OAuth URL */
function extractOAuthUrl(text: string): string | null {
  // 匹配 "visit: https://..." 或直接 https://claude.ai/oauth/authorize
  const visitMatch = text.match(/visit:\s*(https:\/\/[^\s]+)/i);
  if (visitMatch) return visitMatch[1].trim();
  const urlMatch = text.match(/https:\/\/claude\.ai\/oauth\/authorize\?[^\s]+/);
  if (urlMatch) return urlMatch[0].trim();
  return null;
}

/**
 * POST /api/settings/auth-login
 * 启动 claude auth login（不自动打开浏览器），捕获输出的 OAuth URL。
 * 用户复制 URL 到浏览器打开，获取 code 后粘贴回前端。
 */
export async function POST() {
  if (currentProcess && !currentProcess.killed) {
    return NextResponse.json({
      success: true,
      message: 'Login already in progress.',
    });
  }

  try {
    setCapturedLoginUrl(null);
    // BROWSER=echo 阻止自动打开浏览器，URL 会输出到 stdout
    const env = { ...process.env, BROWSER: 'echo' };
    const child = spawn('claude', ['auth', 'login'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
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

    child.on('exit', () => {
      setLoginProcess(null);
    });
    child.on('error', () => {
      setLoginProcess(null);
    });

    return NextResponse.json({
      success: true,
      message: 'Login started. Poll /api/settings/auth-url for the link.',
    });
  } catch (err) {
    setLoginProcess(null);
    setCapturedLoginUrl(null);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to start login' },
      { status: 500 },
    );
  }
}
