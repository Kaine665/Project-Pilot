/**
 * Electron 点击「立即同步」时在系统浏览器打开此页：凭 ticket 换 refresh_token + Cookie，
 * 在浏览器内访问 Google（可走本机代理/VPN），完成后通知 Electron 轮询结束。
 */
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { apiUrl } from '@/lib/api-base';
import { fetchWithRetry } from '@/lib/fetch-retry';
import { parseLenientJson } from '@/lib/json-lenient';
import { runGoogleDriveSyncInBrowser } from '@/lib/google-drive-sync-browser-flow';

export default function OAuthGoogleBrowserSync() {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const handledRef = useRef(false);

  useEffect(() => {
    if (handledRef.current) return;
    handledRef.current = true;
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function run() {
    const ticket = searchParams.get('ticket')?.trim();
    if (!ticket) {
      setErrorMsg('缺少 ticket，请从 ProjectPilot 桌面版重新发起同步。');
      setStatus('error');
      return;
    }
    try {
      const claimRes = await fetchWithRetry(apiUrl('/api/auth/google/browser-sync-claim'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ ticket }),
      });
      const claimJ = parseLenientJson(await claimRes.text()) as {
        ok?: boolean;
        refresh_token?: string;
        error?: string;
      };
      if (!claimRes.ok || !claimJ.ok || !claimJ.refresh_token) {
        throw new Error(claimJ.error || `claim failed (${claimRes.status})`);
      }

      await runGoogleDriveSyncInBrowser(claimJ.refresh_token, true);
      setStatus('success');
    } catch (e) {
      console.error('[browser-sync]', e);
      setErrorMsg(e instanceof Error ? e.message : String(e));
      setStatus('error');
    }
  }

  return (
    <div
      style={{
        fontFamily: 'system-ui, sans-serif',
        maxWidth: '36rem',
        margin: '3rem auto',
        padding: '0 1rem',
        lineHeight: 1.6,
        textAlign: 'center',
      }}
    >
      {status === 'loading' && (
        <>
          <p style={{ fontSize: '2rem' }}>⏳</p>
          <p>
            <strong>正在通过浏览器同步 Google Drive…</strong>
          </p>
          <p style={{ color: '#666' }}>请保持此标签页打开直至完成。</p>
        </>
      )}
      {status === 'success' && (
        <>
          <p style={{ fontSize: '2rem' }}>✅</p>
          <p>
            <strong>同步完成</strong>
          </p>
          <p style={{ color: '#666' }}>可关闭此标签页，回到 ProjectPilot。</p>
        </>
      )}
      {status === 'error' && (
        <>
          <p style={{ fontSize: '2rem' }}>❌</p>
          <p>
            <strong>同步失败</strong>
          </p>
          <p style={{ color: '#c00' }}>{errorMsg}</p>
          <p style={{ marginTop: '1.25rem' }}>
            <button
              type="button"
              onClick={() => {
                setStatus('loading');
                setErrorMsg('');
                void run();
              }}
              style={{
                fontSize: '1rem',
                padding: '0.5rem 1rem',
                cursor: 'pointer',
              }}
            >
              重试同步
            </button>
          </p>
        </>
      )}
    </div>
  );
}
