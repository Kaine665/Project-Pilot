'use client';

import { Loader2 } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useLocale, useTranslations } from '@/client/i18n/use-translations';
import { useSearchParams } from '@/client/i18n/routing';
import { CommunityAgentCard } from '@/components/community-store/community-agent-card';
import { CommunityStoreCategoryMenu } from '@/components/community-store/community-store-category-menu';
import { CommunityAgentSortSelect } from '@/components/community-store/community-agent-sort-select';
import { useCommunityCatalog } from '@/components/community-store/community-catalog-context';
import { CommunityStoreSourceFilterDropdown } from '@/components/community-store/community-store-source-filter-dropdown';
import { CommunityStoreShell } from '@/components/community-store/community-store-shell';
import {
  agentSearchText,
  compareLocalizedTitle,
  localizedAgent,
  type CommunityUiLocale,
} from '@/lib/community-catalog-locale';
import { marketItemMatchesSourceFilter } from '@/lib/community-source-filter';
import { COMMUNITY_CATEGORY_KEYS, COMMUNITY_MARKET_SOURCE_KEYS, type CommunityMarketSourceFilterKey } from '@/lib/community-store-meta';
import type { CommunityAssistantCategory, CommunityCatalogItem, CommunityCatalogSort } from '@/types/community-catalog';

function filterAndSort(
  items: CommunityCatalogItem[],
  q: string,
  category: CommunityAssistantCategory,
  source: CommunityMarketSourceFilterKey,
  sort: CommunityCatalogSort,
  locale: CommunityUiLocale,
): CommunityCatalogItem[] {
  let list = [...items];
  if (category !== 'all') {
    list = list.filter((it) => (it.category ?? 'general') === category);
  }
  if (source !== 'all') {
    list = list.filter((it) => marketItemMatchesSourceFilter(it, source));
  }
  const qq = q.trim().toLowerCase();
  if (qq) {
    list = list.filter((it) => agentSearchText(it).toLowerCase().includes(qq));
  }
  if (sort === 'updatedAt') {
    list.sort((a, b) => {
      const ta = new Date(a.updatedAt ?? a.createdAt ?? 0).getTime();
      const tb = new Date(b.updatedAt ?? b.createdAt ?? 0).getTime();
      return tb - ta;
    });
  } else if (sort === 'title') {
    list.sort((a, b) =>
      compareLocalizedTitle(localizedAgent(a, locale).title, localizedAgent(b, locale).title, locale),
    );
  }
  return list;
}

export const CommunityAgentListPage = memo(function CommunityAgentListPage() {
  const t = useTranslations('community');
  const locale = useLocale();
  const { catalog, loadError } = useCommunityCatalog();
  const [searchParams] = useSearchParams();
  const q = searchParams.get('q') ?? '';
  const rawCat = searchParams.get('category') as CommunityAssistantCategory | null;
  const category: CommunityAssistantCategory =
    rawCat && COMMUNITY_CATEGORY_KEYS.includes(rawCat) ? rawCat : 'all';
  const sort = (searchParams.get('sort') as CommunityCatalogSort) || 'recommended';
  const rawSource = searchParams.get('source') as CommunityMarketSourceFilterKey | null;
  const source: CommunityMarketSourceFilterKey =
    rawSource && COMMUNITY_MARKET_SOURCE_KEYS.includes(rawSource) ? rawSource : 'all';

  const filtered = useMemo(() => {
    if (!catalog?.items) return [];
    return filterAndSort(catalog.items, q, category, source, sort, locale);
  }, [catalog?.items, q, category, source, sort, locale]);

  return (
    <CommunityStoreShell
      sortSlot={
        <>
          <CommunityStoreSourceFilterDropdown listBasePath="/workspace/community/agent" items={catalog?.items} />
          <CommunityAgentSortSelect />
        </>
      }
    >
      {loadError ? <p className="p-6 text-sm text-destructive">{t('loadError')}</p> : null}
      {!catalog && !loadError ? (
        <div className="flex flex-1 items-center justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-zinc-400" aria-hidden />
        </div>
      ) : null}
      {catalog ? (
        <div className="flex min-h-full w-full max-w-[1400px] gap-6 px-4 py-6 lg:px-6">
          <CommunityStoreCategoryMenu listBasePath="/workspace/community/agent" items={catalog.items} />
          <div className="min-w-0 flex-1">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {filtered.map((item) => (
                <CommunityAgentCard key={item.id} item={item} localeCode={locale} />
              ))}
            </div>
            {filtered.length === 0 ? (
              <p className="py-16 text-center text-sm text-zinc-500">{t('empty')}</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </CommunityStoreShell>
  );
});
