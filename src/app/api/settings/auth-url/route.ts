import { NextResponse } from 'next/server';
import { capturedLoginUrl, capturedLoginCode, loginProcess, loginProvider } from '@/lib/auth-login-state';

/**
 * GET /api/settings/auth-url
 * 前端轮询此接口，获取 OAuth 登录 URL / device code。
 *
 * - Anthropic: 返回 loginUrl（OAuth redirect URL）
 * - OpenAI: 返回 loginCode（device code）+ loginUrl（固定 device 页面）
 */
export async function GET() {
  return NextResponse.json({
    loginUrl: capturedLoginUrl,
    loginCode: capturedLoginCode,
    loginProvider: loginProvider,
    processAlive: !!(loginProcess && !loginProcess.killed),
  });
}
