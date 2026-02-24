import { NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * GET /api/settings/auth-status
 * 检查 Claude CLI OAuth 登录状态。
 */
export async function GET() {
  try {
    const { stdout, stderr } = await execFileAsync('claude', ['auth', 'status'], {
      timeout: 10_000,
      env: { ...process.env },
    });

    const output = (stdout + stderr).toLowerCase();
    const isLoggedIn = output.includes('logged in') || output.includes('authenticated');

    return NextResponse.json({
      authenticated: isLoggedIn,
      rawOutput: stdout.trim(),
    });
  } catch (err) {
    return NextResponse.json({
      authenticated: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
}
