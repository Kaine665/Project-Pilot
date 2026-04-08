'use client';

import { ArrowLeft, Loader2, Plug } from 'lucide-react';
import { memo, useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from '@/client/i18n/use-translations';
import { Link, useParams, useSearchParams } from '@/client/i18n/routing';
import { CommunityStoreShell } from '@/components/community-store/community-store-shell';
import { useProject } from '@/components/project-context';
import { Button } from '@/components/ui/button';
import { isHttpUrl, localizedMcp } from '@/lib/community-catalog-locale';
import type { CommunityMcpSeedItem } from '@/types/community-catalog';

export const CommunityMcpDetailPage = memo(function CommunityMcpDetailPage() {
  const t = useTranslations('community');
  const locale = useLocale();
  const { identifier: identifierParam } = useParams<{ identifier: string }>();
  const identifier = identifierParam ? decodeURIComponent(identifierParam) : '';
  const [searchParams] = useSearchParams();
  const listQs = searchParams.toString();
  const backTo = listQs ? `/workspace/community/mcp?${listQs}` : '/workspace/community/mcp';
  const { activeKey } = useProject();

  const [item, setItem] = useState<CommunityMcpSeedItem | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!identifier) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/community/mcp/item/${encodeURIComponent(identifier)}`, {
          cache: 'no-store',
        });
        const data = (await res.json()) as CommunityMcpSeedItem & { error?: string };
        if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : `HTTP ${res.status}`);
        if (!cancelled) {
          setItem(data as CommunityMcpSeedItem);
          setLoadError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setItem(null);
          setLoadError(e instanceof Error ? e.message : t('detail.notFound'));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [identifier, t]);

  const install = useCallback(async () => {
    if (!item) return;
    if (item.requiresProjectPath && !activeKey?.trim()) {
      setToast(t('mcp.needProject'));
      return;
    }
    setInstalling(true);
    setToast(null);
    try {
      const res = await fetch('/api/community/mcp/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: item.id,
          ...(item.requiresProjectPath && activeKey ? { projectKey: activeKey } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg =
          typeof (data as { message?: string }).message === 'string'
            ? (data as { message: string }).message
            : typeof (data as { error?: string }).error === 'string'
              ? (data as { error: string }).error
              : `HTTP ${res.status}`;
        throw new Error(msg);
      }
      setToast(t('mcp.installOk', { key: (data as { serverKey?: string }).serverKey ?? item.serverKey }));
    } catch (e) {
      setToast(e instanceof Error ? e.message : t('mcp.installFail'));
    } finally {
      setInstalling(false);
    }
  }, [activeKey, item, t]);

  const locDisplay = item ? localizedMcp(item, locale) : null;
  const jsonPreview = item ? JSON.stringify(item.mcpServer, null, 2) : '';

  return (
    <CommunityStoreShell>
      <div className="mx-auto w-full max-w-3xl px-4 py-6 lg:px-6">
        <Link
          to={backTo}
          className="mb-6 inline-flex items-center gap-1 text-sm font-medium text-zinc-600 hover:text-primary dark:text-zinc-400"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          {t('detail.back')}
        </Link>

        {!item && !loadError ? (
          <div className="flex justify-center py-24">
            <Loader2 className="h-8 w-8 animate-spin text-zinc-400" aria-hidden />
          </div>
        ) : null}

        {loadError ? (
          <p className="text-sm text-destructive">
            {loadError === 'not_found' ? t('detail.notFound') : loadError}
          </p>
        ) : null}

        {item && locDisplay ? (
          <div className="space-y-6">
            <div className="flex gap-4">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-emerald-100 dark:bg-emerald-950/50">
                <Plug className="h-7 w-7 text-emerald-700 dark:text-emerald-300" aria-hidden />
              </div>
              <div className="min-w-0">
                <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">{locDisplay.title}</h1>
                <p className="mt-1 font-mono text-sm text-zinc-500">{item.serverKey}</p>
                {locDisplay.description ? (
                  <p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{locDisplay.description}</p>
                ) : null}
              </div>
            </div>

            {locDisplay.installNote ? (
              <p className="rounded-lg border border-amber-200/80 bg-amber-50/80 px-4 py-3 text-xs leading-relaxed text-amber-950 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-100/90">
                {locDisplay.installNote}
              </p>
            ) : null}

            {item.requiresProjectPath ? (
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                {activeKey
                  ? t('mcp.willUseProject', { key: activeKey })
                  : t('mcp.selectProjectFirst')}
              </p>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Button disabled={installing} onClick={() => void install()} className="gap-2">
                {installing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Plug className="h-4 w-4" aria-hidden />}
                {t('mcp.addToMcpMarket')}
              </Button>
              <Button variant="outline" asChild>
                <Link to="/workspace/mcp">{t('mcp.openMcpWorkspace')}</Link>
              </Button>
              {isHttpUrl(item.sourceUrl) ? (
                <Button variant="outline" asChild>
                  <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer">
                    {t('detail.sourceLink')}
                  </a>
                </Button>
              ) : null}
            </div>

            {toast ? (
              <p className="rounded-lg border border-border bg-muted/40 px-4 py-2 text-sm text-foreground">{toast}</p>
            ) : null}

            <section>
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{t('mcp.configPreview')}</h2>
              <p className="mt-1 text-xs text-zinc-500">{t('mcp.mergeHint')}</p>
              <pre className="mt-3 max-h-[360px] overflow-auto rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-xs leading-relaxed text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
                {jsonPreview}
              </pre>
            </section>
          </div>
        ) : null}
      </div>
    </CommunityStoreShell>
  );
});
