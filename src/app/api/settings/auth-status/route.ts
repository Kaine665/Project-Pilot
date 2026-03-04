import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * GET /api/settings/auth-status
 * 检查 Claude CLI OAuth 登录状态。
 *
 * Claude CLI 默认输出 JSON（如 {"loggedIn": true}），优先解析 JSON。
 * Windows 下使用 exec（走 shell）以正确解析 npm 全局的 claude.cmd。
 */
export async function GET() {
  try {
    const cmd = 'claude auth status';
    const { stdout, stderr } = await execAsync(cmd, {
      timeout: 15_000,
      env: { ...process.env },
    });

    const raw = (stdout + stderr).trim();
    let isLoggedIn = false;

    try {
      // 优先解析整行 JSON；若有前后缀则尝试提取 { ... }
      let jsonStr = raw;
      const braceMatch = raw.match(/\{[\s\S]*\}/);
      if (braceMatch) jsonStr = braceMatch[0];
      const json = JSON.parse(jsonStr);
      isLoggedIn = json.loggedIn === true;
    } catch {
      const output = raw.toLowerCase();
      isLoggedIn =
        output.includes('logged in') ||
        output.includes('loggedin') ||
        output.includes('authenticated');
    }

    return NextResponse.json({
      authenticated: isLoggedIn,
      rawOutput: raw,
    });
  } catch (err) {
    return NextResponse.json({
      authenticated: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
}
