'use client';

import { ChevronDown, ListFilter } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from '@/client/i18n/use-translations';
import { Link, useSearchParams } from '@/client/i18n/routing';
import {
  buildMarketSourceListUrl,
  countByMarketSourceFilter,
  type MarketCatalogItem,
} from '@/lib/community-source-filter';
import { COMMUNITY_MARKET_SOURCE_KEYS, type CommunityMarketSourceFilterKey } from '@/lib/community-store-meta';
import { cn } from '@/lib/utils';

export const CommunityStoreSourceFilterDropdown = memo(function CommunityStoreSourceFilterDropdown({
  listBasePath,
  items,
}: {
  listBasePath: string;
  items: MarketCatalogItem[] | null | undefined;
}) {
  const t = useTranslations('community');
  const [searchParams] = useSearchParams();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const raw = searchParams.get('source') as CommunityMarketSourceFilterKey | null;
  const selected: CommunityMarketSourceFilterKey =
    raw && COMMUNITY_MARKET_SOURCE_KEYS.includes(raw) ? raw : 'all';

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const toggle = useCallback(() => setOpen((v) => !v), []);

  if (!items?.length) return null;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={`${t('filterSource.title')}: ${t(`filterSource.${selected}`)}`}
        onClick={toggle}
        className={cn(
          'flex h-9 max-w-[min(100vw-8rem,14rem)] shrink-0 items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-2.5 text-left text-xs shadow-sm transition-colors',
          'hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400',
          'dark:border-zinc-700 dark:bg-zinc-950 dark:hover:bg-zinc-900',
          open && 'ring-2 ring-zinc-400 dark:ring-zinc-500',
        )}
      >
        <ListFilter className="h-3.5 w-3.5 shrink-0 text-zinc-500" aria-hidden />
        <span className="hidden min-w-0 truncate sm:inline">{t('filterSource.title')}</span>
        <span className="min-w-0 flex-1 truncate font-medium text-zinc-800 dark:text-zinc-100">
          {t(`filterSource.${selected}`)}
        </span>
        <ChevronDown
          className={cn('h-3.5 w-3.5 shrink-0 text-zinc-500 transition-transform', open && 'rotate-180')}
          aria-hidden
        />
      </button>

      {open ? (
        <div
          role="listbox"
          aria-label={t('filterSource.title')}
          className={cn(
            'absolute right-0 top-[calc(100%+4px)] z-[100] min-w-[min(100vw-2rem,17rem)] max-w-[min(100vw-2rem,20rem)] rounded-lg border border-zinc-200 bg-white py-1 shadow-lg',
            'dark:border-zinc-700 dark:bg-zinc-950',
          )}
        >
          {COMMUNITY_MARKET_SOURCE_KEYS.map((key) => {
            const count = countByMarketSourceFilter(items, key);
            const active = selected === key;
            return (
              <Link
                key={key}
                role="option"
                aria-selected={active}
                to={buildMarketSourceListUrl(listBasePath, key, searchParams)}
                onClick={() => setOpen(false)}
                className={cn(
                  'flex items-center justify-between gap-3 px-3 py-2.5 text-sm transition-colors',
                  active
                    ? 'bg-primary/10 font-medium text-primary'
                    : 'text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900',
                )}
              >
                <span className="min-w-0 flex-1 leading-snug">{t(`filterSource.${key}`)}</span>
                {count > 0 ? (
                  <span
                    className={cn(
                      'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold tabular-nums',
                      active
                        ? 'bg-primary/15 text-primary'
                        : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
                    )}
                  >
                    {count}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </div>
      ) : null}
    </div>
  );
});
