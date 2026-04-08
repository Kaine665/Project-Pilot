'use client';

import { Clock } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslations } from '@/client/i18n/use-translations';
import { Link, useRouter, useSearchParams } from '@/client/i18n/routing';
import { CommunityIcon } from '@/components/community-store/community-icon';
import { localizedAgent } from '@/lib/community-catalog-locale';
import { cn } from '@/lib/utils';
import type { CommunityCatalogItem } from '@/types/community-catalog';

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

export const CommunityAgentCard = memo(function CommunityAgentCard({
  item,
  localeCode,
}: {
  item: CommunityCatalogItem;
  localeCode: 'zh' | 'en';
}) {
  const t = useTranslations('community');
  const router = useRouter();
  const [searchParams] = useSearchParams();
  const id = item.identifier ?? item.id;
  const qs = searchParams.toString();
  const to = qs ? `/workspace/community/agent/${encodeURIComponent(id)}?${qs}` : `/workspace/community/agent/${encodeURIComponent(id)}`;

  const categoryKey = item.category ?? 'general';
  const loc = localizedAgent(item, localeCode);

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
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-zinc-100 dark:bg-zinc-900">
          <CommunityIcon name={item.icon} size="sm" className="!h-6 !w-6" />
        </div>
        <div className="min-w-0 flex-1">
          <Link to={to} className="block" onClick={(e) => e.stopPropagation()}>
            <h2 className="truncate text-base font-semibold text-zinc-900 hover:text-primary dark:text-zinc-50">
              {loc.title}
            </h2>
          </Link>
          {item.author ? (
            <p className="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400">{item.author}</p>
          ) : null}
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        {loc.description ? (
          <p className="line-clamp-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{loc.description}</p>
        ) : null}
        <div className="mt-auto flex flex-wrap gap-2 text-[11px] text-zinc-500 dark:text-zinc-400">
          <span className="rounded-md bg-zinc-100 px-1.5 py-0.5 dark:bg-zinc-800">
            {t('meta.plugins', { n: item.pluginCount ?? 0 })}
          </span>
          <span className="rounded-md bg-zinc-100 px-1.5 py-0.5 dark:bg-zinc-800">
            {t('meta.knowledge', { n: item.knowledgeCount ?? 0 })}
          </span>
          <span className="rounded-md bg-zinc-100 px-1.5 py-0.5 dark:bg-zinc-800">
            {t('meta.tokens', { n: item.tokenUsage ?? 0 })}
          </span>
        </div>
      </div>
      <div className="flex items-center justify-between border-t border-dashed border-zinc-200 px-4 py-3 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
        <span className="flex items-center gap-1">
          <Clock className="h-3.5 w-3.5" aria-hidden />
          {formatDate(item.updatedAt ?? item.createdAt, localeCode)}
        </span>
        <span className="font-medium text-zinc-600 dark:text-zinc-300">{t(`category.${categoryKey}`)}</span>
      </div>
    </article>
  );
});
