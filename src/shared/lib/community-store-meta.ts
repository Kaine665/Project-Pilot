import type { CommunityAssistantCategory } from '@/types/community-catalog';

/** 助手 / Skills / MCP 列表 URL 参数 `source=` 的取值 */
export const COMMUNITY_MARKET_SOURCE_KEYS = ['all', 'pp', 'remote', 'external'] as const;
export type CommunityMarketSourceFilterKey = (typeof COMMUNITY_MARKET_SOURCE_KEYS)[number];

export const COMMUNITY_CATEGORY_KEYS: CommunityAssistantCategory[] = [
  'all',
  'programming',
  'copywriting',
  'discover',
  'general',
];

export const COMMUNITY_SCROLL_PARENT_ID = 'pp-community-scroll';
