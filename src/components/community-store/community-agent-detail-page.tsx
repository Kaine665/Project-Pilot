'use client';

import { ArrowLeft, Download, Loader2 } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from '@/client/i18n/use-translations';
import { Link, useParams, useSearchParams } from '@/client/i18n/routing';
import { CommunityIcon } from '@/components/community-store/community-icon';
import { useCommunityCatalog } from '@/components/community-store/community-catalog-context';
import { CommunityStoreShell } from '@/components/community-store/community-store-shell';
import { useProject } from '@/components/project-context';
import { Button } from '@/components/ui/button';
import { isHttpUrl, localizedAgent } from '@/lib/community-catalog-locale';
import { DEFAULT_AGENT_CAPABILITIES, type AgentCapabilities } from '@/types';
import type { CommunityCatalogItem } from '@/types/community-catalog';

export const CommunityAgentDetailPage = memo(function CommunityAgentDetailPage() {
  const t = useTranslations('community');
  const locale = useLocale();
  const { identifier: identifierParam } = useParams<{ identifier: string }>();
  const identifier = identifierParam ? decodeURIComponent(identifierParam) : '';
  const [searchParams] = useSearchParams();
  const listQs = searchParams.toString();
  const backTo = listQs ? `/workspace/community/agent?${listQs}` : '/workspace/community/agent';
  const { activeKey } = useProject();
  const { catalog } = useCommunityCatalog();

  const fromCatalog = useMemo(() => {
    if (!catalog?.items || !identifier) return null;
    return (
      catalog.items.find((it) => it.id === identifier || it.identifier === identifier) ?? null
    );
  }, [catalog?.items, identifier]);

  const [item, setItem] = useState<CommunityCatalogItem | null>(fromCatalog);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    setItem(fromCatalog);
  }, [fromCatalog]);

  useEffect(() => {
    if (fromCatalog || !identifier) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/community/item/${encodeURIComponent(identifier)}`, {
          cache: 'no-store',
        });
        const data = (await res.json()) as CommunityCatalogItem & { error?: string };
        if (!res.ok) {
          throw new Error(typeof data.error === 'string' ? data.error : `HTTP ${res.status}`);
        }
        if (!cancelled) {
          setItem(data);
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
  }, [fromCatalog, identifier, t]);

  const install = useCallback(async () => {
    if (!item) return;
    setInstalling(true);
    setToast(null);
    try {
      const capabilities: AgentCapabilities = {
        ...DEFAULT_AGENT_CAPABILITIES,
        ...(item.capabilities ?? {}),
      };
      const loc = localizedAgent(item, locale);
      const body = {
        name: `${loc.title}${t('presetNameSuffix')}`,
        description: loc.description,
        projectKey: activeKey ?? undefined,
        icon: item.icon?.trim() || undefined,
        capabilities,
        skillIds: Array.isArray(item.skillIds) ? item.skillIds : [],
        systemPrompt: loc.systemPrompt?.trim() || undefined,
      };
      const res = await fetch('/api/data/agent-presets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data.error === 'string' ? data.error : `HTTP ${res.status}`);
      }
      setToast(t('installOk', { name: body.name }));
    } catch (e) {
      setToast(e instanceof Error ? e.message : t('installFail'));
    } finally {
      setInstalling(false);
    }
  }, [activeKey, item, locale, t]);

  const caps = item?.capabilities;
  const locDisplay = item ? localizedAgent(item, locale) : null;

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
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-zinc-100 dark:bg-zinc-900">
                <CommunityIcon name={item.icon} size="lg" className="!h-10 !w-10" />
              </div>
              <div className="min-w-0 flex-1">
                <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">{locDisplay.title}</h1>
                {item.author ? (
                  <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{item.author}</p>
                ) : null}
                {locDisplay.description ? (
                  <p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{locDisplay.description}</p>
                ) : null}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button disabled={installing} onClick={() => void install()} className="gap-2">
                {installing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />}
                {t('addToPresets')}
              </Button>
              <Button variant="outline" asChild>
                <Link to="/workspace/presets">{t('presetsLink')}</Link>
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
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{t('detail.systemRole')}</h2>
              <pre className="mt-2 max-h-[320px] overflow-auto rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-xs leading-relaxed text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
                {locDisplay.systemPrompt?.trim() || '—'}
              </pre>
            </section>

            {caps ? (
              <section>
                <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{t('detail.capabilities')}</h2>
                <ul className="mt-2 grid gap-2 text-sm text-zinc-600 dark:text-zinc-400 sm:grid-cols-2">
                  {(
                    [
                      ['bash', caps.bash],
                      ['fileAccess', caps.fileAccess],
                      ['web', caps.web],
                      ['subAgent', caps.subAgent],
                      ['dataStore', caps.dataStore],
                    ] as const
                  ).map(([key, val]) => (
                    <li key={key} className="flex justify-between gap-2 rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-800">
                      <span>{t(`cap.${key}`)}</span>
                      <span className="font-medium text-zinc-900 dark:text-zinc-100">{val ? t('cap.on') : t('cap.off')}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {locDisplay.tags && locDisplay.tags.length > 0 ? (
              <section>
                <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{t('detail.tags')}</h2>
                <div className="mt-2 flex flex-wrap gap-2">
                  {locDisplay.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-md bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        ) : null}
      </div>
    </CommunityStoreShell>
  );
});
