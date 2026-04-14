/**
 * Google OAuth — backend endpoints for session management and credential sync.
 *
 * Google API（token、Drive）在系统浏览器中调用；Electron 内嵌页通过 ticket 打开浏览器完成同步并轮询完成信号。
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

// ── PKCE pending state disk storage (for Electron → system browser handoff) ──

const PENDING_FILENAME = '_oauth_pending.json';

async function writePendingState(data: { codeVerifier: string; state: string; returnPath: string }): Promise<void> {
  const dir = getGoogleOAuthDir();
  await fs.mkdir(dir, { recursive: true });
  const fp = path.join(dir, PENDING_FILENAME);
  await fs.writeFile(fp, JSON.stringify({ ...data, createdAt: Date.now() }), 'utf-8');
}

async function readAndClearPendingState(): Promise<{ codeVerifier: string; state: string; returnPath: string } | null> {
  const fp = path.join(getGoogleOAuthDir(), PENDING_FILENAME);
  try {
    const raw = await fs.readFile(fp, 'utf-8');
    await fs.unlink(fp).catch(() => {});
    const j = JSON.parse(raw) as { codeVerifier?: string; state?: string; returnPath?: string; createdAt?: number };
    // Expire after 10 minutes
    if (j.createdAt && Date.now() - j.createdAt > 10 * 60 * 1000) return null;
    if (!j.codeVerifier || !j.state) return null;
    return { codeVerifier: j.codeVerifier, state: j.state, returnPath: j.returnPath ?? '' };
  } catch {
    return null;
  }
}

// ── Login completion signal (for Electron polling) ──

const COMPLETION_FILENAME = '_oauth_completion.json';

async function writeLoginCompletion(sub: string, email: string): Promise<void> {
  const dir = getGoogleOAuthDir();
  await fs.mkdir(dir, { recursive: true });
  const fp = path.join(dir, COMPLETION_FILENAME);
  await fs.writeFile(fp, JSON.stringify({ sub, email, completedAt: Date.now() }), 'utf-8');
}

async function readAndClearLoginCompletion(): Promise<{ sub: string; email: string } | null> {
  const fp = path.join(getGoogleOAuthDir(), COMPLETION_FILENAME);
  try {
    const raw = await fs.readFile(fp, 'utf-8');
    await fs.unlink(fp).catch(() => {});
    const j = JSON.parse(raw) as { sub?: string; email?: string; completedAt?: number };
    // Expire after 5 minutes
    if (j.completedAt && Date.now() - j.completedAt > 5 * 60 * 1000) return null;
    if (!j.sub) return null;
    return { sub: j.sub, email: j.email ?? '' };
  } catch {
    return null;
  }
}

// ── Electron → 系统浏览器：Drive 同步桥接（ticket + 完成信号）──

const BROWSER_SYNC_TICKET_FILE = '_browser_sync_ticket.json';
const BROWSER_SYNC_DONE_FILE = '_browser_sync_done.json';

async function writeBrowserSyncTicket(ticket: string, sub: string, email: string): Promise<void> {
  const dir = getGoogleOAuthDir();
  await fs.mkdir(dir, { recursive: true });
  const fp = path.join(dir, BROWSER_SYNC_TICKET_FILE);
  await fs.writeFile(fp, JSON.stringify({ ticket, sub, email, createdAt: Date.now() }), 'utf-8');
}

async function readAndClearBrowserSyncTicket(expectedTicket: string): Promise<{ sub: string; email: string } | null> {
  const fp = path.join(getGoogleOAuthDir(), BROWSER_SYNC_TICKET_FILE);
  try {
    const raw = await fs.readFile(fp, 'utf-8');
    await fs.unlink(fp).catch(() => {});
    const j = JSON.parse(raw) as { ticket?: string; sub?: string; email?: string; createdAt?: number };
    if (j.createdAt && Date.now() - j.createdAt > 5 * 60 * 1000) return null;
    if (!j.sub || j.ticket !== expectedTicket) return null;
    return { sub: j.sub, email: j.email ?? '' };
  } catch {
    return null;
  }
}

async function writeBrowserSyncDone(): Promise<void> {
  const dir = getGoogleOAuthDir();
  await fs.mkdir(dir, { recursive: true });
  const fp = path.join(dir, BROWSER_SYNC_DONE_FILE);
  await fs.writeFile(fp, JSON.stringify({ doneAt: Date.now() }), 'utf-8');
}

async function readAndClearBrowserSyncDone(): Promise<boolean> {
  const fp = path.join(getGoogleOAuthDir(), BROWSER_SYNC_DONE_FILE);
  try {
    const raw = await fs.readFile(fp, 'utf-8');
    await fs.unlink(fp).catch(() => {});
    const j = JSON.parse(raw) as { doneAt?: number };
    if (j.doneAt && Date.now() - j.doneAt > 5 * 60 * 1000) return false;
    return true;
  } catch {
    return false;
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

  // Write completion signal for Electron polling (separate cookie jar can't see this cookie)
  await writeLoginCompletion(sub, email ?? '');

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

/**
 * POST /save-pending — Store PKCE state on disk for cross-browser handoff (Electron → system browser).
 */
