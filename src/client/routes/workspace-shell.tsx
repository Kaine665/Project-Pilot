/**
 * 主工作区壳（侧栏 + Outlet）。
 * 页面组件位于 `src/app/[locale]/flows/`（目录名为历史遗留；对外 URL 使用 `/workspace/*`）。
 */
import type { CSSProperties } from 'react';
import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { Outlet } from 'react-router';
import { ElectronTitleBar } from '@/components/electron-title-bar';
import { TopNav } from '@/components/top-nav';
import { useProject } from '@/components/project-context';
import { WorkspaceSidebarRail } from '@/components/workspace-sidebar-rail';
import { useMediaQuery } from '@/hooks/use-media-query';
import { BUTLER_AGENT_ID } from '@/lib/default-agents';
import {
  PP_ELECTRON_TITLEBAR_CSS_VAR,
  PP_WORKSPACE_FIXED_HEIGHT_CLASS,
  PP_WORKSPACE_FIXED_TOP_CLASS,
  PP_WORKSPACE_TOP_NAV_STACK,
  readElectronTitleBarInsetPx,
} from '@/lib/electron-title-bar-inset';
import { PP_WORKSPACE_IMMERSIVE_EVENT, type WorkspaceImmersiveDetail } from '@/lib/workspace-immersive-bus';
import { cn } from '@/lib/utils';
import {
  readWorkspaceSidebarRailHidden,
  writeWorkspaceSidebarRailHidden,
} from '@/lib/workspace-sidebar-rail-storage';
import { useRouter, usePathname } from '@/client/i18n/routing';
import type { Agent } from '@/types';

const AgentChatPanel = lazy(() =>
  import('@/components/agent-chat-panel').then((m) => ({ default: m.AgentChatPanel })),
);

