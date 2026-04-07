/**
 * Google OAuth（openid + Drive appData）与 AI 凭据同步。
 */

import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getGoogleOAuthDir } from '@/lib/file-store';
import { getSettings, saveSettings } from '@/lib/settings-manager';
import {
  buildAiCredentialsBlobFromClaude,
  mergeRemoteIntoClaude,
  pullAiCredentialsFromDrive,
  pushAiCredentialsToDrive,
} from '@/lib/google-drive-ai-credentials-sync';

const SESSION_COOKIE = 'pp_google_sess';
const SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 7;

const OAUTH_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/drive.appdata',
].join(' ');

type PendingState = {
  codeVerifier: string;
  returnPath: string;
  createdAt: number;
};

const pendingByState = new Map<string, PendingState>();
const STATE_TTL_MS = 15 * 60 * 1000;

function cleanupPending(): void {
  const now = Date.now();
  for (const [k, v] of pendingByState) {
    if (now - v.createdAt > STATE_TTL_MS) pendingByState.delete(k);
  }
}

function getGoogleClientConfig(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

function redirectUri(): string {
  return (
    process.env.GOOGLE_REDIRECT_URI?.trim() ||
    'http://127.0.0.1:4500/api/auth/google/callback'
  );
}

function sessionSecret(): string {
  const s = process.env.PP_SESSION_SECRET?.trim();
  if (s) return s;
  return 'dev-insecure-pp-google-session-do-not-use-in-prod';
}

interface SessionPayload {
  sub: string;
  email?: string;
  iat: number;
  exp: number;
}

function signSession(payload: SessionPayload): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const data = `${header}.${body}`;
  const sig = crypto.createHmac('sha256', sessionSecret()).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function verifySession(token: string): SessionPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, b, s] = parts;
  const data = `${h}.${b}`;
  const expected = crypto.createHmac('sha256', sessionSecret()).update(data).digest('base64url');
  try {
    if (expected.length !== s.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(s))) return null;
  } catch {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(b, 'base64url').toString('utf8')) as SessionPayload;
    if (payload.exp < Date.now() / 1000) return null;
    if (!payload.sub) return null;
    return payload;
  } catch {
    return null;
  }
}

function sanitizeReturnPath(raw: string | undefined, fallback: string): string {
  if (!raw || typeof raw !== 'string') return fallback;
  const p = raw.trim();
  if (!p.startsWith('/') || p.startsWith('//') || p.includes('://')) return fallback;
  if (p.length > 512) return fallback;
  return p;
}

function tokenPathForSub(sub: string): string {
  const safe = sub.replace(/[^a-zA-Z0-9._-]/g, '_');
  return path.join(getGoogleOAuthDir(), `${safe}.json`);
}

interface StoredTokens {
  refresh_token: string;
  updatedAt: number;
}

async function readRefreshToken(sub: string): Promise<string | null> {
  try {
    const raw = await fs.readFile(tokenPathForSub(sub), 'utf-8');
    const j = JSON.parse(raw) as StoredTokens;
    return j.refresh_token || null;
  } catch {
    return null;
  }
}

async function writeRefreshToken(sub: string, refresh_token: string): Promise<void> {
  const dir = getGoogleOAuthDir();
  await fs.mkdir(dir, { recursive: true });
  const payload: StoredTokens = { refresh_token, updatedAt: Date.now() };
  await fs.writeFile(tokenPathForSub(sub), JSON.stringify(payload, null, 2), 'utf-8');
}

async function deleteRefreshTokenFile(sub: string): Promise<void> {
  await fs.unlink(tokenPathForSub(sub)).catch(() => {});
}

async function verifyIdToken(idToken: string): Promise<{ sub: string; email?: string }> {
  const url = `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`;
  const res = await fetch(url);
  const j = (await res.json()) as { sub?: string; email?: string; error?: string };
  if (!res.ok || j.error || !j.sub) {
    throw new Error(j.error || 'tokeninfo failed');
  }
  return { sub: j.sub, email: j.email };
}

async function exchangeCode(
  code: string,
  codeVerifier: string,
  cfg: { clientId: string; clientSecret: string },
): Promise<{ access_token: string; refresh_token?: string; id_token?: string }> {
  const body = new URLSearchParams({
    code,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    redirect_uri: redirectUri(),
    grant_type: 'authorization_code',
    code_verifier: codeVerifier,
  });
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const j = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    id_token?: string;
    error?: string;
  };
  if (!res.ok || j.error || !j.access_token) {
    throw new Error(j.error || 'token exchange failed');
  }
  return {
    access_token: j.access_token,
    refresh_token: j.refresh_token,
    id_token: j.id_token,
  };
}

async function refreshAccessToken(
  refreshToken: string,
  cfg: { clientId: string; clientSecret: string },
): Promise<string> {
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    grant_type: 'refresh_token',
  });
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const j = (await res.json()) as { access_token?: string; error?: string };
  if (!res.ok || j.error || !j.access_token) {
    throw new Error(j.error || 'refresh failed');
  }
  return j.access_token;
}

async function getAccessTokenForSession(
  sub: string,
  cfg: { clientId: string; clientSecret: string },
): Promise<string> {
  const rt = await readRefreshToken(sub);
  if (!rt) throw new Error('no_refresh_token');
  return refreshAccessToken(rt, cfg);
}

const googleAuth = new Hono();

