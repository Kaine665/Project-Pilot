/**
 * auth-login-state.ts
 * 在 auth-login、auth-url、auth-code 路由之间共享状态。
 */
import type { ChildProcess } from 'child_process';

export let loginProcess: ChildProcess | null = null;
export let capturedLoginUrl: string | null = null;

export function setLoginProcess(p: ChildProcess | null) {
  loginProcess = p;
}

export function setCapturedLoginUrl(url: string | null) {
  capturedLoginUrl = url;
}