export default function WorkspaceShell({ children }: { children?: React.ReactNode }) {
  const { activeKey } = useProject();
  const router = useRouter();
  const pathname = usePathname();

  const [plannerOpen, setPlannerOpen] = useState(false);
  const [butlerAgent, setButlerAgent] = useState<Agent | null>(null);
  const [schedulesPageEnabled, setSchedulesPageEnabled] = useState(true);
  const [taskTriggersPageEnabled, setTaskTriggersPageEnabled] = useState(true);
  const [sidebarRailHidden, setSidebarRailHidden] = useState(() =>
    readWorkspaceSidebarRailHidden(),
  );
  const [mobileRailOpen, setMobileRailOpen] = useState(false);
  const [electronTitleBarInsetPx, setElectronTitleBarInsetPx] = useState(() =>
    readElectronTitleBarInsetPx(),
  );
  const [workspaceImmersive, setWorkspaceImmersive] = useState(false);
  const mdUp = useMediaQuery('(min-width: 768px)');

  const setRailHidden = useCallback((next: boolean) => {
    setSidebarRailHidden(next);
    writeWorkspaceSidebarRailHidden(next);
  }, []);

  const handleWorkspaceSidebarToggle = useCallback(() => {
    if (mdUp) {
      setRailHidden(!sidebarRailHidden);
    } else {
      setMobileRailOpen((o) => !o);
    }
  }, [mdUp, sidebarRailHidden, setRailHidden]);

  const isTaskTriggersPage =
    pathname.startsWith('/workspace/task-triggers') ||
    pathname.includes('/workspace/tasks/triggers');
  const isSchedulesPage =
    pathname.startsWith('/workspace/schedules') ||
    pathname.includes('/workspace/tasks/schedules');
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
      router.replace('/workspace/tasks/todos');
      return;
    }
    if (isTaskTriggersPage && !taskTriggersPageEnabled) {
      router.replace('/workspace/tasks/todos');
    }
  }, [isSchedulesPage, isTaskTriggersPage, router, schedulesPageEnabled, taskTriggersPageEnabled]);

  useEffect(() => {
    setMobileRailOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (mdUp) setMobileRailOpen(false);
  }, [mdUp]);

  useEffect(() => {
    setElectronTitleBarInsetPx(readElectronTitleBarInsetPx());
  }, []);

  useEffect(() => {
    const onImmersive = (e: Event) => {
      const d = (e as CustomEvent<WorkspaceImmersiveDetail>).detail;
      setWorkspaceImmersive(Boolean(d?.immersive));
    };
    window.addEventListener(PP_WORKSPACE_IMMERSIVE_EVENT, onImmersive);
    return () => window.removeEventListener(PP_WORKSPACE_IMMERSIVE_EVENT, onImmersive);
  }, []);

  useEffect(() => {
    if (workspaceImmersive) setMobileRailOpen(false);
  }, [workspaceImmersive]);

  /**
   * Electron 有 `ElectronTitleBar` 时壳层从不给 `TopNav` 传 children，整行几乎是空白（≈3.5rem），
   * 叠在 `paddingTop` 后像「线下面又空 100px」；浏览器无 WCO 时仍需 TopNav（侧栏钮等）。
   */
  const showWorkspaceTopNav = !workspaceImmersive && electronTitleBarInsetPx <= 0;

  const fixedTop = workspaceImmersive
    ? `${electronTitleBarInsetPx}px`
    : showWorkspaceTopNav
      ? `calc(${PP_WORKSPACE_TOP_NAV_STACK} + ${electronTitleBarInsetPx}px)`
      : `${electronTitleBarInsetPx}px`;
  const fixedHeight = workspaceImmersive
    ? `calc(100vh - ${electronTitleBarInsetPx}px)`
    : showWorkspaceTopNav
      ? `calc(100vh - ${PP_WORKSPACE_TOP_NAV_STACK} - ${electronTitleBarInsetPx}px)`
      : `calc(100vh - ${electronTitleBarInsetPx}px)`;

  const shellRootStyle = {
    [PP_ELECTRON_TITLEBAR_CSS_VAR]: `${electronTitleBarInsetPx}px`,
    '--pp-workspace-fixed-top': fixedTop,
    '--pp-workspace-fixed-height': fixedHeight,
    ...(electronTitleBarInsetPx > 0 ? { paddingTop: electronTitleBarInsetPx } : {}),
  } as CSSProperties;

  return (
    <div className="flex h-screen flex-col overflow-hidden" style={shellRootStyle}>
      {electronTitleBarInsetPx > 0 ? (
        <ElectronTitleBar
          heightPx={electronTitleBarInsetPx}
          dragOnly={workspaceImmersive}
          workspaceSidebarMini={mdUp ? sidebarRailHidden : !mobileRailOpen}
          onToggleWorkspaceSidebar={handleWorkspaceSidebarToggle}
        />
      ) : null}
      {showWorkspaceTopNav ? (
        <TopNav
          workspaceSidebarMini={mdUp ? sidebarRailHidden : !mobileRailOpen}
          onToggleWorkspaceSidebar={handleWorkspaceSidebarToggle}
          titleBarInsetPx={electronTitleBarInsetPx}
        />
      ) : null}
      <div className="relative flex flex-1 overflow-hidden">
        {!workspaceImmersive && !mdUp && mobileRailOpen && (
          <button
            type="button"
            className={cn('fixed inset-0 z-40 bg-black/40', PP_WORKSPACE_FIXED_TOP_CLASS)}
            aria-label="Close navigation"
            onClick={() => setMobileRailOpen(false)}
          />
        )}
        {!workspaceImmersive ? (
          <div
            className={cn(
              'flex h-full shrink-0',
              mdUp && sidebarRailHidden && 'hidden',
              !mdUp &&
                cn(
                  'fixed left-0 z-50 transition-transform duration-200 ease-out',
                  PP_WORKSPACE_FIXED_TOP_CLASS,
                  PP_WORKSPACE_FIXED_HEIGHT_CLASS,
                  mobileRailOpen ? 'translate-x-0' : 'pointer-events-none -translate-x-full',
                ),
            )}
          >
            <WorkspaceSidebarRail mini={false} />
          </div>
        ) : null}

        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {/* 保证嵌套路由（如社区商店左右分栏）能继承 flex-1 + min-h-0，避免子树高度塌缩 */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{children ?? <Outlet />}</div>
        </main>

        {!isButlerPage && (
          <>
            {plannerOpen && !mdUp && (
              <button
                type="button"
                className={cn(
                  'fixed inset-0 z-40 bg-black/40 md:hidden',
                  PP_WORKSPACE_FIXED_TOP_CLASS,
                )}
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
                    'fixed bottom-0 right-0 z-50 w-[min(100vw,420px)] max-w-full border-l border-zinc-200 shadow-2xl transition-transform dark:border-zinc-800',
                    PP_WORKSPACE_FIXED_TOP_CLASS,
                    plannerOpen ? 'translate-x-0' : 'pointer-events-none translate-x-full',
                  ),
              )}
            >
              <div className={cn('flex h-full flex-col', mdUp ? 'w-[360px]' : 'w-full min-w-0')}>
                <Suspense fallback={null}>
                  {butlerAgent && <AgentChatPanel agent={butlerAgent} variant="sidebar" projectKey={activeKey} />}
                </Suspense>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
