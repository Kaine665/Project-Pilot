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
import { googleExternalFetch } from '@/lib/google-external-fetch';
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
  /** 桌面端：系统浏览器与 Electron 非同一 Cookie 池，回调后凭此 id 让应用内轮询领取会话 */
  pollId?: string;
};

type PollReady = { token: string; exp: number };

const pendingByState = new Map<string, PendingState>();
/** OAuth 回调完成后暂存 JWT，供 Electron 渲染进程轮询领取并写入本应用 Cookie */
const pollReadyById = new Map<string, PollReady>();
const STATE_TTL_MS = 15 * 60 * 1000;
const POLL_READY_TTL_MS = 5 * 60 * 1000;

/** 磁盘持久化：开发时 Bun/Hono 重启或双进程会导致内存 Map 丢 state；回调仍以 URL 中 state 为准 */
function getOAuthPendingDir(): string {
  return path.join(getGoogleOAuthDir(), 'oauth-start-pending');
}

function pendingDiskFileName(state: string): string {
  return `${Buffer.from(state, 'utf8').toString('base64url')}.pending.json`;
}

async function savePendingToDisk(state: string, data: PendingState): Promise<void> {
  const dir = getOAuthPendingDir();
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, pendingDiskFileName(state)), JSON.stringify(data), 'utf8');
}

async function readPendingFromDisk(state: string): Promise<PendingState | null> {
  const fp = path.join(getOAuthPendingDir(), pendingDiskFileName(state));
  try {
    const raw = await fs.readFile(fp, 'utf8');
    const j = JSON.parse(raw) as PendingState;
    if (typeof j.codeVerifier !== 'string' || typeof j.returnPath !== 'string' || typeof j.createdAt !== 'number') {
      return null;
    }
    return j;
  } catch {
    return null;
  }
}

async function deletePendingFromDisk(state: string): Promise<void> {
  await fs.unlink(path.join(getOAuthPendingDir(), pendingDiskFileName(state))).catch(() => {});
}

async function cleanupPendingDiskFiles(): Promise<void> {
  const dir = getOAuthPendingDir();
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return;
  }
  const now = Date.now();
  for (const name of names) {
    if (!name.endsWith('.pending.json')) continue;
    const fp = path.join(dir, name);
    try {
      const raw = await fs.readFile(fp, 'utf8');
      const j = JSON.parse(raw) as PendingState;
      if (!j.createdAt || now - j.createdAt > STATE_TTL_MS) {
        await fs.unlink(fp).catch(() => {});
      }
    } catch {
      await fs.unlink(fp).catch(() => {});
    }
  }
}

function cleanupPendingMemoryAndPoll(): void {
  const now = Date.now();
  for (const [k, v] of pendingByState) {
    if (now - v.createdAt > STATE_TTL_MS) pendingByState.delete(k);
  }
  for (const [id, v] of pollReadyById) {
    if (now > v.exp) pollReadyById.delete(id);
  }
}

async function loadPendingForCallback(state: string): Promise<PendingState | null> {
  let p = pendingByState.get(state);
  if (!p) {
    const fromDisk = await readPendingFromDisk(state);
    if (fromDisk) {
      pendingByState.set(state, fromDisk);
      p = fromDisk;
    }
  }
  if (!p) return null;
  if (Date.now() - p.createdAt > STATE_TTL_MS) {
    pendingByState.delete(state);
    await deletePendingFromDisk(state);
    return null;
  }
  return p;
}

async function clearPendingEverywhere(state: string): Promise<void> {
  pendingByState.delete(state);
  await deletePendingFromDisk(state);
}

/** 与内存 Map 同步；Bun/Hono 热重启后回调仍能读到 PKCE state（否则 Invalid or expired state） */
function pkcePendingDir(): string {
  return path.join(getGoogleOAuthDir(), 'pkce-pending');
}

function pkcePendingFile(state: string): string {
  const safe = state.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 220);
  return path.join(pkcePendingDir(), `${safe}.json`);
}

async function writePkcePendingDisk(state: string, p: PendingState): Promise<void> {
  const dir = pkcePendingDir();
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(pkcePendingFile(state), JSON.stringify(p), 'utf-8');
}

async function readPkcePendingDisk(state: string): Promise<PendingState | null> {
  try {
    const raw = await fs.readFile(pkcePendingFile(state), 'utf-8');
    const j = JSON.parse(raw) as PendingState;
    if (!j?.codeVerifier || typeof j.returnPath !== 'string' || typeof j.createdAt !== 'number') {
      return null;
    }
    if (Date.now() - j.createdAt > STATE_TTL_MS) {
      await fs.unlink(pkcePendingFile(state)).catch(() => {});
      return null;
    }
    return j;
  } catch {
    return null;
  }
}

async function unlinkPkcePendingDisk(state: string): Promise<void> {
  await fs.unlink(pkcePendingFile(state)).catch(() => {});
}

async function cleanupPkcePendingDisk(): Promise<void> {
  let names: string[] = [];
  try {
    names = await fs.readdir(pkcePendingDir());
  } catch {
    return;
  }
  const now = Date.now();
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const fp = path.join(pkcePendingDir(), name);
    try {
      const raw = await fs.readFile(fp, 'utf-8');
      const j = JSON.parse(raw) as PendingState;
      if (!j?.createdAt || now - j.createdAt > STATE_TTL_MS) {
        await fs.unlink(fp).catch(() => {});
      }
    } catch {
      await fs.unlink(fp).catch(() => {});
    }
  }
}

