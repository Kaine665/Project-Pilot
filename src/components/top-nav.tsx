'use client';

import { useState, useEffect, useRef } from 'react';
import { useTranslations, useLocale } from '@/client/i18n/use-translations';
import { GitBranch, Settings, Sparkles, ChevronDown } from 'lucide-react';
import { Link, usePathname, useRouter } from '@/client/i18n/routing';
import { cn } from '@/lib/utils';
import { LanguageSwitcher } from './language-switcher';
import { useProject } from './project-context';

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
    <header className="flex shrink-0 items-center justify-between border-b border-zinc-200 bg-white px-6 py-3 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-center gap-1">
        <nav className="flex items-center gap-1">
          {navItems.map(({ href, label, icon: Icon }) => {
            const isActive = pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  'flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-all',
                  isActive
                    ? 'bg-zinc-100 text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-100'
                    : 'text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/50 dark:hover:text-zinc-300',
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            );
          })}
        </nav>
      </div>
      <ProjectSwitcher />
      <div className="flex items-center gap-3">
        <button
          onClick={handleOpenPlanner}
          className={cn(
            'flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition-all shadow-sm',
            isOpen
              ? 'bg-ai-subtle text-ai dark:bg-ai-subtle dark:text-ai'
              : 'bg-ai-subtle text-ai hover:brightness-95 dark:bg-ai-subtle dark:text-ai dark:hover:brightness-95',
          )}
          title={t('nav.aiAssistant')}
        >
          <Sparkles className="h-4 w-4" />
          <span>{t('nav.aiAssistant')}</span>
        </button>
        <LanguageSwitcher />
        {children}
      </div>
    </header>
  );
}

function ProjectSwitcher() {
  const { projects, activeKey, setActiveKey } = useProject();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const activeProject = projects.find(p => p.key === activeKey);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 py-1.5 text-sm font-medium text-zinc-600 shadow-sm transition-all hover:border-zinc-300 hover:text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
      >
        <span className="max-w-[200px] truncate">
          {activeProject ? activeProject.name : '无项目'}
        </span>
        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="absolute left-1/2 top-full z-50 mt-1 -translate-x-1/2 min-w-[180px] max-w-[280px] rounded-md border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          {projects.length === 0 ? (
            <div className="px-3 py-2 text-xs text-zinc-400">无项目</div>
          ) : (
            projects.map(p => (
              <button
                key={p.key}
                onClick={() => {
                  setActiveKey(p.key);
                  setOpen(false);
                }}
                className={cn(
                  'flex w-full items-center px-3 py-1.5 text-sm transition-colors text-left',
                  p.key === activeKey
                    ? 'bg-zinc-100 text-zinc-900 font-medium dark:bg-zinc-800 dark:text-zinc-100'
                    : 'text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/50 dark:hover:text-zinc-200',
                )}
              >
                <span className="truncate">{p.name}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
