/**
 * 浏览器端请求 Hono API 的基址。
 * - 默认 `''`：使用相对路径 `/api/...`（Vite 开发时代理到 Hono，或与 Hono 同端口的一体化部署）。
 * - 设置 `VITE_API_ORIGIN=http://127.0.0.1:4500`：仅跑 Vite、后端另开端口时直连（Hono 已对 /api 开 CORS）。
 */
export function getBrowserApiOrigin(): string {
  const raw = import.meta.env.VITE_API_ORIGIN as string | undefined;
  if (raw && typeof raw === 'string') {
    const s = raw.trim().replace(/\/$/, '');
    if (s) return s;
  }
  return '';
}

export function apiUrl(path: string): string {
  const origin = getBrowserApiOrigin();
  const p = path.startsWith('/') ? path : `/${path}`;
  if (!origin) return p;
  return `${origin}${p}`;
}

/** 跨域直连 API（VITE_API_ORIGIN）时携带 Cookie（如 Google 账号会话）。 */
export function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return fetch(input, {
    ...init,
    credentials: init?.credentials ?? 'include',
  });
}
