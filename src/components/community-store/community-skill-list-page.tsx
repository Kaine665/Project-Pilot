'use client';

import { Loader2 } from 'lucide-react';
import { memo, useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from '@/client/i18n/use-translations';
import { useSearchParams } from '@/client/i18n/routing';
import { CommunityAgentSortSelect } from '@/components/community-store/community-agent-sort-select';
import { CommunitySkillCard } from '@/components/community-store/community-skill-card';
import { CommunityStoreCategoryMenu } from '@/components/community-store/community-store-category-menu';
import { CommunityStoreSourceFilterDropdown } from '@/components/community-store/community-store-source-filter-dropdown';
import { CommunityStoreShell } from '@/components/community-store/community-store-shell';
import {
  compareLocalizedTitle,
  localizedSkill,
  skillSearchText,
  type CommunityUiLocale,
} from '@/lib/community-catalog-locale';
import { marketItemMatchesSourceFilter } from '@/lib/community-source-filter';
import { COMMUNITY_CATEGORY_KEYS, COMMUNITY_MARKET_SOURCE_KEYS, type CommunityMarketSourceFilterKey } from '@/lib/community-store-meta';
import type {
  CommunityAssistantCategory,
  CommunityCatalogSort,
  CommunitySkillSeedItem,
  CommunitySkillsCatalogResponse,
} from '@/types/community-catalog';

function filterAndSort(
  items: CommunitySkillSeedItem[],
  q: string,
  category: CommunityAssistantCategory,
  source: CommunityMarketSourceFilterKey,
  sort: CommunityCatalogSort,
  locale: CommunityUiLocale,
): CommunitySkillSeedItem[] {
  let list = [...items];
  if (category !== 'all') {
    list = list.filter((it) => (it.category ?? 'general') === category);
  }
  if (source !== 'all') {
    list = list.filter((it) => marketItemMatchesSourceFilter(it, source));
  }
  const qq = q.trim().toLowerCase();
  if (qq) {
    list = list.filter((it) => skillSearchText(it).toLowerCase().includes(qq));
  }
  if (sort === 'updatedAt') {
    list.sort((a, b) => {
      const ta = new Date(a.updatedAt ?? 0).getTime();
      const tb = new Date(b.updatedAt ?? 0).getTime();
      return tb - ta;
    });
  } else if (sort === 'title') {
    list.sort((a, b) =>
      compareLocalizedTitle(localizedSkill(a, locale).title, localizedSkill(b, locale).title, locale),
    );
  }
  return list;
}

export const CommunitySkillListPage = memo(function CommunitySkillListPage() {
  const t = useTranslations('community');
  const locale = useLocale();
  const [searchParams] = useSearchParams();
  const q = searchParams.get('q') ?? '';
  const rawCat = searchParams.get('category') as CommunityAssistantCategory | null;
  const category: CommunityAssistantCategory =
    rawCat && COMMUNITY_CATEGORY_KEYS.includes(rawCat) ? rawCat : 'all';
  const rawSource = searchParams.get('source') as CommunityMarketSourceFilterKey | null;
  const source: CommunityMarketSourceFilterKey =
    rawSource && COMMUNITY_MARKET_SOURCE_KEYS.includes(rawSource) ? rawSource : 'all';
  const sort = (searchParams.get('sort') as CommunityCatalogSort) || 'recommended';

  const [catalog, setCatalog] = useState<CommunitySkillsCatalogResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/community/skills/catalog', { cache: 'no-store' });
        const data = (await res.json()) as CommunitySkillsCatalogResponse & { error?: string };
        if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : `HTTP ${res.status}`);
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
    return () => {
      cancelled = true;
    };
  }, [t]);

  const filtered = useMemo(() => {
    if (!catalog?.items) return [];
    return filterAndSort(catalog.items, q, category, source, sort, locale);
  }, [catalog?.items, q, category, source, sort, locale]);

  return (
    <CommunityStoreShell
      sortSlot={
        <>
          <CommunityStoreSourceFilterDropdown listBasePath="/workspace/community/skill" items={catalog?.items} />
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
          <CommunityStoreCategoryMenu listBasePath="/workspace/community/skill" items={catalog.items} />
          <div className="min-w-0 flex-1">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {filtered.map((item) => (
                <CommunitySkillCard key={item.id} item={item} localeCode={locale} />
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
