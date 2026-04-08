'use client';

import { memo, useCallback } from 'react';
import { useTranslations } from '@/client/i18n/use-translations';
import { useSearchParams } from '@/client/i18n/routing';
import { Select } from '@/components/ui/select';
import type { CommunityCatalogSort } from '@/types/community-catalog';

export const CommunityAgentSortSelect = memo(function CommunityAgentSortSelect() {
  const t = useTranslations('community');
  const [searchParams, setSearchParams] = useSearchParams();
  const sort = (searchParams.get('sort') as CommunityCatalogSort) || 'recommended';

  const onChange = useCallback(
    (value: string) => {
      const next = new URLSearchParams(searchParams.toString());
      if (value === 'recommended') next.delete('sort');
      else next.set('sort', value);
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  return (
    <Select
      className="h-9 w-[160px] shrink-0 text-xs sm:w-[200px]"
      value={sort}
      onChange={onChange}
      options={[
        { value: 'recommended', label: t('sort.recommended') },
        { value: 'updatedAt', label: t('sort.updatedAt') },
        { value: 'title', label: t('sort.title') },
      ]}
    />
  );
});
