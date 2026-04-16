'use client';

import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useTranslations } from '@/client/i18n/use-translations';
import { cn } from '@/lib/utils';

export type TasksWorkspaceOutletContext = { tasksHub: true };

/**
 * 统一「待办 / 任务触发 / 定时运行」入口：侧栏一项「任务」，内部分段导航。
 */
export default function TasksWorkspaceLayout() {
  const tr = useTranslations('workspaceSidebarRail');
  const location = useLocation();
  const navigate = useNavigate();
  const [schedulesPageEnabled, setSchedulesPageEnabled] = useState(true);
  const [taskTriggersPageEnabled, setTaskTriggersPageEnabled] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/settings');
        const data = await res.json();
        setSchedulesPageEnabled(data.developer?.schedulesPageEnabled !== false);
        setTaskTriggersPageEnabled(data.developer?.taskTriggersPageEnabled !== false);
      } catch {
        // ignore
      }
    })();
  }, []);

  useEffect(() => {
    const p = location.pathname;
    if (p.includes('/workspace/tasks/triggers') && !taskTriggersPageEnabled) {
      navigate('/workspace/tasks/todos', { replace: true });
      return;
    }
    if (p.includes('/workspace/tasks/schedules') && !schedulesPageEnabled) {
      navigate('/workspace/tasks/todos', { replace: true });
    }
  }, [location.pathname, navigate, schedulesPageEnabled, taskTriggersPageEnabled]);

  const tabClass = ({ isActive }: { isActive: boolean }) =>
    cn(
      'relative min-h-11 whitespace-nowrap rounded-xl px-5 py-2.5 text-base font-medium transition-colors',
      isActive
        ? 'bg-zinc-900 text-white shadow-sm dark:bg-zinc-100 dark:text-zinc-900'
        : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100',
    );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-zinc-50/40 dark:bg-zinc-950">
      <header className="flex shrink-0 justify-start border-b border-zinc-200/80 bg-white px-5 py-[4px] dark:border-zinc-800 dark:bg-zinc-950">
        <nav
          className="-mb-px flex flex-wrap justify-start gap-2"
          aria-label={tr('tasksNavAria')}
        >
          <NavLink to="/workspace/tasks/todos" className={tabClass}>
            {tr('todos')}
          </NavLink>
          {taskTriggersPageEnabled ? (
            <NavLink to="/workspace/tasks/triggers" className={tabClass}>
              {tr('taskTriggers')}
            </NavLink>
          ) : null}
          {schedulesPageEnabled ? (
            <NavLink to="/workspace/tasks/schedules" className={tabClass}>
              {tr('schedules')}
            </NavLink>
          ) : null}
        </nav>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden">
        <Outlet context={{ tasksHub: true } satisfies TasksWorkspaceOutletContext} />
      </div>
    </div>
  );
}
