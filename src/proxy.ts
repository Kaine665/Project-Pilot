import { NextRequest, NextResponse } from 'next/server';
import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

const handleI18n = createMiddleware(routing);

/** 仅做 redirect 的路径，在 proxy 层直接处理，避免触发 98s 的 RSC 渲染 */
const EARLY_REDIRECT_PATHS: Record<string, string> = {
  '/': '/flows/projects',
  '/zh': '/zh/flows/projects',
  '/en': '/en/flows/projects',
  '/flows': '/flows/projects',
  '/zh/flows': '/zh/flows/projects',
  '/en/flows': '/en/flows/projects',
};

export default async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const pathNoTrailing = pathname.replace(/\/$/, '') || '/';
  const target = EARLY_REDIRECT_PATHS[pathNoTrailing];
  if (target) {
    return NextResponse.redirect(new URL(target, request.url), 307);
  }
  return handleI18n(request);
}

export const config = {
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
