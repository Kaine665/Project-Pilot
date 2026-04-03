'use client';

import { useEffect, useState, lazy, Suspense } from 'react';
import { Blocks, BookOpen, Bot, FolderKanban, ListTodo, ScrollText, Timer, Zap } from 'lucide-react';
import { TopNav } from '@/components/top-nav';
import { useProject } from '@/components/project-context';
import { SidebarIconButton } from '@/components/sidebar-icon-button';
import { TooltipProvider } from '@/components/ui/tooltip';
import { BUTLER_AGENT_ID } from '@/lib/default-agents';
import { useRouter, usePathname } from '@/client/i18n/routing';
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

  const isAgentsPage = pathname.startsWith('/workspace/agents');
  const isContextPage = pathname.startsWith('/workspace/context');
  const isButlerPage = pathname.startsWith('/workspace/butler');
  const isDocsPage = pathname.startsWith('/workspace/docs');
  const isTodosPage = pathname.startsWith('/workspace/todos');
  const isTaskTriggersPage = pathname.startsWith('/workspace/task-triggers');
  const isSchedulesPage = pathname.startsWith('/workspace/schedules');
  const isChatPage = pathname.startsWith('/workspace/chat');
  const isSkillsPage = pathname.startsWith('/workspace/skills');
  const isKnowledgePage = pathname.startsWith('/workspace/knowledge');
  const isPromptsPage = pathname.startsWith('/workspace/prompts');

  const isSubRoute =
    isAgentsPage ||
    isContextPage ||
    isDocsPage ||
    isButlerPage ||
    isTodosPage ||
    isTaskTriggersPage ||
    isSchedulesPage ||
    isChatPage ||
    isSkillsPage ||
    isKnowledgePage ||
    isPromptsPage;

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

  const handleToggleProjects = () => {
    if (isSubRoute || !pathname.startsWith('/workspace/projects')) {
      router.push('/workspace/projects');
    }
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <TopNav plannerOpen={plannerOpen} />
      <div className="flex flex-1 overflow-hidden">
        <div data-sidebar className="flex h-full shrink-0">
          <TooltipProvider delayDuration={300}>
            <div className="flex w-13 flex-col items-center gap-2 border-r border-zinc-200 bg-zinc-50/50 py-4 dark:border-zinc-800 dark:bg-zinc-950">
              <SidebarIconButton icon={FolderKanban} tooltip="项目管理" isActive={!isSubRoute} onClick={handleToggleProjects} />
              <SidebarIconButton icon={Bot} tooltip="Agents" isActive={isAgentsPage} onClick={() => router.push('/workspace/agents')} />

              <div className="w-6 border-t border-zinc-200 dark:border-zinc-700" />

              <SidebarIconButton
                icon={BookOpen}
                tooltip="文档"
                isActive={isContextPage || isDocsPage}
                onClick={() => router.push(activeKey ? `/workspace/docs/${activeKey}` : '/workspace/docs')}
              />
              <SidebarIconButton icon={Blocks} tooltip="Skills" isActive={isSkillsPage} onClick={() => router.push('/workspace/skills')} />
              <SidebarIconButton icon={ScrollText} tooltip="提示词" isActive={isPromptsPage} onClick={() => router.push('/workspace/prompts')} />

              <div className="w-6 border-t border-zinc-200 dark:border-zinc-700" />

              <SidebarIconButton icon={ListTodo} tooltip="待办" isActive={isTodosPage} onClick={() => router.push('/workspace/todos')} />
              {taskTriggersPageEnabled && (
                <SidebarIconButton icon={Zap} tooltip="任务触发" isActive={isTaskTriggersPage} onClick={() => router.push('/workspace/task-triggers')} />
              )}

              <div className="w-6 border-t border-zinc-200 dark:border-zinc-700" />

              {schedulesPageEnabled && (
                <SidebarIconButton icon={Timer} tooltip="定时运行" isActive={isSchedulesPage} onClick={() => router.push('/workspace/schedules')} />
              )}
            </div>
          </TooltipProvider>
        </div>

        <main className="flex-1 overflow-auto">{children}</main>

        {!isButlerPage && (
          <div
            style={{ width: plannerOpen ? 360 : 0 }}
            className={`shrink-0 overflow-hidden bg-white transition-[width] duration-200 ease-in-out dark:bg-zinc-950 ${plannerOpen ? 'border-l border-zinc-200 dark:border-zinc-800' : ''}`}
          >
            <div className="flex h-full w-[360px] flex-col">
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
        )}
      </div>
    </div>
  );
}
