'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, Loader2, Search, Store } from 'lucide-react';
import { useTranslations } from '@/client/i18n/use-translations';
import { Link } from '@/client/i18n/routing';
import { useProject } from '@/components/project-context';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { AgentCapabilities } from '@/types';
import { DEFAULT_AGENT_CAPABILITIES } from '@/types';

export interface CommunityCatalogItem {
  id: string;
  title: string;
  description?: string;
  tags?: string[];
  icon?: string;
  systemPrompt?: string;
  capabilities?: Partial<AgentCapabilities>;
  skillIds?: string[];
}

interface CatalogResponse {
  version: number;
  source: string;
  items: CommunityCatalogItem[];
  fetchedAt: string;
}

export function CommunityPageClient() {
  const t = useTranslations('community');
  const { activeKey } = useProject();
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/community/catalog', { cache: 'no-store' });
        const data = (await res.json()) as CatalogResponse;
        if (!res.ok) throw new Error(typeof (data as { error?: string }).error === 'string' ? (data as { error: string }).error : `HTTP ${res.status}`);
        if (!cancelled) {
          setCatalog(data);
          setLoadError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setCatalog(null);
          setLoadError(e instanceof Error ? e.message : t('loadError'));
        }
      }
    })();
    return () => { cancelled = true; };
  }, [t]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const it of catalog?.items ?? []) {
      for (const tag of it.tags ?? []) {
        if (tag.trim()) set.add(tag.trim());
      }
    }
    return [...set].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  }, [catalog]);

  const filtered = useMemo(() => {
    const items = catalog?.items ?? [];
    const q = query.trim().toLowerCase();
    return items.filter((it) => {
      if (tagFilter && !(it.tags ?? []).includes(tagFilter)) return false;
      if (!q) return true;
      const blob = `${it.title} ${it.description ?? ''} ${(it.tags ?? []).join(' ')}`.toLowerCase();
      return blob.includes(q);
    });
  }, [catalog, query, tagFilter]);

  const installItem = useCallback(
    async (item: CommunityCatalogItem) => {
      setInstallingId(item.id);
      setToast(null);
      try {
        const capabilities: AgentCapabilities = {
          ...DEFAULT_AGENT_CAPABILITIES,
          ...(item.capabilities ?? {}),
        };
        const body = {
          name: `${item.title}${t('presetNameSuffix')}`,
          description: item.description,
          projectKey: activeKey ?? undefined,
          icon: item.icon?.trim() || undefined,
          capabilities,
          skillIds: Array.isArray(item.skillIds) ? item.skillIds : [],
          systemPrompt: item.systemPrompt?.trim() || undefined,
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
        setInstallingId(null);
      }
    },
    [activeKey, t],
  );

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-zinc-900 dark:text-zinc-50">
            <Store className="h-7 w-7 shrink-0 text-primary" aria-hidden />
            <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          </div>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{t('subtitle')}</p>
          <p className="mt-2 text-xs text-zinc-400 dark:text-zinc-500">
            {t('presetsHint')}{' '}
            <Link href="/workspace/presets" className="font-medium text-primary underline-offset-2 hover:underline">
              {t('presetsLink')}
            </Link>
          </p>
          {catalog ? (
            <p className="mt-1 font-mono text-[10px] text-zinc-400">
              {t('catalogMeta', { source: catalog.source, version: String(catalog.version) })}
            </p>
          ) : null}
        </div>
        <div className="relative w-full sm:w-auto sm:min-w-[280px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" aria-hidden />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('searchPlaceholder')}
            className="h-10 pl-9"
          />
        </div>
      </header>

      {allTags.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setTagFilter(null)}
            className={cn(
              'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
              tagFilter === null
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-zinc-200 bg-zinc-50 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300',
            )}
          >
            {t('tagAll')}
          </button>
          {allTags.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => setTagFilter(tagFilter === tag ? null : tag)}
              className={cn(
                'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                tagFilter === tag
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-zinc-200 bg-zinc-50 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300',
              )}
            >
              {tag}
            </button>
          ))}
        </div>
      ) : null}

      {loadError ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">{loadError}</p>
      ) : null}

      {toast ? (
        <p className="rounded-lg border border-border bg-muted/40 px-4 py-2 text-sm text-foreground">{toast}</p>
      ) : null}

      {!catalog && !loadError ? (
        <div className="flex flex-1 items-center justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-zinc-400" aria-hidden />
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((item) => (
          <article
            key={item.id}
            className="flex flex-col rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
          >
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{item.title}</h2>
            {item.description ? (
              <p className="mt-2 line-clamp-4 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{item.description}</p>
            ) : null}
            {item.tags && item.tags.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {item.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-md bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            ) : null}
            <div className="mt-4 flex flex-1 flex-col justify-end">
              <button
                type="button"
                disabled={installingId !== null}
                onClick={() => void installItem(item)}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 py-2.5 text-sm font-medium text-zinc-800 transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                {installingId === item.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Download className="h-4 w-4" aria-hidden />
                )}
                {t('addToPresets')}
              </button>
            </div>
          </article>
        ))}
      </div>

      {catalog && !loadError && filtered.length === 0 ? (
        <p className="text-center text-sm text-zinc-500">{t('empty')}</p>
      ) : null}
    </div>
  );
}
