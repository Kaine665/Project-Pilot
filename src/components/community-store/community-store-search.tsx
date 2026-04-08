'use client';

import { Search } from 'lucide-react';
import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslations } from '@/client/i18n/use-translations';
import { usePathname, useRouter, useSearchParams } from '@/client/i18n/routing';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

function searchTargetSegment(pathname: string): string {
  if (pathname === '/workspace/community' || pathname === '/workspace/community/') return 'agent';
  if (pathname.startsWith('/workspace/community/agent')) return 'agent';
  if (pathname.startsWith('/workspace/community/skill')) return 'skill';
  if (pathname.startsWith('/workspace/community/mcp')) return 'mcp';
  if (pathname.startsWith('/workspace/community/model')) return 'model';
  if (pathname.startsWith('/workspace/community/provider')) return 'provider';
  return 'agent';
}

export const CommunityStoreSearch = memo(function CommunityStoreSearch({ className }: { className?: string }) {
  const t = useTranslations('community');
  const pathname = usePathname();
  const router = useRouter();
  const [searchParams] = useSearchParams();
  const qParam = searchParams.get('q') ?? '';
  const [word, setWord] = useState(qParam);

  useEffect(() => {
    setWord(qParam);
  }, [qParam]);

  const pushQuery = useCallback(
    (q: string) => {
      const seg = searchTargetSegment(pathname);
      const base = `/workspace/community/${seg}`;
      const next = new URLSearchParams(searchParams.toString());
      if (q.trim()) next.set('q', q.trim());
      else next.delete('q');
      const qs = next.toString();
      router.replace(qs ? `${base}?${qs}` : base);
    },
    [pathname, router, searchParams],
  );

  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" aria-hidden />
      <Input
        value={word}
        onChange={(e) => setWord(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') pushQuery(word);
        }}
        placeholder={t('search.placeholder')}
        className="h-10 border-0 bg-zinc-100/80 pl-9 shadow-none dark:bg-zinc-900/80"
        aria-label={t('search.placeholder')}
      />
    </div>
  );
});
