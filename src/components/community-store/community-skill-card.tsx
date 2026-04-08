'use client';

import { ExternalLink, Puzzle } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslations } from '@/client/i18n/use-translations';
import { Link, useRouter, useSearchParams } from '@/client/i18n/routing';
import { isHttpUrl, localizedSkill } from '@/lib/community-catalog-locale';
import { cn } from '@/lib/utils';
import type { CommunitySkillSeedItem } from '@/types/community-catalog';

function formatDate(iso: string | undefined, locale: string) {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'zh-CN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export const CommunitySkillCard = memo(function CommunitySkillCard({
  item,
  localeCode,
}: {
  item: CommunitySkillSeedItem;
  localeCode: 'zh' | 'en';
}) {
  const t = useTranslations('community');
  const router = useRouter();
  const [searchParams] = useSearchParams();
  const id = item.identifier ?? item.id;
  const qs = searchParams.toString();
  const to = qs ? `/workspace/community/skill/${encodeURIComponent(id)}?${qs}` : `/workspace/community/skill/${encodeURIComponent(id)}`;
  const categoryKey = item.category ?? 'general';
  const loc = localizedSkill(item, localeCode);

  const onCardClick = useCallback(() => {
    router.push(to);
  }, [router, to]);

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={onCardClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onCardClick();
        }
      }}
      className={cn(
        'flex h-full cursor-pointer flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm transition-shadow hover:shadow-md dark:border-zinc-800 dark:bg-zinc-950',
      )}
    >
      <div className="flex gap-3 border-b border-zinc-100 p-4 dark:border-zinc-800/80">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-violet-100 dark:bg-violet-950/50">
          <Puzzle className="h-5 w-5 text-violet-700 dark:text-violet-300" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <Link to={to} className="block" onClick={(e) => e.stopPropagation()}>
            <h2 className="truncate text-base font-semibold text-zinc-900 hover:text-primary dark:text-zinc-50">{loc.title}</h2>
          </Link>
          <p className="mt-0.5 truncate font-mono text-[11px] text-zinc-400">{item.dirName}</p>
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        {loc.description ? (
          <p className="line-clamp-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{loc.description}</p>
        ) : null}
        {loc.sourceNote?.trim() ? (
          <p className="line-clamp-2 text-xs leading-relaxed text-zinc-500 dark:text-zinc-500">
            {loc.sourceNote.replace(/\*\*(.+?)\*\*/g, '$1').replace(/\s+/g, ' ')}
          </p>
        ) : (
          <p
            className={`line-clamp-2 text-xs font-medium leading-relaxed ${
              item.sourceProvider === 'unknown'
                ? 'text-amber-700 dark:text-amber-300'
                : 'text-zinc-500 dark:text-zinc-500'
            }`}
          >
            {item.sourceProvider === 'unknown'
              ? t('skill.sourceFallbackUnknown').replace(/\*\*(.+?)\*\*/g, '$1').replace(/\s+/g, ' ')
              : t('skill.sourceFallbackPp').replace(/\*\*(.+?)\*\*/g, '$1').replace(/\s+/g, ' ')}
          </p>
        )}
        {isHttpUrl(item.sourceUrl) ? (
          <a
            href={item.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex max-w-full items-center gap-1 text-xs font-medium text-primary hover:underline"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="truncate">{t('skill.openExternalSource')}</span>
          </a>
        ) : null}
      </div>
      <div className="flex items-center justify-between border-t border-dashed border-zinc-200 px-4 py-3 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
        <span>{formatDate(item.updatedAt, localeCode)}</span>
        <span className="font-medium text-zinc-600 dark:text-zinc-300">{t(`category.${categoryKey}`)}</span>
      </div>
    </article>
  );
});
