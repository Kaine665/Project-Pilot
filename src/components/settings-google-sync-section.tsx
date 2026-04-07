'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Cloud, Loader2, LogOut, Download, Upload } from 'lucide-react';
import { apiUrl } from '@/lib/api-base';
import {
  generatePKCE,
  generateState,
  buildGoogleAuthUrl,
  savePending,
  getRefreshToken,
  saveRefreshToken,
  clearRefreshToken,
  refreshAccessToken,
} from '@/lib/google-oauth-browser';
import { pullFromDrive, pushToDrive } from '@/lib/google-drive-browser';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TranslationFn = (key: string, params?: any) => string;

interface Props {
  t: TranslationFn;
  btnActive: string;
  btnInactive: string;
  /** 含语言前缀的完整路径，如 /en/workspace/settings?section=googleSync */
  oauthReturnPath: string;
  connectedBanner?: boolean;
  onDismissConnectedBanner?: () => void;
  onAfterPull?: () => void;
  onDesktopOAuthConnected?: () => void;
}

export function SettingsGoogleSyncSection({
  t,
  btnActive,
  btnInactive,
  oauthReturnPath,
  connectedBanner,
  onDismissConnectedBanner,
  onAfterPull,
}: Props) {
  const [statusLoading, setStatusLoading] = useState(true);
  const [signedIn, setSignedIn] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState<'pull' | 'push' | 'out' | null>(null);

  const refreshStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      const res = await fetch(apiUrl('/api/auth/google/status'), { credentials: 'include' });
      const j = (await res.json()) as { signedIn?: boolean; email?: string | null };
      setSignedIn(!!j.signedIn);
      setEmail(j.email ?? null);

      // Migration: if signed in via session cookie but no refresh token in localStorage,
      // fetch it from backend disk storage.
      if (j.signedIn && !getRefreshToken()) {
        try {
          const exportRes = await fetch(apiUrl('/api/auth/google/export-refresh-token'), {
            credentials: 'include',
          });
          if (exportRes.ok) {
            const exportJ = (await exportRes.json()) as { ok?: boolean; refresh_token?: string };
            if (exportJ.refresh_token) {
              saveRefreshToken(exportJ.refresh_token);
            }
          }
        } catch {
          // Non-fatal
        }
      }
    } catch {
      setSignedIn(false);
      setEmail(null);
    } finally {
      setStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const startLogin = async () => {
    setFlash(null);
    try {
      const { codeVerifier, codeChallenge } = await generatePKCE();
      const state = generateState();

      savePending({ codeVerifier, state, returnPath: oauthReturnPath });

      const authUrl = buildGoogleAuthUrl({ state, codeChallenge });

      // Open in system browser (Electron) or new tab (web)
      if (typeof window !== 'undefined' && typeof window.electron?.openExternalUrl === 'function') {
        const opened = await window.electron.openExternalUrl(authUrl);
        if (opened?.error) {
          setFlash({ type: 'err', text: opened.error });
          return;
        }
        setFlash({ type: 'ok', text: t('googleSyncOpenBrowserHint') });

        // Electron: callback lands in system browser, not here.
        // Poll /status until the callback page completes and sets the session cookie.
        const pollStart = Date.now();
        const interval = setInterval(async () => {
          if (Date.now() - pollStart > 5 * 60 * 1000) {
            clearInterval(interval);
            setFlash({ type: 'err', text: t('googleSyncError') });
            return;
          }
          try {
            const sr = await fetch(apiUrl('/api/auth/google/status'), { credentials: 'include' });
            const sj = (await sr.json()) as { signedIn?: boolean; email?: string | null };
            if (!sj.signedIn) return;
            clearInterval(interval);
            setSignedIn(true);
            setEmail(sj.email ?? null);
            setStatusLoading(false);
            setFlash({ type: 'ok', text: t('googleSyncSuccessConnected') });
            void window.electron?.focusMainWindow?.();
          } catch { /* keep polling */ }
        }, 2000);
      } else {
        // Web: redirect in same tab. The callback page will redirect back here.
        window.location.href = authUrl;
      }
    } catch (err) {
      setFlash({ type: 'err', text: err instanceof Error ? err.message : t('googleSyncError') });
    }
  };

  const doPull = async () => {
    setBusy('pull');
    setFlash(null);
    try {
      const rt = getRefreshToken();
      if (!rt) {
        setFlash({ type: 'err', text: 'No refresh token. Please re-login.' });
        return;
      }
      const accessToken = await refreshAccessToken(rt);
      const blob = await pullFromDrive(accessToken);
      if (!blob) {
        setFlash({ type: 'ok', text: t('googleSyncNoRemote') });
        return;
      }
      const mergeRes = await fetch(apiUrl('/api/auth/google/sync-merge'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ blob }),
      });
      if (!mergeRes.ok) {
        setFlash({ type: 'err', text: t('googleSyncError') });
        return;
      }
      setFlash({ type: 'ok', text: t('googleSyncSuccessPull') });
      onAfterPull?.();
    } catch (err) {
      setFlash({ type: 'err', text: err instanceof Error ? err.message : t('googleSyncError') });
    } finally {
      setBusy(null);
    }
  };

  const doPush = async () => {
    setBusy('push');
    setFlash(null);
    try {
      const rt = getRefreshToken();
      if (!rt) {
        setFlash({ type: 'err', text: 'No refresh token. Please re-login.' });
        return;
      }
      // Get local blob from backend
      const blobRes = await fetch(apiUrl('/api/auth/google/sync-get-blob'), {
        credentials: 'include',
      });
      if (!blobRes.ok) {
        setFlash({ type: 'err', text: t('googleSyncError') });
        return;
      }
      const { blob } = await blobRes.json();

      const accessToken = await refreshAccessToken(rt);
      await pushToDrive(accessToken, blob);
      setFlash({ type: 'ok', text: t('googleSyncSuccessPush') });
    } catch (err) {
      setFlash({ type: 'err', text: err instanceof Error ? err.message : t('googleSyncError') });
    } finally {
      setBusy(null);
    }
  };

  const doLogout = async () => {
    setBusy('out');
    setFlash(null);
    try {
      await fetch(apiUrl('/api/auth/google/logout'), { method: 'POST', credentials: 'include' });
      clearRefreshToken();
      setSignedIn(false);
      setEmail(null);
      setFlash({ type: 'ok', text: t('googleSyncLoggedOut') });
    } catch {
      setFlash({ type: 'err', text: t('googleSyncError') });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{t('googleSyncTitle')}</h2>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{t('googleSyncIntro')}</p>
      </div>

      {connectedBanner && (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100">
          <span>{t('googleSyncSuccessConnected')}</span>
          {onDismissConnectedBanner && (
            <button
              type="button"
              className="shrink-0 underline"
              onClick={onDismissConnectedBanner}
            >
              {t('googleSyncDismiss')}
            </button>
          )}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Cloud className="h-4 w-4" />
            {t('googleSyncCardTitle')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{t('googleSyncScopeNote')}</p>

          {statusLoading ? (
            <div className="flex items-center gap-2 text-sm text-zinc-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('googleSyncStatusLoading')}
            </div>
          ) : signedIn ? (
            <p className="text-sm text-zinc-700 dark:text-zinc-300">
              {t('googleSyncStatusSignedIn')}
              {email ? ` (${email})` : ''}
            </p>
          ) : (
            <p className="text-sm text-zinc-700 dark:text-zinc-300">{t('googleSyncStatusSignedOut')}</p>
          )}

          {flash && (
            <p
              className={
                flash.type === 'ok'
                  ? 'text-sm text-emerald-700 dark:text-emerald-400'
                  : 'text-sm text-red-600 dark:text-red-400'
              }
            >
              {flash.text}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            {!signedIn ? (
              <button type="button" className={`rounded-md px-4 py-2 text-sm ${btnActive}`} onClick={startLogin}>
                {t('googleSyncLogin')}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className={`inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm ${btnInactive}`}
                  onClick={doPull}
                  disabled={!!busy}
                >
                  {busy === 'pull' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  {t('googleSyncPull')}
                </button>
                <button
                  type="button"
                  className={`inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm ${btnInactive}`}
                  onClick={doPush}
                  disabled={!!busy}
                >
                  {busy === 'push' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  {t('googleSyncPush')}
                </button>
                <button
                  type="button"
                  className={`inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm ${btnInactive}`}
                  onClick={doLogout}
                  disabled={!!busy}
                >
                  {busy === 'out' ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
                  {t('googleSyncLogout')}
                </button>
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
