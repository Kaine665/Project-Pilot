'use client';

import { memo } from 'react';
import { useTranslations } from '@/client/i18n/use-translations';
import { Link } from '@/client/i18n/routing';
import { CommunityStoreShell } from '@/components/community-store/community-store-shell';
import { Button } from '@/components/ui/button';

export type CommunityPlaceholderTab = 'model' | 'provider';

export const CommunityPlaceholderTabPage = memo(function CommunityPlaceholderTabPage({
  tab,
}: {
  tab: CommunityPlaceholderTab;
}) {
  const t = useTranslations('community');

  return (
    <CommunityStoreShell>
      <div className="mx-auto flex max-w-lg flex-col items-center px-4 py-20 text-center">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">{t(`placeholder.${tab}.title`)}</h1>
        <p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
          {t(`placeholder.${tab}.body`)}
        </p>
        <Button asChild className="mt-8" variant="outline">
          <Link to="/workspace/community/agent">{t('placeholder.backAssistants')}</Link>
        </Button>
      </div>
    </CommunityStoreShell>
  );
});
