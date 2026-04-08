'use client';

import { Plug } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslations } from '@/client/i18n/use-translations';
import { Link, useRouter, useSearchParams } from '@/client/i18n/routing';
import { Badge } from '@/components/ui/badge';
import { localizedMcp } from '@/lib/community-catalog-locale';
import { cn } from '@/lib/utils';
import type { CommunityMcpSeedItem } from '@/types/community-catalog';

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

export const CommunityMcpCard = memo(function CommunityMcpCard({
  item,
  localeCode,
  installed,
}: {
  item: CommunityMcpSeedItem;
  localeCode: 'zh' | 'en';
  installed: boolean;
}) {
  const t = useTranslations('community');
  const router = useRouter();
  const [searchParams] = useSearchParams();
  const id = item.identifier ?? item.id;
  const qs = searchParams.toString();
  const to = qs ? `/workspace/community/mcp/${encodeURIComponent(id)}?${qs}` : `/workspace/community/mcp/${encodeURIComponent(id)}`;
  const categoryKey = item.category ?? 'general';
  const loc = localizedMcp(item, localeCode);

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
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-100 dark:bg-emerald-950/50">
          <Plug className="h-5 w-5 text-emerald-700 dark:text-emerald-300" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <Link to={to} className="min-w-0 flex-1" onClick={(e) => e.stopPropagation()}>
              <h2 className="truncate text-base font-semibold text-zinc-900 hover:text-primary dark:text-zinc-50">{loc.title}</h2>
            </Link>
            {installed ? (
              <Badge variant="secondary" className="shrink-0 text-[10px]">
                {t('mcp.installedBadge')}
              </Badge>
            ) : null}
          </div>
          <p className="mt-0.5 truncate font-mono text-[11px] text-zinc-400">{item.serverKey}</p>
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        {loc.description ? (
          <p className="line-clamp-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{loc.description}</p>
        ) : null}
      </div>
      <div className="flex items-center justify-between border-t border-dashed border-zinc-200 px-4 py-3 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
        <span>{formatDate(item.updatedAt, localeCode)}</span>
        <span className="font-medium text-zinc-600 dark:text-zinc-300">{t(`category.${categoryKey}`)}</span>
      </div>
    </article>
  );
});
