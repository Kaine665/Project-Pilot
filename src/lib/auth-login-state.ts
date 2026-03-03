/**
 * auth-login-state.ts
 * 在 auth-login、auth-url、auth-code 路由之间共享状态。
 */
import type { ChildProcess } from 'child_process';
import type { ProviderId } from '@/types';

export let loginProcess: ChildProcess | null = null;
export let capturedLoginUrl: string | null = null;
export let capturedLoginCode: string | null = null;
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