// Built-in Google OAuth credentials for ProjectPilot.
// End users don't need to configure these. Self-hosted deployments can
// override via env vars if they want to use their own Google Cloud project.
const BUILTIN_GOOGLE_CLIENT_ID =
  '469599503504-dmhuho50val4lgtb7kslhg524e29vq5d.apps.googleusercontent.com';
const BUILTIN_GOOGLE_CLIENT_SECRET = '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';

function getGoogleClientConfig(): { clientId: string; clientSecret: string } {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim() || BUILTIN_GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim() || BUILTIN_GOOGLE_CLIENT_SECRET;
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
  const res = await googleExternalFetch(url);
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
  const res = await googleExternalFetch('https://oauth2.googleapis.com/token', {
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
  const res = await googleExternalFetch('https://oauth2.googleapis.com/token', {
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

googleAuth.get('/start', async (c) => {
  const cfg = getGoogleClientConfig();
  cleanupPendingMemoryAndPoll();
  await cleanupPendingDiskFiles();
  const returnPath = sanitizeReturnPath(c.req.query('returnPath'), '/workspace/settings?section=googleSync');
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  const state = crypto.randomBytes(24).toString('base64url');
  const desktopHandoff = c.req.query('json') === '1' && c.req.query('desktop') === '1';
  const pollId = desktopHandoff ? crypto.randomBytes(32).toString('base64url') : undefined;
  const pending: PendingState = { codeVerifier, returnPath, createdAt: Date.now(), pollId };
  pendingByState.set(state, pending);
  await savePendingToDisk(state, pending);

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
    return c.json({ ok: true, url, ...(pollId ? { pollId } : {}) });
  }
  return c.redirect(url, 302);
});

googleAuth.get('/callback', async (c) => {
  const cfg = getGoogleClientConfig();
  const code = c.req.query('code');
  const state = c.req.query('state');
  const err = c.req.query('error');
  if (err) {
    return c.text(`OAuth error: ${err}`, 400);
  }
  if (!code || !state) {
    return c.text('Missing code or state', 400);
  }
  const pending = await loadPendingForCallback(state);
  if (!pending) {
    return c.text('Invalid or expired state', 400);
  }

  try {
    const tokens = await exchangeCode(code, pending.codeVerifier, cfg);
    await clearPendingEverywhere(state);
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

    // 系统浏览器与 Electron 的 Cookie 不共享：桌面 handoff 只把 JWT 暂存，由 Electron 轮询 /electron-poll 领取并 Set-Cookie
    if (pending.pollId) {
      pollReadyById.set(pending.pollId, { token, exp: Date.now() + POLL_READY_TTL_MS });
      return c.redirect('/api/auth/google/desktop-done', 302);
    }

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
    const cause =
      e instanceof Error && e.cause != null ? ` (${String((e as Error & { cause?: unknown }).cause)})` : '';
    const combined = `${msg}${cause}`;
    const tlsHint =
      /cert|TLS|SSL|verify|verification/i.test(combined) &&
      process.env.PP_GOOGLE_FETCH_TLS_INSECURE !== '1' &&
      process.env.PP_TLS_RELAX_EXTERNAL !== '1'
        ? ' Dev-only: set PP_GOOGLE_FETCH_TLS_INSECURE=1 in .env.local and restart Hono, or fix trust store / NODE_EXTRA_CA_CERTS / HTTPS_PROXY.'
        : '';
    return c.text(`OAuth callback failed: ${combined}${tlsHint}`, 500);
  }
});

googleAuth.get('/desktop-done', (c) => {
  const back = 'projectpilot://oauth/return';
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Google — ProjectPilot</title></head>
<body style="font-family:system-ui,sans-serif;max-width:36rem;margin:3rem auto;padding:0 1rem;line-height:1.5">
  <p><strong>Google 登录成功。</strong></p>
  <p>正在尝试打开 <strong>ProjectPilot</strong>… 若未自动置前，请点击下方链接或手动切换到应用窗口。</p>
  <p><a href="${back}">返回 ProjectPilot</a></p>
  <p style="color:#666">Electron 已登录后也会自动检测；此页可关闭。</p>
  <script>
    (function(){
      var u = ${JSON.stringify(back)};
      function go(){ try { window.location.href = u; } catch(e) {} }
      setTimeout(go, 200);
      setTimeout(go, 1200);
    })();
  </script>
</body></html>`;
  return c.html(html);
});

googleAuth.get('/electron-poll', (c) => {
  const pollId = c.req.query('pollId')?.trim();
  if (!pollId || pollId.length < 32 || pollId.length > 256) {
    return c.json({ ok: false, error: 'bad_poll_id' }, 400);
  }
  for (const [id, v] of pollReadyById) {
    if (v.exp < Date.now()) pollReadyById.delete(id);
  }
  const entry = pollReadyById.get(pollId);
  if (!entry) {
    return c.json({ ok: true, pending: true });
  }
  if (entry.exp < Date.now()) {
    pollReadyById.delete(pollId);
    return c.json({ ok: false, error: 'expired' }, 410);
  }
  pollReadyById.delete(pollId);
  setCookie(c, SESSION_COOKIE, entry.token, {
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
    secure: false,
    maxAge: SESSION_MAX_AGE_SEC,
  });
  return c.json({ ok: true, pending: false });
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
