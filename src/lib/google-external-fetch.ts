/**
 * 对 oauth2.googleapis.com / www.googleapis.com 的 HTTPS 请求。
 * 在 Bun+Windows、公司 HTTPS 代理或自定义 CA 等环境下可能出现证书校验失败；
 * 优先用系统信任库 / NODE_EXTRA_CA_CERTS / 正确配置代理；实在不行再用环境变量临时放宽（仅本机开发）。
 */
import { Agent, fetch as undiciFetch } from 'undici';

function tlsRelaxed(): boolean {
  return (
    process.env.PP_GOOGLE_FETCH_TLS_INSECURE === '1' ||
    process.env.PP_TLS_RELAX_EXTERNAL === '1'
  );
}

function isBunRuntime(): boolean {
  return typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined';
}

let relaxedUndiciAgent: Agent | null = null;

export async function googleExternalFetch(input: string | URL, init?: RequestInit): Promise<Response> {
  if (!tlsRelaxed()) {
    return fetch(input, init);
  }
  if (isBunRuntime()) {
    return fetch(input, {
      ...init,
      tls: { rejectUnauthorized: false },
    } as RequestInit & { tls?: { rejectUnauthorized?: boolean } });
  }
  if (!relaxedUndiciAgent) {
    relaxedUndiciAgent = new Agent({ connect: { rejectUnauthorized: false } });
  }
  return undiciFetch(input, { ...init, dispatcher: relaxedUndiciAgent });
}
