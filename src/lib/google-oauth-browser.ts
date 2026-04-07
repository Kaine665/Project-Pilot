/**
 * Browser-side Google OAuth utilities.
 * All Google API communication happens in the browser (which has working VPN),
 * eliminating backend dependency on reaching Google servers.
 */

import { apiUrl } from '@/lib/api-base';
import { fetchWithRetry } from '@/lib/fetch-retry';
import { parseLenientJson } from '@/lib/json-lenient';

// Embedded OAuth credentials — Google considers this acceptable for installed/native apps.
// These are NOT secrets in the traditional sense; Google uses redirect_uri + PKCE for security.
const GOOGLE_CLIENT_ID = '469599503504-dmhuho50val4lgtb7kslhg524e29vq5d.apps.googleusercontent.com';
const GOOGLE_CLIENT_SECRET = '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';

const OAUTH_SCOPES = 'openid email profile https://www.googleapis.com/auth/drive.appdata';

/** Redirect URI — use origin at call time to support both Electron and web contexts */
function getRedirectUri(): string {
  return `${window.location.origin}/oauth/google/callback`;
}

const STORAGE_KEY_PENDING = 'pp_google_oauth_pending';
const STORAGE_KEY_REFRESH = 'pp_google_refresh_token';

// ── PKCE helpers ──

export async function generatePKCE(): Promise<{ codeVerifier: string; codeChallenge: string }> {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  const codeVerifier = base64url(array);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier));
  const codeChallenge = base64url(new Uint8Array(digest));
  return { codeVerifier, codeChallenge };
}

export function generateState(): string {
  const array = new Uint8Array(24);
  crypto.getRandomValues(array);
  return base64url(array);
}

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ── Auth URL ──

export function buildGoogleAuthUrl(params: {
  state: string;
  codeChallenge: string;
}): string {
  const qs = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: getRedirectUri(),
    response_type: 'code',
    scope: OAUTH_SCOPES,
    state: params.state,
    access_type: 'offline',
    prompt: 'consent',
    code_challenge: params.codeChallenge,
    code_challenge_method: 'S256',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${qs.toString()}`;
}

// ── Token exchange ──

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
  token_type?: string;
}

export async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    code,
    client_id: GOOGLE_CLIENT_ID,
    client_secret: GOOGLE_CLIENT_SECRET,
    redirect_uri: getRedirectUri(),
    grant_type: 'authorization_code',
    code_verifier: codeVerifier,
  });
  const res = await fetchWithRetry('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed: ${text}`);
  }
  const raw = await res.text();
  return parseLenientJson(raw) as TokenResponse;
}

export async function refreshAccessToken(refreshToken: string): Promise<string> {
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: GOOGLE_CLIENT_ID,
    client_secret: GOOGLE_CLIENT_SECRET,
    grant_type: 'refresh_token',
  });
  const res = await fetchWithRetry('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token refresh failed: ${text}`);
  }
  const raw = await res.text();
  const j = parseLenientJson(raw) as { access_token?: string };
  if (!j.access_token) throw new Error('Token refresh: missing access_token in response');
  return j.access_token;
}

// ── ID Token decode ──

export function decodeIdTokenPayload(idToken: string): { sub: string; email?: string } {
  const parts = idToken.split('.');
  if (parts.length < 2) throw new Error('Invalid id_token');
  const payload = parts[1]!;
  const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4);
  const decoded = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  return JSON.parse(decoded);
}

// ── Session storage for PKCE state ──

export interface PendingOAuth {
  codeVerifier: string;
  state: string;
  returnPath: string;
}

/**
 * Save PKCE pending state to sessionStorage AND backend disk.
 * SessionStorage is used for same-browser callback (web mode).
 * Backend disk is used for cross-browser callback (Electron → system browser).
 * MUST be awaited before opening the auth URL to avoid race conditions.
 *
 * @returns `serverSaved` — `true` 若后端已持久化；Electron 外开系统浏览器时必须为 true。
 */
export async function savePending(pending: PendingOAuth): Promise<{ serverSaved: boolean }> {
  try {
    sessionStorage.setItem(STORAGE_KEY_PENDING, JSON.stringify(pending));
  } catch {
    // sessionStorage may not be available
  }
  // Also persist to backend for Electron → system browser handoff.
  // Must await — if auth redirect arrives before this completes, callback can't load PKCE state.
  try {
    const res = await fetch(apiUrl('/api/auth/google/save-pending'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(pending),
    });
    return { serverSaved: res.ok };
  } catch {
    return { serverSaved: false };
  }
}

/**
 * Load PKCE pending state. Tries sessionStorage first (fast, same browser),
 * falls back to backend disk (cross-browser handoff from Electron).
 */
export function loadPending(): PendingOAuth | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY_PENDING);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore
  }
  return null;
}

/**
 * Async version of loadPending that also tries the backend as fallback.
 * Used by the OAuth callback page which may be in a different browser than the initiator.
 */
export async function loadPendingAsync(): Promise<PendingOAuth | null> {
  // Try sessionStorage first
  const local = loadPending();
  if (local) return local;

  // Fallback: fetch from backend disk (Electron → system browser handoff)
  try {
    const res = await fetch(apiUrl('/api/auth/google/load-pending'), { credentials: 'include' });
    if (!res.ok) return null;
    const j = (await res.json()) as { ok?: boolean; codeVerifier?: string; state?: string; returnPath?: string };
    if (!j.ok || !j.codeVerifier || !j.state) return null;
    return { codeVerifier: j.codeVerifier, state: j.state, returnPath: j.returnPath ?? '' };
  } catch {
    return null;
  }
}

export function clearPending(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY_PENDING);
  } catch {
    // ignore
  }
}

// ── Refresh token persistence (localStorage) ──

export function saveRefreshToken(token: string): void {
  localStorage.setItem(STORAGE_KEY_REFRESH, token);
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(STORAGE_KEY_REFRESH);
}

export function clearRefreshToken(): void {
  localStorage.removeItem(STORAGE_KEY_REFRESH);
}
