'use client';

import { memo, type ReactNode } from 'react';
import { CommunityStoreSearch } from '@/components/community-store/community-store-search';
import { cn } from '@/lib/utils';

export const CommunityStoreHeader = memo(function CommunityStoreHeader({
  sortSlot,
  className,
}: {
  sortSlot?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        'flex shrink-0 items-center gap-3 overflow-visible border-b border-zinc-200 bg-white px-4 py-2.5 dark:border-zinc-800 dark:bg-zinc-950',
        className,
      )}
    >
      <CommunityStoreSearch className="min-w-0 flex-1" />
      {sortSlot ? (
        <div className="flex shrink-0 items-center gap-2 overflow-visible">{sortSlot}</div>
      ) : null}
    </header>
  );
});