googleAuth.post('/save-pending', async (c) => {
  let body: { codeVerifier?: string; state?: string; returnPath?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: 'Invalid JSON' }, 400);
  }
  if (!body.codeVerifier || !body.state) {
    return c.json({ ok: false, error: 'Missing codeVerifier or state' }, 400);
  }
  await writePendingState({
    codeVerifier: body.codeVerifier,
    state: body.state,
    returnPath: body.returnPath ?? '',
  });
  return c.json({ ok: true });
});

/**
 * GET /load-pending — Retrieve and clear PKCE state from disk.
 * Used by the OAuth callback page when sessionStorage is unavailable (system browser opened from Electron).
 */
googleAuth.get('/load-pending', async (c) => {
  const pending = await readAndClearPendingState();
  if (!pending) {
    return c.json({ ok: false, error: 'No pending state' }, 404);
  }
  return c.json({ ok: true, ...pending });
});

/**
 * GET /poll-login — Electron polls this to detect OAuth completion from the system browser.
 * If a recent login completion exists, sets a session cookie for the caller and returns success.
 * This solves the cookie-jar isolation between Electron and the system browser.
 */
googleAuth.get('/poll-login', async (c) => {
  const completion = await readAndClearLoginCompletion();
  if (!completion) {
    return c.json({ signedIn: false });
  }

  // Set session cookie for Electron (the caller)
  const now = Math.floor(Date.now() / 1000);
  const token = signSession({
    sub: completion.sub,
    email: completion.email,
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

  return c.json({ signedIn: true, email: completion.email || null });
});

/**
 * POST /browser-sync-start — Electron 已登录时签发一次性 ticket，打开系统浏览器访问桥接页。
 */
googleAuth.post('/browser-sync-start', async (c) => {
  const raw = getCookie(c, SESSION_COOKIE);
  const payload = raw ? verifySession(raw) : null;
  if (!payload?.sub) {
    return c.json({ ok: false, error: 'Not authenticated' }, 401);
  }
  const ticket = crypto.randomBytes(32).toString('base64url');
  await writeBrowserSyncTicket(ticket, payload.sub as string, (payload.email as string) || '');
  const origin =
    process.env.PP_FRONTEND_ORIGIN?.trim().replace(/\/$/, '') || 'http://127.0.0.1:4000';
  const url = `${origin}/oauth/google/browser-sync?ticket=${encodeURIComponent(ticket)}`;
  return c.json({ ok: true, url });
});

/**
 * POST /browser-sync-claim — 浏览器凭 ticket 换取 refresh_token + 设置会话 Cookie，随后在浏览器内调 Google。
 */
googleAuth.post('/browser-sync-claim', async (c) => {
  let body: { ticket?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: 'Invalid JSON' }, 400);
  }
  const ticket = body.ticket?.trim();
  if (!ticket) return c.json({ ok: false, error: 'Missing ticket' }, 400);

  const rec = await readAndClearBrowserSyncTicket(ticket);
  if (!rec) return c.json({ ok: false, error: 'Invalid or expired ticket' }, 400);

  const refresh_token = await readRefreshToken(rec.sub);
  if (!refresh_token) return c.json({ ok: false, error: 'No refresh token' }, 400);

  const now = Math.floor(Date.now() / 1000);
  const sess = signSession({
    sub: rec.sub,
    email: rec.email,
    iat: now,
    exp: now + SESSION_MAX_AGE_SEC,
  });
  setCookie(c, SESSION_COOKIE, sess, {
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
    secure: false,
    maxAge: SESSION_MAX_AGE_SEC,
  });

  return c.json({ ok: true, refresh_token });
});

/**
 * POST /browser-sync-done — 浏览器内同步完成后写入信号，供 Electron GET /poll-browser-sync 消费。
 */
googleAuth.post('/browser-sync-done', async (c) => {
  const raw = getCookie(c, SESSION_COOKIE);
  if (!raw || !verifySession(raw)) {
    return c.json({ ok: false, error: 'Not authenticated' }, 401);
  }
  await writeBrowserSyncDone();
  return c.json({ ok: true });
});

/**
 * GET /poll-browser-sync — Electron 轮询：系统浏览器内 Drive 同步是否已结束。
 */
googleAuth.get('/poll-browser-sync', async (c) => {
  const done = await readAndClearBrowserSyncDone();
  return c.json({ done });
});

export default googleAuth;
