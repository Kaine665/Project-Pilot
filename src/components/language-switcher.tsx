'use client';

import { useLocale } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/routing';
import { Globe } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function LanguageSwitcher() {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  const switchLocale = () => {
    const newLocale = locale === 'zh' ? 'en' : 'zh';
    router.push(pathname, { locale: newLocale });
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={switchLocale}
      className="gap-1.5"
      title={locale === 'zh' ? 'Switch to English' : '切换到中文'}
    >
      <Globe className="h-4 w-4" />
      <span className="text-xs font-medium">
        {locale === 'zh' ? 'EN' : '中文'}
      </span>
    </Button>
  );
}
