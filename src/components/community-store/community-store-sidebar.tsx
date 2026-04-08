'use client';

import { Brain, Bot, LayoutGrid, Plug, Puzzle, Shapes } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslations } from '@/client/i18n/use-translations';
import { Link, usePathname } from '@/client/i18n/routing';
import { cn } from '@/lib/utils';

type NavKey = 'home' | 'agent' | 'skill' | 'mcp' | 'model' | 'provider';

function tabFromPath(pathname: string): NavKey {
  const p = pathname.replace(/\/$/, '') || '/';
  if (p === '/workspace/community') return 'home';
  if (p.startsWith('/workspace/community/agent')) return 'agent';
  if (p.startsWith('/workspace/community/skill')) return 'skill';
  if (p.startsWith('/workspace/community/mcp')) return 'mcp';
  if (p.startsWith('/workspace/community/model')) return 'model';
  if (p.startsWith('/workspace/community/provider')) return 'provider';
  return 'home';
}

const NavRow = memo(function NavRow({
  href,
  icon: Icon,
  label,
  active,
}: {
  href: string;
  icon: typeof Bot;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      to={href}
      className={cn(
        'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
        active
          ? 'bg-primary/12 text-primary'
          : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900',
      )}
    >
      <Icon className="h-[18px] w-[18px] shrink-0 opacity-90" aria-hidden />
      <span className="truncate">{label}</span>
    </Link>
  );
});

export const CommunityStoreSidebar = memo(function CommunityStoreSidebar() {
  const tab = tabFromPath(usePathname());
  const t = useTranslations('community');

  const items = useMemo(
    () =>
      [
        { key: 'home' as const, href: '/workspace/community', icon: Shapes, label: t('tab.home') },
        { key: 'agent' as const, href: '/workspace/community/agent', icon: Bot, label: t('tab.assistant') },
        { key: 'skill' as const, href: '/workspace/community/skill', icon: Puzzle, label: t('tab.skill') },
        { key: 'mcp' as const, href: '/workspace/community/mcp', icon: Plug, label: t('tab.mcp') },
        { key: 'model' as const, href: '/workspace/community/model', icon: Brain, label: t('tab.model') },
        {
          key: 'provider' as const,
          href: '/workspace/community/provider',
          icon: LayoutGrid,
          label: t('tab.provider'),
        },
      ] as const,
    [t],
  );

  return (
    <aside className="flex w-[200px] shrink-0 flex-col border-r border-zinc-200 bg-white py-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="px-3 pb-3">
        <p className="px-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">{t('storeBadge')}</p>
      </div>
      <nav className="flex flex-col gap-0.5 px-2">
        {items.map((item) => (
          <NavRow key={item.key} href={item.href} icon={item.icon} label={item.label} active={tab === item.key} />
        ))}
      </nav>
    </aside>
  );
});
