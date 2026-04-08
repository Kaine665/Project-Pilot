import type {
  CommunityCatalogItem,
  CommunityMcpSeedItem,
  CommunitySkillSeedItem,
} from '@/types/community-catalog';

export type CommunityUiLocale = 'zh' | 'en';

export function localizedAgent(item: CommunityCatalogItem, locale: CommunityUiLocale) {
  if (locale !== 'en') {
    return {
      title: item.title,
      description: item.description,
      tags: item.tags,
      systemPrompt: item.systemPrompt,
    };
  }
  return {
    title: item.titleEn?.trim() || item.title,
    description: item.descriptionEn?.trim() || item.description,
    tags: item.tagsEn?.length ? item.tagsEn : item.tags,
    systemPrompt: item.systemPromptEn?.trim() || item.systemPrompt,
  };
}

/** 搜索同时匹配中文字段与英文字段。 */
export function agentSearchText(item: CommunityCatalogItem): string {
  return [
    item.title,
    item.description ?? '',
    ...(item.tags ?? []),
    item.author ?? '',
    item.titleEn ?? '',
    item.descriptionEn ?? '',
    ...(item.tagsEn ?? []),
  ].join(' ');
}

export function localizedSkill(item: CommunitySkillSeedItem, locale: CommunityUiLocale) {
  const sourceNote =
    locale === 'en'
      ? item.sourceNoteEn?.trim() || item.sourceNote?.trim()
      : item.sourceNote?.trim() || item.sourceNoteEn?.trim();
  if (locale !== 'en') {
    return {
      title: item.title,
      description: item.description,
      tags: item.tags,
      skillMarkdownPreview: item.skillMarkdown,
      sourceNote: sourceNote ?? '',
    };
  }
  return {
    title: item.titleEn?.trim() || item.title,
    description: item.descriptionEn?.trim() || item.description,
    tags: item.tagsEn?.length ? item.tagsEn : item.tags,
    skillMarkdownPreview: item.skillMarkdownEn?.trim() || item.skillMarkdown,
    sourceNote: sourceNote ?? '',
  };
}

export function skillSearchText(item: CommunitySkillSeedItem): string {
  return [
    item.title,
    item.description ?? '',
    ...(item.tags ?? []),
    item.dirName,
    item.titleEn ?? '',
    item.descriptionEn ?? '',
    ...(item.tagsEn ?? []),
    item.sourceNote ?? '',
    item.sourceNoteEn ?? '',
    item.sourceUrl ?? '',
  ].join(' ');
}

export function localizedMcp(item: CommunityMcpSeedItem, locale: CommunityUiLocale) {
  if (locale !== 'en') {
    return {
      title: item.title,
      description: item.description,
      tags: item.tags,
      installNote: item.installNote,
    };
  }
  return {
    title: item.titleEn?.trim() || item.title,
    description: item.descriptionEn?.trim() || item.description,
    tags: item.tagsEn?.length ? item.tagsEn : item.tags,
    installNote: item.installNoteEn?.trim() || item.installNote,
  };
}

export function mcpSearchText(item: CommunityMcpSeedItem): string {
  return [
    item.title,
    item.description ?? '',
    ...(item.tags ?? []),
    item.serverKey,
    item.titleEn ?? '',
    item.descriptionEn ?? '',
    ...(item.tagsEn ?? []),
  ].join(' ');
}

export function compareLocalizedTitle(
  aTitle: string,
  bTitle: string,
  locale: CommunityUiLocale,
): number {
  return aTitle.localeCompare(bTitle, locale === 'en' ? 'en' : 'zh-CN');
}

export function isHttpUrl(s: string | undefined | null): s is string {
  if (!s?.trim()) return false;
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}
