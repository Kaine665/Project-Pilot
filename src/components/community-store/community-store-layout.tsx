'use client';

import { Outlet } from 'react-router';
import { CommunityCatalogProvider } from '@/components/community-store/community-catalog-context';
import { CommunityStoreSidebar } from '@/components/community-store/community-store-sidebar';
import { COMMUNITY_SCROLL_PARENT_ID } from '@/lib/community-store-meta';
import { cn } from '@/lib/utils';

export function CommunityStoreLayout() {
  return (
    <CommunityCatalogProvider>
      <div
        data-pp-community-store="v2"
        className="flex min-h-0 w-full flex-1 overflow-hidden bg-zinc-50/80 dark:bg-zinc-950"
      >
        <CommunityStoreSidebar />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <Outlet />
        </div>
      </div>
    </CommunityCatalogProvider>
  );
}

/** 商店主内容区滚动容器（与 Lobe Category 点击后 scrollToTop 对齐）。 */
export function CommunityStoreScrollArea({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      id={COMMUNITY_SCROLL_PARENT_ID}
      className={cn('min-h-0 flex-1 overflow-y-auto overflow-x-hidden', className)}
    >
      {children}
    </div>
  );
}
