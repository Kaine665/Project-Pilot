'use client';

import { memo, useMemo } from 'react';
import { useTranslations } from '@/client/i18n/use-translations';
import { Link, useSearchParams } from '@/client/i18n/routing';
import { COMMUNITY_CATEGORY_KEYS, COMMUNITY_SCROLL_PARENT_ID } from '@/lib/community-store-meta';
import { cn } from '@/lib/utils';
import type { CommunityAssistantCategory } from '@/types/community-catalog';

function buildListUrl(listBasePath: string, category: CommunityAssistantCategory, searchParams: URLSearchParams) {
  const next = new URLSearchParams(searchParams.toString());
  if (category === 'all') next.delete('category');
  else next.set('category', category);
  const qs = next.toString();
  return qs ? `${listBasePath}?${qs}` : listBasePath;
}

function countForCategory(items: { category?: CommunityAssistantCategory }[], key: CommunityAssistantCategory): number {
  if (key === 'all') return items.length;
  return items.filter((it) => (it.category ?? 'general') === key).length;
}

export const CommunityStoreCategoryMenu = memo(function CommunityStoreCategoryMenu({
  items,
  listBasePath,
}: {
  items: { category?: CommunityAssistantCategory }[];
  listBasePath: string;
}) {
  const t = useTranslations('community');
  const [searchParams] = useSearchParams();
  const raw = searchParams.get('category') as CommunityAssistantCategory | null;
  const selected: CommunityAssistantCategory =
    raw && COMMUNITY_CATEGORY_KEYS.includes(raw) ? raw : 'all';

  const total = useMemo(() => items.length, [items]);

  const scrollTop = () => {
    document.getElementById(COMMUNITY_SCROLL_PARENT_ID)?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <nav className="flex w-[200px] shrink-0 flex-col gap-0.5 border-r border-zinc-200 bg-white py-2 pr-3 dark:border-zinc-800 dark:bg-zinc-950">
      <p className="px-3 pb-2 text-xs font-medium text-zinc-400">{t('category.title')}</p>
      {COMMUNITY_CATEGORY_KEYS.map((key) => {
        const count = key === 'all' ? total : countForCategory(items, key);
        const active = selected === key;
        return (
          <Link
            key={key}
            to={buildListUrl(listBasePath, key, searchParams)}
            onClick={() => scrollTop()}
            className={cn(
              'flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm transition-colors',
              active
                ? 'bg-primary/10 font-medium text-primary'
                : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900',
            )}
          >
            <span className="truncate">{t(`category.${key}`)}</span>
            {count > 0 ? (
              <span
                className={cn(
                  'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold tabular-nums',
                  active ? 'bg-primary/15 text-primary' : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
                )}
              >
                {count}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
});
