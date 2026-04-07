'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Cloud, Loader2, LogOut, Download, Upload } from 'lucide-react';
import { apiUrl } from '@/lib/api-base';

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
    const rp = encodeURIComponent(oauthReturnPath);
    const startHref = apiUrl(`/api/auth/google/start?returnPath=${rp}`);

    // Electron：整页跳到 Google 常被识别为嵌入式浏览器 → 空白页；改为系统浏览器打开授权链接。
    if (typeof window !== 'undefined' && window.electron?.openExternalUrl) {
      setFlash(null);
      try {
        const res = await fetch(`${startHref}${startHref.includes('?') ? '&' : '?'}json=1`);
        const j = (await res.json()) as { ok?: boolean; url?: string; error?: string };
        if (!res.ok || !j.ok || !j.url) {
          setFlash({
            type: 'err',
            text: j.error || (res.status === 503 ? t('googleSyncNotConfigured') : t('googleSyncError')),
          });
          return;
        }
        const opened = await window.electron.openExternalUrl(j.url);
        if (opened?.error) {
          setFlash({ type: 'err', text: opened.error });
          return;
        }
        setFlash({ type: 'ok', text: t('googleSyncOpenBrowserHint') });
      } catch {
        setFlash({ type: 'err', text: t('googleSyncError') });
      }
      return;
    }

    window.location.href = startHref;
  };

  const doPull = async () => {
    setBusy('pull');
    setFlash(null);
    try {
      const res = await fetch(apiUrl('/api/auth/google/sync-pull'), {
        method: 'POST',
        credentials: 'include',
      });
      const j = (await res.json()) as { ok?: boolean; error?: string; merged?: boolean; message?: string };
      if (!res.ok) {
        setFlash({ type: 'err', text: j.error || t('googleSyncError') });
        return;
      }
      if (j.merged) {
        setFlash({ type: 'ok', text: t('googleSyncSuccessPull') });
        onAfterPull?.();
      } else {
        setFlash({ type: 'ok', text: t('googleSyncNoRemote') });
      }
    } catch {
      setFlash({ type: 'err', text: t('googleSyncError') });
    } finally {
      setBusy(null);
    }
  };

  const doPush = async () => {
    setBusy('push');
    setFlash(null);
    try {
      const res = await fetch(apiUrl('/api/auth/google/sync-push'), {
        method: 'POST',
        credentials: 'include',
      });
      const j = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) {
        setFlash({ type: 'err', text: j.error || t('googleSyncError') });
        return;
      }
      setFlash({ type: 'ok', text: t('googleSyncSuccessPush') });
    } catch {
      setFlash({ type: 'err', text: t('googleSyncError') });
    } finally {
      setBusy(null);
    }
  };

  const doLogout = async () => {
    setBusy('out');
    setFlash(null);
    try {
      await fetch(apiUrl('/api/auth/google/logout'), { method: 'POST', credentials: 'include' });
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
