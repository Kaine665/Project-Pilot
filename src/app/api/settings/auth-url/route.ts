import { NextResponse } from 'next/server';
import { capturedLoginUrl, loginProcess } from '@/lib/auth-login-state';

/**
 * GET /api/settings/auth-url
 * 前端轮询此接口，获取 claude auth login 输出的 OAuth URL。
 */
export async function GET() {
  return NextResponse.json({
    loginUrl: capturedLoginUrl,
    processAlive: !!(loginProcess && !loginProcess.killed),
  });
}
