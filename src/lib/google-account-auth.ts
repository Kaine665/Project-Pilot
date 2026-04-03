/**
 * Google OAuth（应用内账号）— 用于按用户隔离本地数据目录。
 * 与 AI 供应商的 OAuth（Anthropic/OpenAI）无关。
 */
import path from 'path';
import { Jwt } from 'hono/utils/jwt';
import { getBaseDataDir } from '@/lib/file-store';

const COOKIE_NAME = 'pp_session';

export { COOKIE_NAME };

export interface GoogleAccountJwtPayload {
  sub: string;
  email?: string;
  name?: string;
  picture?: string;
  /** seconds */
  exp?: number;
  iat?: number;
}

function getJwtSecret(): string {
  const s = process.env.PROJECT_PILOT_JWT_SECRET?.trim();
  if (!s || s.length < 16) {
    throw new Error(
      'PROJECT_PILOT_JWT_SECRET is missing or too short (min 16 chars). Set it for Google sign-in.',
    );
  }
  return s;
}

function getJwtSecretOrNull(): string | null {
  const s = process.env.PROJECT_PILOT_JWT_SECRET?.trim();
  if (!s || s.length < 16) return null;
  return s;
}

/** Google sub 可能含符号；目录名仅保留安全字符。 */
export function sanitizeAccountDirSegment(rawSub: string): string {
  const s = rawSub.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
  return s || 'unknown';
}

export function getGoogleAccountDataRoot(googleSub: string): string {
  const safe = sanitizeAccountDirSegment(googleSub);
  return path.join(getBaseDataDir(), 'accounts', safe);
}

export async function signSessionToken(payload: Omit<GoogleAccountJwtPayload, 'exp' | 'iat'>): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 60 * 60 * 24 * 14; // 14d
  const full = {
    ...payload,
    iat: now,
    exp,
  };
  return Jwt.sign(full, getJwtSecret(), 'HS256');
}

export async function verifySessionToken(token: string): Promise<GoogleAccountJwtPayload | null> {
  const secret = getJwtSecretOrNull();
  if (!secret) return null;
  try {
    const p = (await Jwt.verify(token, secret, 'HS256')) as Record<string, unknown>;
    const sub = p.sub;
    if (typeof sub !== 'string' || !sub.trim()) return null;
    return {
      sub: sub.trim(),
      email: typeof p.email === 'string' ? p.email : undefined,
      name: typeof p.name === 'string' ? p.name : undefined,
      picture: typeof p.picture === 'string' ? p.picture : undefined,
      exp: typeof p.exp === 'number' ? p.exp : undefined,
      iat: typeof p.iat === 'number' ? p.iat : undefined,
    };
  } catch {
    return null;
  }
}

export function getGoogleOAuthConfig(): { clientId: string; clientSecret: string; redirectUri: string } | null {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim();
  if (!clientId || !clientSecret || !redirectUri) return null;
  return { clientId, clientSecret, redirectUri };
}