googleAuth.get('/start', (c) => {
  const cfg = getGoogleClientConfig();
  if (!cfg) {
    return c.json({ ok: false, error: 'Google OAuth is not configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).' }, 503);
  }
  cleanupPending();
  const returnPath = sanitizeReturnPath(c.req.query('returnPath'), '/workspace/settings?section=googleSync');
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  const state = crypto.randomBytes(24).toString('base64url');
  pendingByState.set(state, { codeVerifier, returnPath, createdAt: Date.now() });

  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: OAUTH_SCOPES,
    state,
    access_type: 'offline',
    prompt: 'consent',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  // Electron 内嵌 WebView 常被 Google 拒绝（空白页 / disallowed_useragent）；桌面端用 json=1 取 URL 后由系统浏览器打开。
  if (c.req.query('json') === '1') {
    return c.json({ ok: true, url });
  }
  return c.redirect(url, 302);
});

googleAuth.get('/callback', async (c) => {
  const cfg = getGoogleClientConfig();
  if (!cfg) {
    return c.text('Google OAuth not configured', 503);
  }
  const code = c.req.query('code');
  const state = c.req.query('state');
  const err = c.req.query('error');
  if (err) {
    return c.text(`OAuth error: ${err}`, 400);
  }
  if (!code || !state) {
    return c.text('Missing code or state', 400);
  }
  const pending = pendingByState.get(state);
  pendingByState.delete(state);
  if (!pending) {
    return c.text('Invalid or expired state', 400);
  }

  try {
    const tokens = await exchangeCode(code, pending.codeVerifier, cfg);
    if (!tokens.id_token) {
      return c.text('No id_token in response', 400);
    }
    const { sub, email } = await verifyIdToken(tokens.id_token);
    if (tokens.refresh_token) {
      await writeRefreshToken(sub, tokens.refresh_token);
    }

    const access = tokens.access_token;
    const remote = await pullAiCredentialsFromDrive(access).catch(() => null);
    if (remote) {
      const settings = await getSettings();
      settings.claude = mergeRemoteIntoClaude(settings.claude, remote);
      await saveSettings(settings);
    } else {
      const settings = await getSettings();
      const blob = buildAiCredentialsBlobFromClaude(settings.claude);
      await pushAiCredentialsToDrive(access, blob);
    }

    const now = Math.floor(Date.now() / 1000);
    const token = signSession({
      sub,
      email,
      iat: now,
      exp: now + SESSION_MAX_AGE_SEC,
    });
    setCookie(c, SESSION_COOKIE, token, {
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
      secure: false,
      maxAge: SESSION_MAX_AGE_SEC,
    });

    const base =
      process.env.PP_FRONTEND_ORIGIN?.trim().replace(/\/$/, '') || 'http://127.0.0.1:4000';
    const pathWithQuery = pending.returnPath.startsWith('/') ? pending.returnPath : `/${pending.returnPath}`;
    const sep = pathWithQuery.includes('?') ? '&' : '?';
    const suffix = `${sep}google=ok`;
    const target = `${base}${pathWithQuery}${suffix}`;
    return c.redirect(target, 302);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.text(`OAuth callback failed: ${msg}`, 500);
  }
});

googleAuth.post('/logout', async (c) => {
  const raw = getCookie(c, SESSION_COOKIE);
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  if (raw) {
    const sess = verifySession(raw);
    if (sess) await deleteRefreshTokenFile(sess.sub);
  }
  return c.json({ ok: true });
});

googleAuth.get('/status', (c) => {
  const raw = getCookie(c, SESSION_COOKIE);
  if (!raw) {
    return c.json({ ok: true, signedIn: false });
  }
  const sess = verifySession(raw);
  if (!sess) {
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.json({ ok: true, signedIn: false });
  }
  return c.json({ ok: true, signedIn: true, email: sess.email ?? null, sub: sess.sub });
});

googleAuth.post('/sync-pull', async (c) => {
  const cfg = getGoogleClientConfig();
  if (!cfg) {
    return c.json({ ok: false, error: 'not_configured' }, 503);
  }
  const raw = getCookie(c, SESSION_COOKIE);
  const sess = raw ? verifySession(raw) : null;
  if (!sess) {
    return c.json({ ok: false, error: 'not_signed_in' }, 401);
  }
  try {
    const access = await getAccessTokenForSession(sess.sub, cfg);
    const remote = await pullAiCredentialsFromDrive(access);
    if (!remote) {
      return c.json({ ok: true, merged: false, message: 'no_remote_file' });
    }
    const settings = await getSettings();
    settings.claude = mergeRemoteIntoClaude(settings.claude, remote);
    await saveSettings(settings);
    return c.json({ ok: true, merged: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ ok: false, error: msg }, 500);
  }
});

googleAuth.post('/sync-push', async (c) => {
  const cfg = getGoogleClientConfig();
  if (!cfg) {
    return c.json({ ok: false, error: 'not_configured' }, 503);
  }
  const raw = getCookie(c, SESSION_COOKIE);
  const sess = raw ? verifySession(raw) : null;
  if (!sess) {
    return c.json({ ok: false, error: 'not_signed_in' }, 401);
  }
  try {
    const settings = await getSettings();
    const blob = buildAiCredentialsBlobFromClaude(settings.claude);
    const access = await getAccessTokenForSession(sess.sub, cfg);
    await pushAiCredentialsToDrive(access, blob);
    return c.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ ok: false, error: msg }, 500);
  }
});

export default googleAuth;
