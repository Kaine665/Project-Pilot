/**
 * Browser-side Google OAuth utilities.
 * All Google API communication happens in the browser (which has working VPN),
 * eliminating backend dependency on reaching Google servers.
 */

// Embedded OAuth credentials — Google considers this acceptable for installed/native apps.
// These are NOT secrets in the traditional sense; Google uses redirect_uri + PKCE for security.
const GOOGLE_CLIENT_ID = '469599503504-dmhuho50val4lgtb7kslhg524e29vq5d.apps.googleusercontent.com';
const GOOGLE_CLIENT_SECRET = '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';

const OAUTH_SCOPES = 'openid email profile https://www.googleapis.com/auth/drive.appdata';
const REDIRECT_URI = `${window.location.origin}/oauth/google/callback`;

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
    redirect_uri: REDIRECT_URI,
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
    redirect_uri: REDIRECT_URI,
    grant_type: 'authorization_code',
    code_verifier: codeVerifier,
  });
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed: ${text}`);
  }
  return res.json();
}

export async function refreshAccessToken(refreshToken: string): Promise<string> {
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: GOOGLE_CLIENT_ID,
    client_secret: GOOGLE_CLIENT_SECRET,
    grant_type: 'refresh_token',
  });
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token refresh failed: ${text}`);
  }
  const j = (await res.json()) as { access_token: string };
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

export function savePending(pending: PendingOAuth): void {
  sessionStorage.setItem(STORAGE_KEY_PENDING, JSON.stringify(pending));
}

export function loadPending(): PendingOAuth | null {
  const raw = sessionStorage.getItem(STORAGE_KEY_PENDING);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function clearPending(): void {
  sessionStorage.removeItem(STORAGE_KEY_PENDING);
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
