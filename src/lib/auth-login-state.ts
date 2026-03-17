/**
 * auth-login-state.ts
 * 在 auth-login、auth-url、auth-code 路由之间共享 PKCE OAuth 状态。
 *
 * 使用 globalThis 防止 Next.js HMR 导致模块级变量丢失。
 */
import type { ProviderId } from '@/types';
import type { PKCEState } from '@/lib/oauth-flow';

interface OAuthLoginState {
  /** 当前 PKCE 会话（Anthropic OAuth） */
  pkceSession: PKCEState | null;
  /** 当前活跃的 provider */
  loginProvider: ProviderId | null;
  /** OpenAI: 仍使用 CLI 流程的子进程 */
  loginProcess: import('child_process').ChildProcess | null;
  /** OpenAI: 捕获的 URL */
  capturedLoginUrl: string | null;
  /** OpenAI device code */
  capturedLoginCode: string | null;
}

// globalThis 单例，防止 HMR 丢状态
const KEY = '__projectpilot_oauth_state__';
function getState(): OAuthLoginState {
  const g = globalThis as unknown as Record<string, OAuthLoginState | undefined>;
  if (!g[KEY]) {
    g[KEY] = {
      pkceSession: null,
      loginProvider: null,
      loginProcess: null,
      capturedLoginUrl: null,
      capturedLoginCode: null,
    };
  }
  return g[KEY]!;
}

// ── Anthropic PKCE ──

export function getPkceSession(): PKCEState | null {
  return getState().pkceSession;
}

export function setPkceSession(session: PKCEState | null): void {
  getState().pkceSession = session;
}

// ── Provider ──

export function getLoginProvider(): ProviderId | null {
  return getState().loginProvider;
}

export function setLoginProvider(provider: ProviderId | null): void {
  getState().loginProvider = provider;
}

// ── OpenAI (保留 CLI 流程) ──

export function getLoginProcess(): import('child_process').ChildProcess | null {
  return getState().loginProcess;
}

export function setLoginProcess(p: import('child_process').ChildProcess | null): void {
  getState().loginProcess = p;
}

export function getCapturedLoginUrl(): string | null {
  return getState().capturedLoginUrl;
}

export function setCapturedLoginUrl(url: string | null): void {
  getState().capturedLoginUrl = url;
}

export function getCapturedLoginCode(): string | null {
  return getState().capturedLoginCode;
}

export function setCapturedLoginCode(code: string | null): void {
  getState().capturedLoginCode = code;
}
