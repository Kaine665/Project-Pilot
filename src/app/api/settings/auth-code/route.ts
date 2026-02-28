import { NextResponse } from 'next/server';
import { loginProcess } from '@/lib/auth-login-state';

/**
 * POST /api/settings/auth-code
 * 把用户从浏览器回调页面复制的授权码写入 claude auth login 的 stdin。
 */
export async function POST(req: Request) {
  const { code } = await req.json() as { code?: string };

  if (!code?.trim()) {
    return NextResponse.json({ error: 'code is required' }, { status: 400 });
  }

  if (!loginProcess || loginProcess.killed) {
    return NextResponse.json({ error: 'No active login process. Please click "Login" first.' }, { status: 409 });
  }

  if (!loginProcess.stdin) {
    return NextResponse.json({ error: 'Login process stdin not available.' }, { status: 500 });
  }

  try {
    // 写入 code + 换行，模拟用户在终端粘贴后按 Enter
    loginProcess.stdin.write(code.trim() + '\n');
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to write code' },
      { status: 500 },
    );
  }
}
