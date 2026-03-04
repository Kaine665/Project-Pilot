import { NextResponse } from 'next/server';
import { loginProcess } from '@/lib/auth-login-state';

/**
 * 从用户输入中提取授权码。
 * 支持：纯授权码、完整回调 URL（?code=xxx 或 #code=xxx）。
 */
function extractCode(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  try {
    const url = new URL(trimmed);
    const fromQuery = url.searchParams.get('code');
    if (fromQuery) return fromQuery;
    const hash = url.hash.replace(/^#/, '');
    const fromHash = new URLSearchParams(hash).get('code');
    if (fromHash) return fromHash;
  } catch {
    // 不是 URL，当作纯授权码
  }
  return trimmed;
}

/**
 * POST /api/settings/auth-code
 * 把用户从浏览器回调页面复制的授权码（或完整回调 URL）写入 claude auth login 的 stdin。
 */
export async function POST(req: Request) {
  const { code } = await req.json() as { code?: string };

  const extracted = extractCode(code ?? '');
  if (!extracted) {
    return NextResponse.json({ error: 'code is required' }, { status: 400 });
  }

  if (!loginProcess || loginProcess.killed) {
    return NextResponse.json({ error: 'No active login process. Please click "Login" first.' }, { status: 409 });
  }

  const stdin = loginProcess.stdin;
  if (!stdin || stdin.destroyed) {
    return NextResponse.json({ error: 'Login process stdin not available.' }, { status: 409 });
  }

  try {
    const eol = process.platform === 'win32' ? '\r\n' : '\n';
    stdin.write(extracted + eol);
    stdin.end();
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to write code' },
      { status: 500 },
    );
  }
}
