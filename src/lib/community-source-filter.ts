import { isHttpUrl } from '@/lib/community-catalog-locale';
import type { CommunityMarketSourceFilterKey } from '@/lib/community-store-meta';
import type {
  CommunityCatalogItem,
  CommunityCatalogListOrigin,
  CommunityMcpSeedItem,
  CommunitySkillSeedItem,
} from '@/types/community-catalog';

export type MarketCatalogItem = CommunityCatalogItem | CommunitySkillSeedItem | CommunityMcpSeedItem;

function getItemListOrigin(item: MarketCatalogItem): CommunityCatalogListOrigin | undefined {
  if ('skillMarkdown' in item) return item.skillListOrigin;
  return item.catalogItemOrigin;
}

export function marketItemMatchesSourceFilter(
  item: MarketCatalogItem,
  key: CommunityMarketSourceFilterKey,
): boolean {
  if (key === 'all') return true;
  const o = getItemListOrigin(item);
  if (key === 'pp') {
    return !o || o === 'seed' || o === 'dev-bulk';
  }
  if (key === 'remote') {
    return o === 'remote' || o === 'registry';
  }
  if (key === 'external') {
    return isHttpUrl(item.sourceUrl);
  }
  return true;
}

export function countByMarketSourceFilter(
  items: MarketCatalogItem[],
  key: CommunityMarketSourceFilterKey,
): number {
  if (key === 'all') return items.length;
  return items.filter((it) => marketItemMatchesSourceFilter(it, key)).length;
}

export function buildMarketSourceListUrl(
  listBasePath: string,
  source: CommunityMarketSourceFilterKey,
  searchParams: URLSearchParams,
): string {
  const next = new URLSearchParams(searchParams.toString());
  if (source === 'all') next.delete('source');
  else next.set('source', source);
  const qs = next.toString();
  return qs ? `${listBasePath}?${qs}` : listBasePath;
}
