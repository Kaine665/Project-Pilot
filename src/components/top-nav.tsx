'use client';

import { useState, useEffect } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { GitBranch, Settings, Sparkles } from 'lucide-react';
import { Link, usePathname, useRouter } from '@/i18n/routing';
import { cn } from '@/lib/utils';
import { LanguageSwitcher } from './language-switcher';

const getNavItems = (t: ReturnType<typeof useTranslations>) => [
  { href: '/flows' as const, label: t('nav.projects'), icon: GitBranch },
  { href: '/settings' as const, label: t('nav.settings'), icon: Settings },
];

export function TopNav({ children, plannerOpen }: { children?: React.ReactNode; plannerOpen?: boolean }) {
  const pathname = usePathname();
  // Defer plannerOpen styling to avoid hydration mismatch
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const isOpen = mounted && plannerOpen;
  const router = useRouter();
  const t = useTranslations();
  const locale = useLocale();
  const navItems = getNavItems(t);

  const handleOpenPlanner = () => {
    if (pathname.startsWith('/flows')) {
      window.dispatchEvent(new CustomEvent('pp:toggle-planner'));
    } else {
      router.push('/flows');
      // Dispatch after navigation settles
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('pp:open-planner'));
      }, 300);
    }
  };

  return (
    <header className="flex shrink-0 items-center justify-between border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
      <div className="flex items-center gap-1">
        <nav className="flex items-center gap-1">
          {navItems.map(({ href, label, icon: Icon }) => {
            const isActive = pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
                    : 'text-zinc-500 hover:bg-zinc-50 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800/50 dark:hover:text-zinc-300',
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            );
          })}
        </nav>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={handleOpenPlanner}
          className={cn(
            'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
            isOpen
              ? 'bg-violet-100 text-violet-700 dark:bg-violet-800/50 dark:text-violet-300'
              : 'bg-violet-50 text-violet-600 hover:bg-violet-100 dark:bg-violet-900/30 dark:text-violet-400 dark:hover:bg-violet-900/50',
          )}
          title={t('nav.aiAssistant')}
        >
          <Sparkles className="h-3.5 w-3.5" />
          <span>{t('nav.aiAssistant')}</span>
        </button>
        <LanguageSwitcher />
        {children}
      </div>
    </header>
  );
}
