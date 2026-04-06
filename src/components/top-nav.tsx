'use client';

import { useState, useEffect, useRef } from 'react';
import { ChevronDown, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { useTranslations } from '@/client/i18n/use-translations';
import { cn } from '@/lib/utils';
import { LanguageSwitcher } from './language-switcher';
import { useProject } from './project-context';

export function TopNav({
  children,
  workspaceSidebarMini,
  onToggleWorkspaceSidebar,
}: {
  children?: React.ReactNode;
  /** 侧栏是否为迷你条；与 onToggleWorkspaceSidebar 同时传入时显示顶栏切换钮 */
  workspaceSidebarMini?: boolean;
  onToggleWorkspaceSidebar?: () => void;
}) {
  const tr = useTranslations('workspaceSidebarRail');
  const showSidebarToggle =
    typeof workspaceSidebarMini === 'boolean' && typeof onToggleWorkspaceSidebar === 'function';

  return (
    <header className="flex shrink-0 items-center border-b border-zinc-200 bg-white px-4 py-3 sm:px-6 dark:border-zinc-800 dark:bg-zinc-950">
      {/* 与右侧区等宽，保证中间项目切换在顶栏水平居中 */}
      <div className="flex min-w-0 flex-1 items-center justify-start">
        {showSidebarToggle ? (
          <button
            type="button"
            onClick={onToggleWorkspaceSidebar}
            className={cn(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-600 shadow-sm',
              'transition-all hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-900',
              'active:scale-[0.97] active:border-zinc-300 active:bg-zinc-100',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 focus-visible:ring-offset-2',
              'dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300',
              'dark:hover:border-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-100',
              'dark:active:bg-zinc-800 dark:focus-visible:ring-zinc-500 dark:ring-offset-zinc-950',
            )}
            aria-label={workspaceSidebarMini ? tr('expandGuide') : tr('collapseGuide')}
            title={workspaceSidebarMini ? tr('expandGuide') : tr('collapseGuide')}
          >
            {workspaceSidebarMini ? (
              <ChevronsRight className="h-5 w-5" aria-hidden />
            ) : (
              <ChevronsLeft className="h-5 w-5" aria-hidden />
            )}
          </button>
        ) : (
          <div className="h-10 w-10 shrink-0" aria-hidden />
        )}
      </div>
      <div className="flex shrink-0 justify-center">
        <ProjectSwitcher />
      </div>
      <div className="flex min-w-0 flex-1 items-center justify-end gap-3">
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
        <span className="max-w-[min(200px,42vw)] truncate sm:max-w-[200px]">
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
