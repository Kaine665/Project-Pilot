'use client';

import { useCallback, useEffect, useState, lazy, Suspense } from 'react';
import { TopNav } from '@/components/top-nav';
import { useProject } from '@/components/project-context';
import { WorkspaceSidebarRail } from '@/components/workspace-sidebar-rail';
import { BUTLER_AGENT_ID } from '@/lib/default-agents';
import {
  readWorkspaceSidebarRailMini,
  writeWorkspaceSidebarRailMini,
} from '@/lib/workspace-sidebar-rail-storage';
import { useRouter, usePathname } from '@/client/i18n/routing';
import { useMediaQuery } from '@/hooks/use-media-query';
import { cn } from '@/lib/utils';
import type { Agent } from '@/types';

const AgentChatPanel = lazy(() =>
  import('@/components/agent-chat-panel').then((m) => ({ default: m.AgentChatPanel })),
);

/** 与 `src/client/routes/workspace-shell.tsx` 同构；对外 URL 为 `/workspace/*`。 */
export default function WorkspaceShellLayout({ children }: { children: React.ReactNode }) {
  const { activeKey } = useProject();
  const router = useRouter();
  const pathname = usePathname();

  const [plannerOpen, setPlannerOpen] = useState(false);
  const [butlerAgent, setButlerAgent] = useState<Agent | null>(null);
  const [schedulesPageEnabled, setSchedulesPageEnabled] = useState(true);
  const [taskTriggersPageEnabled, setTaskTriggersPageEnabled] = useState(true);
  const [sidebarRailMini, setSidebarRailMini] = useState(() => readWorkspaceSidebarRailMini());
  const [mobileRailOpen, setMobileRailOpen] = useState(false);
  const mdUp = useMediaQuery('(min-width: 768px)');

  const setRailMini = useCallback((next: boolean) => {
    setSidebarRailMini(next);
    writeWorkspaceSidebarRailMini(next);
  }, []);

  const handleWorkspaceSidebarToggle = useCallback(() => {
    if (mdUp) {
      setRailMini(!sidebarRailMini);
    } else {
      setMobileRailOpen((o) => !o);
    }
  }, [mdUp, sidebarRailMini, setRailMini]);

  const isTaskTriggersPage = pathname.startsWith('/workspace/task-triggers');
  const isSchedulesPage = pathname.startsWith('/workspace/schedules');
  const isButlerPage = pathname.startsWith('/workspace/butler');

  useEffect(() => {
    (async () => {
      try {
        const [agentsRes, settingsRes] = await Promise.all([
          fetch('/api/agents'),
          fetch('/api/settings'),
        ]);
        const agentData = await agentsRes.json();
        const settingsData = await settingsRes.json();

        const agents: Agent[] = agentData.agents ?? [];
        const butler = agents.find((agent) => agent.id === BUTLER_AGENT_ID && !agent.archived);
        if (butler) setButlerAgent(butler);

        setSchedulesPageEnabled(settingsData.developer?.schedulesPageEnabled !== false);
        setTaskTriggersPageEnabled(settingsData.developer?.taskTriggersPageEnabled !== false);
      } catch {
        // ignore
      }
    })();
  }, []);

  useEffect(() => {
    const handleToggle = () => setPlannerOpen((value) => !value);
    const handleOpen = () => setPlannerOpen(true);
    window.addEventListener('pp:toggle-planner', handleToggle);
    window.addEventListener('pp:open-planner', handleOpen);
    return () => {
      window.removeEventListener('pp:toggle-planner', handleToggle);
      window.removeEventListener('pp:open-planner', handleOpen);
    };
  }, []);

  useEffect(() => {
    if (isSchedulesPage && !schedulesPageEnabled) {
      router.replace('/workspace/projects');
      return;
    }
    if (isTaskTriggersPage && !taskTriggersPageEnabled) {
      router.replace('/workspace/projects');
    }
  }, [isSchedulesPage, isTaskTriggersPage, router, schedulesPageEnabled, taskTriggersPageEnabled]);

  useEffect(() => {
    setMobileRailOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (mdUp) setMobileRailOpen(false);
  }, [mdUp]);

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <TopNav
        workspaceSidebarMini={mdUp ? sidebarRailMini : !mobileRailOpen}
        onToggleWorkspaceSidebar={handleWorkspaceSidebarToggle}
      />
      <div className="relative flex flex-1 overflow-hidden">
        {!mdUp && mobileRailOpen && (
          <button
            type="button"
            className="fixed inset-0 top-14 z-40 bg-black/40"
            aria-label="Close navigation"
            onClick={() => setMobileRailOpen(false)}
          />
        )}
        <div
          className={cn(
            'flex h-full shrink-0',
            !mdUp &&
              cn(
                'fixed left-0 top-14 z-50 h-[calc(100vh-3.5rem)] transition-transform duration-200 ease-out',
                mobileRailOpen ? 'translate-x-0' : 'pointer-events-none -translate-x-full',
              ),
          )}
        >
          <WorkspaceSidebarRail
            mini={mdUp ? sidebarRailMini : false}
            schedulesPageEnabled={schedulesPageEnabled}
            taskTriggersPageEnabled={taskTriggersPageEnabled}
          />
        </div>

        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{children}</main>

        {!isButlerPage && (
          <>
            {plannerOpen && !mdUp && (
              <button
                type="button"
                className="fixed inset-0 top-14 z-40 bg-black/40 md:hidden"
                aria-label="Close planner"
                onClick={() => setPlannerOpen(false)}
              />
            )}
            <div
              style={mdUp ? { width: plannerOpen ? 360 : 0 } : undefined}
              className={cn(
                'shrink-0 overflow-hidden bg-white transition-[width,transform] duration-200 ease-in-out dark:bg-zinc-950',
                mdUp && plannerOpen && 'border-l border-zinc-200 dark:border-zinc-800',
                !mdUp &&
                  cn(
                    'fixed bottom-0 right-0 top-14 z-50 w-[min(100vw,420px)] max-w-full border-l border-zinc-200 shadow-2xl transition-transform dark:border-zinc-800',
                    plannerOpen ? 'translate-x-0' : 'pointer-events-none translate-x-full',
                  ),
              )}
            >
              <div className={cn('flex h-full flex-col', mdUp ? 'w-[360px]' : 'w-full min-w-0')}>
                {butlerAgent && (
                  <Suspense
                    fallback={
                      <div className="flex flex-1 items-center justify-center">
                        <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-primary" />
                      </div>
                    }
                  >
                    <AgentChatPanel agent={butlerAgent} variant="sidebar" projectKey={activeKey} />
                  </Suspense>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
