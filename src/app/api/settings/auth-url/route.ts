import { NextResponse } from 'next/server';
import {
  getPkceSession,
  getCapturedLoginUrl,
  getCapturedLoginCode,
  getLoginProcess,
  getLoginProvider,
} from '@/lib/auth-login-state';

/**
 * GET /api/settings/auth-url
 * 前端轮询此接口，获取 OAuth 登录 URL / device code。
 *
 * - Anthropic: 返回 PKCE 生成的 authorize URL（不依赖 CLI 进程）
 * - OpenAI: 返回 loginCode（device code）+ loginUrl（从 CLI 捕获）
 */
export async function GET() {
  const provider = getLoginProvider();
  const pkce = getPkceSession();
  const process = getLoginProcess();

  // Anthropic: URL 从 PKCE session 获取（同步，无需等待进程）
  // OpenAI: URL 从 CLI 进程输出获取
  const loginUrl = provider === 'anthropic'
    ? (pkce?.authorizeUrl ?? null)
    : getCapturedLoginUrl();

  return NextResponse.json({
    loginUrl,
    loginCode: getCapturedLoginCode(),
    loginProvider: provider,
    // Anthropic PKCE 模式：session 存在 = 活跃
    // OpenAI: 进程存在 = 活跃
    sessionActive: provider === 'anthropic'
      ? Boolean(pkce)
      : Boolean(process && !process.killed),
  });
}
