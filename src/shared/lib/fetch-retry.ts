/**
 * 对瞬时网络失败与常见可重试 HTTP 状态做有限次退避重试（不针对 VPN，仅通用健壮性）。
 */

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isRetryableHttpStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

/** fetch 失败时常见为 TypeError（含 “NetworkError when attempting to fetch resource”） */
export function isLikelyTransientNetworkError(err: unknown): boolean {
  return err instanceof TypeError;
}

export interface FetchRetryOptions {
  /** 默认 5 */
  maxAttempts?: number;
  /** 首次重试前基础等待（毫秒），含抖动；默认 600 */
  baseDelayMs?: number;
  /** 单次等待上限；默认 10000 */
  maxDelayMs?: number;
}

/**
 * 与 fetch 相同签名；对网络抛错与 429/502/503/504 重试，最后一次仍失败则抛出或返回末次 Response。
 */
export async function fetchWithRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
  opts?: FetchRetryOptions,
): Promise<Response> {
  const maxAttempts = opts?.maxAttempts ?? 5;
  const baseDelayMs = opts?.baseDelayMs ?? 600;
  const maxDelayMs = opts?.maxDelayMs ?? 10_000;

  const attempts = Math.max(1, maxAttempts);

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const res = await fetch(input, init);
      if (res.ok || !isRetryableHttpStatus(res.status)) {
        return res;
      }
      if (attempt === attempts - 1) {
        return res;
      }
      try {
        await res.text();
      } catch {
        // ignore body drain errors
      }
    } catch (e) {
      if (attempt === attempts - 1) {
        throw e;
      }
    }

    if (attempt < attempts - 1) {
      const exp = baseDelayMs * 2 ** attempt;
      const jitter = Math.random() * 250;
      const delay = Math.min(maxDelayMs, exp + jitter);
      await sleep(delay);
    }
  }

  throw new Error('fetchWithRetry: exhausted without response');
}
