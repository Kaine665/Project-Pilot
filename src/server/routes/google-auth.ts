/**
 * Google 账号登录（OAuth2）— 用于按用户隔离本地数据目录。
 */
import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { randomBytes } from 'crypto';
import {
  COOKIE_NAME,
  getGoogleOAuthConfig,
  signSessionToken,
} from '@/lib/google-account-auth';
import type { AccountVariables } from '../middleware/account-data-root';

const STATE_COOKIE = 'pp_google_oauth_state';
const STATE_MAX_AGE = 600;

const app = new Hono<{ Variables: AccountVariables }>();

function publicOrigin(): string {
  const raw = process.env.PROJECT_PILOT_PUBLIC_ORIGIN?.trim();
  if (raw) return raw.replace(/\/$/, '');
  return 'http://127.0.0.1:4000';
}

function isConfigured(): boolean {
  return getGoogleOAuthConfig() !== null;
}

app.get('/status', (c) => {
  const user = c.get('ppUser');
  return c.json({
    configured: isConfigured(),
    user: user
      ? { sub: user.sub, email: user.email, name: user.name, picture: user.picture }
      : null,
  });
});

app.get('/login', (c) => {
  const cfg = getGoogleOAuthConfig();
  if (!cfg) {
    return c.json({ error: 'Google OAuth is not configured on the server.' }, 503);
  }

  const state = randomBytes(24).toString('hex');
  setCookie(c, STATE_COOKIE, state, {
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
    maxAge: STATE_MAX_AGE,
    secure: process.env.NODE_ENV === 'production',
  });

  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'offline',
    prompt: 'consent',
  });

  const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  return c.redirect(url);
});

interface GoogleTokenResponse {
  access_token?: string;
  expires_in?: number;
  id_token?: string;
  refresh_token?: string;
  token_type?: string;
}

interface GoogleUserInfo {
  sub?: string;
  email?: string;
  name?: string;
  picture?: string;
}

app.get('/callback', async (c) => {
  const cfg = getGoogleOAuthConfig();
  if (!cfg) {
    return c.text('Google OAuth is not configured.', 503);
  }

  const qState = c.req.query('state');
  const code = c.req.query('code');
  const err = c.req.query('error');

  if (err) {
    return c.redirect(`${publicOrigin()}/settings?google=error&message=${encodeURIComponent(err)}`);
  }

  const cookieState = getCookie(c, STATE_COOKIE);
  deleteCookie(c, STATE_COOKIE, { path: '/' });

  if (!qState || !cookieState || qState !== cookieState) {
    return c.redirect(`${publicOrigin()}/settings?google=error&message=${encodeURIComponent('invalid state')}`);
  }

  if (!code) {
    return c.redirect(`${publicOrigin()}/settings?google=error&message=${encodeURIComponent('missing code')}`);
  }

  const body = new URLSearchParams({
    code,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    redirect_uri: cfg.redirectUri,
    grant_type: 'authorization_code',
  });

  let tokenJson: GoogleTokenResponse;
  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    tokenJson = (await tokenRes.json()) as GoogleTokenResponse;
    if (!tokenRes.ok || !tokenJson.access_token) {
      const msg = (tokenJson as { error_description?: string }).error_description ?? 'token exchange failed';
      return c.redirect(`${publicOrigin()}/settings?google=error&message=${encodeURIComponent(msg)}`);
    }
  } catch (e) {
    return c.redirect(
      `${publicOrigin()}/settings?google=error&message=${encodeURIComponent(e instanceof Error ? e.message : 'network error')}`,
    );
  }

  let userInfo: GoogleUserInfo;
  try {
    const uiRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokenJson.access_token}` },
    });
    userInfo = (await uiRes.json()) as GoogleUserInfo;
    if (!uiRes.ok || typeof userInfo.sub !== 'string' || !userInfo.sub.trim()) {
      return c.redirect(`${publicOrigin()}/settings?google=error&message=${encodeURIComponent('userinfo failed')}`);
    }
  } catch (e) {
    return c.redirect(
      `${publicOrigin()}/settings?google=error&message=${encodeURIComponent(e instanceof Error ? e.message : 'userinfo error')}`,
    );
  }

  const jwt = await signSessionToken({
    sub: userInfo.sub.trim(),
    email: typeof userInfo.email === 'string' ? userInfo.email : undefined,
    name: typeof userInfo.name === 'string' ? userInfo.name : undefined,
    picture: typeof userInfo.picture === 'string' ? userInfo.picture : undefined,
  });

  setCookie(c, COOKIE_NAME, jwt, {
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
    maxAge: 60 * 60 * 24 * 14,
    secure: process.env.NODE_ENV === 'production',
  });

  return c.redirect(`${publicOrigin()}/settings?google=ok`);
});

app.post('/logout', (c) => {
  deleteCookie(c, COOKIE_NAME, { path: '/' });
  return c.json({ ok: true });
});

export default app;
