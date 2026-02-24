import { NextResponse } from 'next/server';
import { spawn, type ChildProcess } from 'child_process';

/**
 * POST /api/settings/auth-login
 * 触发 Claude CLI OAuth 登录（打开浏览器）。
 *
 * 防重复：同一时间只允许一个 login 进程。
 * Windows：windowsHide 隐藏控制台窗口。
 */

let loginProcess: ChildProcess | null = null;

export async function POST() {
  // 防重复：如果已有进程在跑，直接返回
  if (loginProcess && !loginProcess.killed) {
    return NextResponse.json({
      success: true,
      message: 'Login already in progress.',
    });
  }

  try {
    const child = spawn('claude', ['login'], {
      detached: true,
      stdio: 'ignore',
      shell: false,
      windowsHide: true,
    });
    child.unref();

    loginProcess = child;
    child.on('exit', () => { loginProcess = null; });
    child.on('error', () => { loginProcess = null; });

    return NextResponse.json({
      success: true,
      message: 'Login flow started. Check your browser.',
    });
  } catch (err) {
    loginProcess = null;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to start login' },
      { status: 500 },
    );
  }
}
