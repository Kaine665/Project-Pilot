'use client';

import { useTranslation } from 'react-i18next';
import { usePathname, useRouter } from '@/client/i18n/routing';
import { Globe } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const locale = i18n.language;
  const router = useRouter();
  const pathname = usePathname();

  const switchLocale = () => {
    const newLocale = locale === 'zh' ? 'en' : 'zh';
    i18n.changeLanguage(newLocale);
    router.push(pathname);
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
