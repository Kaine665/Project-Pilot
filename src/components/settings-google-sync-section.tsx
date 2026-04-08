'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Cloud, Loader2, LogOut, RefreshCw, Check } from 'lucide-react';
import { apiUrl } from '@/lib/api-base';
import { parseLenientJson } from '@/lib/json-lenient';
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
  const [busy, setBusy] = useState<'login' | 'sync' | 'out' | null>(null);
  const [lastSynced, setLastSynced] = useState<Date | null>(null);
  const autoSyncDone = useRef(false);
  /** 父组件常传内联 `onAfterPull`，进 useCallback 会导致 refreshStatus/effect 每条渲染链都变 → 无限拉 status */
  const onAfterPullRef = useRef(onAfterPull);
  onAfterPullRef.current = onAfterPull;
  const tRef = useRef(t);
  tRef.current = t;

  /** Detect Electron environment（ref 供 useCallback 内读取，避免依赖变化） */
  const isElectronRef = useRef(false);
  isElectronRef.current =
    typeof window !== 'undefined' &&
    (typeof window.electron?.openExternalUrl === 'function' ||
      navigator.userAgent.includes('Electron'));
  const isElectron = isElectronRef.current;

  // ── Auto-sync: Web 在内嵌页直连 Google；Electron 仅手动同步时打开系统浏览器桥接 ──

  const doAutoSync = useCallback(async (silent = true) => {
    const tr = tRef.current;
    if (isElectronRef.current) {
      if (silent) return;
      setBusy('sync');
      try {
        const startRes = await fetch(apiUrl('/api/auth/google/browser-sync-start'), {
          method: 'POST',
          credentials: 'include',
        });
        const startJ = parseLenientJson(await startRes.text()) as {
          ok?: boolean;
          url?: string;
          error?: string;
        };
        if (!startRes.ok || !startJ.ok || !startJ.url) {
          throw new Error(startJ.error || `sync-start failed (${startRes.status})`);
        }
        if (typeof window.electron?.openExternalUrl === 'function') {
          const opened = await window.electron.openExternalUrl(startJ.url);
          if (opened?.error) throw new Error(opened.error);
        } else {
          // 无 preload IPC 时仍可用：main 的 setWindowOpenHandler 会把本机 /oauth/google/ 弹窗交给系统浏览器
          window.open(startJ.url, '_blank', 'noopener,noreferrer');
        }
        setFlash({ type: 'ok', text: tr('googleSyncBrowserSyncOpened') });

        const deadline = Date.now() + 3 * 60 * 1000;
        let sawDone = false;
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 1000));
          const pr = await fetch(apiUrl('/api/auth/google/poll-browser-sync'), { credentials: 'include' });
          const pj = parseLenientJson(await pr.text()) as { done?: boolean };
          if (pj.done) {
            sawDone = true;
            break;
          }
        }
        if (!sawDone) throw new Error(tr('googleSyncBrowserSyncTimeout'));

        setLastSynced(new Date());
        onAfterPullRef.current?.();
        setFlash({ type: 'ok', text: tr('googleSyncSynced') });
      } catch (err) {
        setFlash({ type: 'err', text: err instanceof Error ? err.message : tr('googleSyncError') });
      } finally {
        setBusy(null);
      }
      return;
    }

    const rt = getRefreshToken();
    if (!rt) return;

    if (!silent) setBusy('sync');
    try {
      const accessToken = await refreshAccessToken(rt);

      const remoteBlob = await pullFromDrive(accessToken);
      if (remoteBlob) {
        await fetch(apiUrl('/api/auth/google/sync-merge'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ blob: remoteBlob }),
        });
        onAfterPullRef.current?.();
      }

      const blobRes = await fetch(apiUrl('/api/auth/google/sync-get-blob'), {
        credentials: 'include',
      });
      if (blobRes.ok) {
        const { blob } = parseLenientJson(await blobRes.text()) as { blob?: unknown };
        if (blob) await pushToDrive(accessToken, blob);
      }

      setLastSynced(new Date());
      if (!silent) setFlash({ type: 'ok', text: tr('googleSyncSynced') });
    } catch (err) {
      if (!silent) {
        setFlash({ type: 'err', text: err instanceof Error ? err.message : tr('googleSyncError') });
      }
    } finally {
      if (!silent) setBusy(null);
    }
  }, []);

  // ── Check login status ──

  const refreshStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      const res = await fetch(apiUrl('/api/auth/google/status'), { credentials: 'include' });
      const j = parseLenientJson(await res.text()) as { signedIn?: boolean; email?: string | null };
      setSignedIn(!!j.signedIn);
      setEmail(j.email ?? null);

      // Migration: fetch refresh token from backend if not in localStorage
      if (j.signedIn && !getRefreshToken()) {
        try {
          const exportRes = await fetch(apiUrl('/api/auth/google/export-refresh-token'), {
            credentials: 'include',
          });
          if (exportRes.ok) {
            const exportJ = parseLenientJson(await exportRes.text()) as {
              ok?: boolean;
              refresh_token?: string;
            };
            if (exportJ.refresh_token) {
              saveRefreshToken(exportJ.refresh_token);
            }
          }
        } catch {
          // Non-fatal
        }
      }

      // Auto-sync on page load (once) if signed in — Electron 不在此静默打开系统浏览器
      if (j.signedIn && !autoSyncDone.current) {
        autoSyncDone.current = true;
        if (!isElectronRef.current) {
          void doAutoSync(true);
        }
      }
    } catch {
      setSignedIn(false);
      setEmail(null);
    } finally {
      setStatusLoading(false);
    }
  }, [doAutoSync]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  // ── Login ──

  const startLogin = async () => {
    setFlash(null);
    setBusy('login');
    try {
      const { codeVerifier, codeChallenge } = await generatePKCE();
      const state = generateState();

      const { serverSaved } = await savePending({ codeVerifier, state, returnPath: oauthReturnPath });
      if (isElectron && !serverSaved) {
        setFlash({
          type: 'err',
          text: t('googleSyncErrorSavePending'),
        });
        setBusy(null);
        return;
      }

      const authUrl = buildGoogleAuthUrl({ state, codeChallenge });

      if (isElectron) {
        if (typeof window.electron?.openExternalUrl === 'function') {
          const opened = await window.electron.openExternalUrl(authUrl);
          if (opened?.error) {
            setFlash({ type: 'err', text: opened.error });
            setBusy(null);
            return;
          }
        } else {
          window.open(authUrl, '_blank');
        }
        setFlash({ type: 'ok', text: t('googleSyncOpenBrowserHint') });

        // Electron: poll for login completion from system browser
        const pollStart = Date.now();
        const interval = setInterval(async () => {
          if (Date.now() - pollStart > 5 * 60 * 1000) {
            clearInterval(interval);
            setFlash({ type: 'err', text: t('googleSyncError') });
            setBusy(null);
            return;
          }
          try {
            const sr = await fetch(apiUrl('/api/auth/google/poll-login'), { credentials: 'include' });
            const sj = parseLenientJson(await sr.text()) as { signedIn?: boolean; email?: string | null };
            if (!sj.signedIn) return;
            clearInterval(interval);
            setSignedIn(true);
            setEmail(sj.email ?? null);
            setBusy(null);

            // Grab refresh token for localStorage
            try {
              const rtRes = await fetch(apiUrl('/api/auth/google/export-refresh-token'), { credentials: 'include' });
              if (rtRes.ok) {
                const rtJ = parseLenientJson(await rtRes.text()) as { refresh_token?: string };
                if (rtJ.refresh_token) saveRefreshToken(rtJ.refresh_token);
              }
            } catch { /* non-fatal */ }

            setFlash({ type: 'ok', text: t('googleSyncSuccessConnected') });
            void window.electron?.focusMainWindow?.();
          } catch { /* keep polling */ }
        }, 2000);
      } else {
        // Web: redirect to Google. Callback page handles the rest.
        window.location.href = authUrl;
      }
    } catch (err) {
      setFlash({ type: 'err', text: err instanceof Error ? err.message : t('googleSyncError') });
      setBusy(null);
    }
  };

  // ── Logout (auto-push before signing out) ──

  const doLogout = async () => {
    setBusy('out');
    setFlash(null);
    try {
      if (!isElectronRef.current) {
        try {
          await doAutoSync(true);
        } catch {
          /* best effort */
        }
      }

      await fetch(apiUrl('/api/auth/google/logout'), { method: 'POST', credentials: 'include' });
      clearRefreshToken();
      setSignedIn(false);
      setEmail(null);
      setLastSynced(null);
      autoSyncDone.current = false;
      setFlash({ type: 'ok', text: t('googleSyncLoggedOut') });
    } catch {
      setFlash({ type: 'err', text: t('googleSyncError') });
    } finally {
      setBusy(null);
    }
  };

  // ── Format last sync time ──

  const formatSyncTime = (d: Date) => {
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 60_000) return t('googleSyncJustNow');
    if (diff < 3600_000) return t('googleSyncMinutesAgo', { n: Math.floor(diff / 60_000) });
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
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
            <button type="button" className="shrink-0 underline" onClick={onDismissConnectedBanner}>
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
          {statusLoading ? (
            <div className="flex items-center gap-2 text-sm text-zinc-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('googleSyncStatusLoading')}
            </div>
          ) : signedIn ? (
            /* ── Connected state ── */
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-emerald-500" />
                <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                  {email}
                </span>
              </div>

              {lastSynced && (
                <p className="flex items-center gap-1.5 text-xs text-zinc-400 dark:text-zinc-500">
                  <Check className="h-3 w-3" />
                  {t('googleSyncLastSynced', { time: formatSyncTime(lastSynced) })}
                </p>
              )}

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm ${btnInactive}`}
                  onClick={() => void doAutoSync(false)}
                  disabled={!!busy}
                >
                  {busy === 'sync'
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <RefreshCw className="h-3.5 w-3.5" />}
                  {t('googleSyncNow')}
                </button>
                <button
                  type="button"
                  className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm text-zinc-500 hover:text-red-600 dark:text-zinc-400 dark:hover:text-red-400 ${btnInactive}`}
                  onClick={doLogout}
                  disabled={!!busy}
                >
                  {busy === 'out'
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <LogOut className="h-3.5 w-3.5" />}
                  {t('googleSyncDisconnect')}
                </button>
              </div>
            </div>
          ) : (
            /* ── Not connected state ── */
            <div className="space-y-3">
              <p className="text-sm text-zinc-500 dark:text-zinc-400">{t('googleSyncStatusSignedOut')}</p>
              <button
                type="button"
                className={`inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm ${btnActive}`}
                onClick={startLogin}
                disabled={!!busy}
              >
                {busy === 'login' && <Loader2 className="h-4 w-4 animate-spin" />}
                {t('googleSyncLogin')}
              </button>
            </div>
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
        </CardContent>
      </Card>
    </div>
  );
}
