'use client';

import { memo, type ReactNode } from 'react';
import { CommunityStoreHeader } from '@/components/community-store/community-store-header';
import { CommunityStoreScrollArea } from '@/components/community-store/community-store-layout';

/** Lobe 式：顶栏（搜索 + 可选排序）+ 可滚动主区。 */
export const CommunityStoreShell = memo(function CommunityStoreShell({
  sortSlot,
  children,
}: {
  sortSlot?: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <CommunityStoreHeader sortSlot={sortSlot} />
      <CommunityStoreScrollArea className="bg-zinc-50/50 dark:bg-zinc-950">{children}</CommunityStoreScrollArea>
    </>
  );
});
