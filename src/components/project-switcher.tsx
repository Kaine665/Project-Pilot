'use client';

import { useState, useEffect, useRef } from 'react';
import { ChevronDown } from 'lucide-react';
import { useTranslations } from '@/client/i18n/use-translations';
import { cn } from '@/lib/utils';
import { useProject } from '@/components/project-context';

export function ProjectSwitcher({
  /** `sidebar`：Agents 左侧栏「当前工作区」下全宽；`header`：顶栏居中（与其它页顶栏一致） */
  variant = 'header',
}: {
  variant?: 'header' | 'sidebar';
}) {
  const tWs = useTranslations('agentsWorkspace.workspace');
  const { projects, activeKey, setActiveKey } = useProject();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const activeProject = projects.find((p) => p.key === activeKey);

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

  const isSidebar = variant === 'sidebar';

  return (
    <div ref={containerRef} className={cn('relative', isSidebar && 'w-full min-w-0')}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex items-center gap-2 rounded-lg border text-sm font-medium shadow-sm transition-all',
          isSidebar
            ? 'w-full min-w-0 justify-between border-border bg-background px-3 py-2 text-left text-foreground hover:bg-muted/60 dark:border-border dark:bg-card/80 dark:hover:bg-muted/40'
            : 'border-zinc-200 bg-white px-4 py-1.5 text-zinc-600 hover:border-zinc-300 hover:text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200',
        )}
      >
        <span
          className={cn(
            'min-w-0 truncate',
            isSidebar ? 'flex-1' : 'max-w-[min(200px,42vw)] sm:max-w-[200px]',
          )}
        >
          {activeProject ? activeProject.name : tWs('projectSwitcherEmpty')}
        </span>
        <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div
          className={cn(
            'absolute top-full z-[100] mt-1 rounded-md border border-border bg-popover py-1 text-popover-foreground shadow-lg dark:border-border dark:bg-popover',
            isSidebar
              ? 'left-0 right-0 min-w-0 max-h-[min(320px,50vh)] overflow-y-auto'
              : 'left-1/2 min-w-[180px] max-w-[280px] -translate-x-1/2 border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900',
          )}
        >
          {projects.length === 0 ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">{tWs('projectSwitcherEmpty')}</div>
          ) : (
            projects.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => {
                  setActiveKey(p.key);
                  setOpen(false);
                }}
                className={cn(
                  'flex w-full items-center px-3 py-1.5 text-left text-sm transition-colors',
                  p.key === activeKey
                    ? 'bg-muted font-medium text-foreground dark:bg-muted/80'
                    : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground',
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
