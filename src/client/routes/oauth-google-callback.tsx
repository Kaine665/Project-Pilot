/**
 * OAuth callback page — /oauth/google/callback
 *
 * Google redirects here after user authenticates.
 * This page runs in the browser (which has working VPN) and:
 * 1. Exchanges the auth code for tokens (browser → Google)
 * 2. Posts tokens to backend for storage (browser → localhost backend)
 * 3. Performs initial Drive sync
 * 4. Redirects to settings page
 */
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import {
  loadPendingAsync,
  clearPending,
  exchangeCodeForTokens,
  decodeIdTokenPayload,
  saveRefreshToken,
} from '@/lib/google-oauth-browser';
import { apiUrl } from '@/lib/api-base';
import { runGoogleDriveSyncInBrowser } from '@/lib/google-drive-sync-browser-flow';

export default function OAuthGoogleCallback() {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  /** StrictMode 会重复挂载 effect；/load-pending 读一次即删盘，重复请求会第二次 404。 */
  const handledRef = useRef(false);

  useEffect(() => {
    if (handledRef.current) return;
    handledRef.current = true;
    void handleCallback();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCallback() {
    try {
      const code = searchParams.get('code');
      const state = searchParams.get('state');
      const error = searchParams.get('error');

      if (error) {
        throw new Error(`Google returned error: ${error}`);
      }
      if (!code || !state) {
        throw new Error('Missing code or state in callback URL');
      }

      // Load PKCE state from sessionStorage or backend disk (Electron handoff)
      const pending = await loadPendingAsync();
      if (!pending) {
        throw new Error('No pending OAuth state found. Please try logging in again.');
      }
      if (pending.state !== state) {
        throw new Error('State mismatch — possible CSRF. Please try again.');
      }

      // Exchange code for tokens (browser → Google, browser has VPN)
      const tokens = await exchangeCodeForTokens(code, pending.codeVerifier);

      if (!tokens.refresh_token) {
        throw new Error('No refresh_token received. Try revoking app access in Google Account settings and retry.');
      }

      // Decode id_token to get user info
      let sub = '';
      let email = '';
      if (tokens.id_token) {
        const payload = decodeIdTokenPayload(tokens.id_token);
        sub = payload.sub;
        email = payload.email ?? '';
      }

      // Store refresh token in browser localStorage
      saveRefreshToken(tokens.refresh_token);

      // Send to backend: store refresh_token on disk + set session cookie
      const completeRes = await fetch(apiUrl('/api/auth/google/complete'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          refresh_token: tokens.refresh_token,
          sub,
          email,
        }),
      });
      if (!completeRes.ok) {
        const errBody = await completeRes.text();
        throw new Error(`Backend /complete failed: ${errBody}`);
      }

      // Initial Drive sync（仅浏览器内调 Google，与桌面版桥接逻辑一致）
      try {
        await runGoogleDriveSyncInBrowser(tokens.refresh_token, false);
      } catch (syncErr) {
        console.warn('[OAuth callback] Drive sync failed:', syncErr);
      }

      clearPending();
      setStatus('success');

      // Redirect to settings page after a brief success display
      const returnPath = pending.returnPath || '/workspace/settings?section=googleSync';
      setTimeout(() => {
        window.location.href = `${returnPath}${returnPath.includes('?') ? '&' : '?'}google=ok`;
      }, 1500);
    } catch (err) {
      console.error('[OAuth callback] Error:', err);
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setStatus('error');
    }
  }

  return (
    <div style={{
      fontFamily: 'system-ui, sans-serif',
      maxWidth: '36rem',
      margin: '3rem auto',
      padding: '0 1rem',
      lineHeight: 1.6,
      textAlign: 'center',
    }}>
      {status === 'loading' && (
        <>
          <p style={{ fontSize: '2rem' }}>⏳</p>
          <p><strong>正在完成 Google 登录…</strong></p>
          <p style={{ color: '#666' }}>正在与 Google 交换凭据，请稍候。</p>
        </>
      )}
      {status === 'success' && (
        <>
          <p style={{ fontSize: '2rem' }}>✅</p>
          <p><strong>Google 登录成功</strong></p>
          <p style={{ color: '#666' }}>正在返回 ProjectPilot…</p>
        </>
      )}
      {status === 'error' && (
        <>
          <p style={{ fontSize: '2rem' }}>❌</p>
          <p><strong>登录失败</strong></p>
          <p style={{ color: '#c00' }}>{errorMsg}</p>
          <p style={{ marginTop: '1rem' }}>
            <a href="/workspace/settings?section=googleSync" style={{ color: '#0066cc' }}>
              返回设置页面重试
            </a>
          </p>
        </>
      )}
    </div>
  );
}
