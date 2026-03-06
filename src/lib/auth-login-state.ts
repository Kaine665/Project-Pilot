/**
 * auth-login-state.ts
 * 在 auth-login、auth-url、auth-code 路由之间共享状态。
 * auth-login 用 pipe 捕获 URL，auth-url 返回链接，auth-code 写入 stdin。
 */
import type { ChildProcess } from 'child_process';
import type { ProviderId } from '@/types';

export let loginProcess: ChildProcess | null = null;
export let capturedLoginUrl: string | null = null;
/** OpenAI device code (for device code flow) */
export let capturedLoginCode: string | null = null;
/** Which provider's OAuth flow is currently active */
export let loginProvider: ProviderId | null = null;

export function setLoginProcess(p: ChildProcess | null) {
  loginProcess = p;
}

export function setCapturedLoginUrl(url: string | null) {
  capturedLoginUrl = url;
}

export function setCapturedLoginCode(code: string | null) {
  capturedLoginCode = code;
}

export function setLoginProvider(provider: ProviderId | null) {
  loginProvider = provider;
}
