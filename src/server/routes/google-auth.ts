/**
 * Google OAuth — backend endpoints for session management and credential sync.
 *
 * All Google API communication (token exchange, Drive) now happens in the browser.
 * Backend only handles: session cookie, refresh token storage, credential merge.
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
} from '@/lib/google-drive-ai-credentials-sync';

const SESSION_COOKIE = 'pp_google_sess';
const SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 7;

// ── JWT session helpers ──

function getSessionSecret(): string {
  const s = process.env.PP_SESSION_SECRET?.trim();
  if (s && s.length >= 16) return s;
  return 'dev-insecure-pp-google-session-do-not-use-in-prod';
}

function signSession(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto
    .createHmac('sha256', getSessionSecret())
    .update(`${header}.${body}`)
    .digest('base64url');
  return `${header}.${body}.${sig}`;
}

function verifySession(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const sig = crypto
    .createHmac('sha256', getSessionSecret())
    .update(`${parts[0]}.${parts[1]}`)
    .digest('base64url');
  if (sig !== parts[2]) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString()) as Record<string, unknown>;
    if (typeof payload.exp === 'number' && payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

// ── Refresh token disk storage ──

function sanitizeSub(sub: string): string {
  return sub.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || 'unknown';
}

async function writeRefreshToken(sub: string, refreshToken: string): Promise<void> {
  const dir = getGoogleOAuthDir();
  await fs.mkdir(dir, { recursive: true });
  const fp = path.join(dir, `${sanitizeSub(sub)}.json`);
  await fs.writeFile(fp, JSON.stringify({ refresh_token: refreshToken, updatedAt: Date.now() }), 'utf-8');
}

async function readRefreshToken(sub: string): Promise<string | null> {
  const fp = path.join(getGoogleOAuthDir(), `${sanitizeSub(sub)}.json`);
  try {
    const raw = await fs.readFile(fp, 'utf-8');
    const j = JSON.parse(raw) as { refresh_token?: string };
    return j.refresh_token ?? null;
  } catch {
    return null;
  }
}

async function deleteRefreshTokenFile(sub: string): Promise<void> {
  const fp = path.join(getGoogleOAuthDir(), `${sanitizeSub(sub)}.json`);
  await fs.unlink(fp).catch(() => {});
}

// ── Routes ──

const googleAuth = new Hono();

/**
 * POST /complete — Frontend sends tokens after browser-side OAuth.
 * Backend stores refresh_token on disk and sets session cookie.
 */
googleAuth.post('/complete', async (c) => {
  let body: { refresh_token?: string; sub?: string; email?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: 'Invalid JSON' }, 400);
  }

  const { refresh_token, sub, email } = body;
  if (!sub || typeof sub !== 'string') {
    return c.json({ ok: false, error: 'Missing sub' }, 400);
  }
  if (!refresh_token || typeof refresh_token !== 'string') {
    return c.json({ ok: false, error: 'Missing refresh_token' }, 400);
  }

  await writeRefreshToken(sub, refresh_token);

  const now = Math.floor(Date.now() / 1000);
  const token = signSession({
    sub,
    email: email ?? '',
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

  return c.json({ ok: true, email, sub });
});

/**
 * GET /status — Check if current session is valid.
 */
googleAuth.get('/status', (c) => {
  const raw = getCookie(c, SESSION_COOKIE);
  if (!raw) return c.json({ signedIn: false });
  const payload = verifySession(raw);
  if (!payload) {
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.json({ signedIn: false });
  }
  return c.json({
    signedIn: true,
    email: (payload.email as string) || null,
    sub: (payload.sub as string) || null,
  });
});

/**
 * POST /logout — Clear session cookie and delete refresh token.
 */
googleAuth.post('/logout', async (c) => {
  const raw = getCookie(c, SESSION_COOKIE);
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  if (raw) {
    const payload = verifySession(raw);
    if (payload?.sub) {
      await deleteRefreshTokenFile(payload.sub as string);
    }
  }
  return c.json({ ok: true });
});

/**
 * POST /sync-merge — Frontend sends Drive blob for merge into local settings.
 */
googleAuth.post('/sync-merge', async (c) => {
  const raw = getCookie(c, SESSION_COOKIE);
  if (!raw || !verifySession(raw)) {
    return c.json({ ok: false, error: 'Not authenticated' }, 401);
  }

  let body: { blob?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: 'Invalid JSON' }, 400);
  }

  const blob = body.blob as { version?: number; providerCredentials?: unknown; providerApiKeys?: unknown; openaiOAuthEnabled?: boolean } | undefined;
  if (!blob || blob.version !== 1) {
    return c.json({ ok: false, error: 'Invalid blob' }, 400);
  }

  const settings = await getSettings();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  settings.claude = mergeRemoteIntoClaude(settings.claude, blob as any);
  await saveSettings(settings);

  return c.json({ ok: true, merged: true });
});

/**
 * GET /sync-get-blob — Get local credentials blob for frontend to push to Drive.
 */
googleAuth.get('/sync-get-blob', async (c) => {
  const raw = getCookie(c, SESSION_COOKIE);
  if (!raw || !verifySession(raw)) {
    return c.json({ ok: false, error: 'Not authenticated' }, 401);
  }

  const settings = await getSettings();
  const blob = buildAiCredentialsBlobFromClaude(settings.claude);
  return c.json({ ok: true, blob });
});

/**
 * GET /export-refresh-token — Migration: export stored refresh token for browser localStorage.
 * Only callable when session is valid but browser doesn't have the token yet.
 */
googleAuth.get('/export-refresh-token', async (c) => {
  const raw = getCookie(c, SESSION_COOKIE);
  if (!raw) return c.json({ ok: false, error: 'Not authenticated' }, 401);
  const payload = verifySession(raw);
  if (!payload?.sub) return c.json({ ok: false, error: 'Invalid session' }, 401);

  const token = await readRefreshToken(payload.sub as string);
  if (!token) return c.json({ ok: false, error: 'No stored refresh token' }, 404);

  return c.json({ ok: true, refresh_token: token });
});

export default googleAuth;
