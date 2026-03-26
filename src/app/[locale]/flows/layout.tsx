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

export default function FlowsLayout({ children }: { children: React.ReactNode }) {
  const { activeKey } = useProject();
  const router = useRouter();
  const pathname = usePathname();

  const [plannerOpen, setPlannerOpen] = useState(false);
  const [butlerAgent, setButlerAgent] = useState<Agent | null>(null);
  const [schedulesPageEnabled, setSchedulesPageEnabled] = useState(true);
  const [taskTriggersPageEnabled, setTaskTriggersPageEnabled] = useState(true);

  const isAgentsPage = pathname.startsWith('/flows/agents');
  const isContextPage = pathname.startsWith('/flows/context');
  const isButlerPage = pathname.startsWith('/flows/butler');
  const isDocsPage = pathname.startsWith('/flows/docs');
  const isTodosPage = pathname.startsWith('/flows/todos');
  const isTaskTriggersPage = pathname.startsWith('/flows/task-triggers');
  const isSchedulesPage = pathname.startsWith('/flows/schedules');
  const isSatelliteTasksPage = pathname.startsWith('/flows/satellite-tasks');
  const isChatPage = pathname.startsWith('/flows/chat');
  const isDialoguesPage = pathname.startsWith('/flows/dialogues');
  const isSkillsPage = pathname.startsWith('/flows/skills');
  const isKnowledgePage = pathname.startsWith('/flows/knowledge');
  const isPromptsPage = pathname.startsWith('/flows/prompts');

  const isSubRoute =
    isAgentsPage ||
    isContextPage ||
    isDocsPage ||
    isButlerPage ||
    isTodosPage ||
    isTaskTriggersPage ||
    isSchedulesPage ||
    isSatelliteTasksPage ||
    isChatPage ||
    isDialoguesPage ||
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
      router.replace('/flows/projects');
      return;
    }
    if (isTaskTriggersPage && !taskTriggersPageEnabled) {
      router.replace('/flows/projects');
    }
  }, [isSchedulesPage, isTaskTriggersPage, router, schedulesPageEnabled, taskTriggersPageEnabled]);

  const handleToggleProjects = () => {
    if (isSubRoute || !pathname.startsWith('/flows/projects')) {
      router.push('/flows/projects');
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
              <SidebarIconButton icon={Bot} tooltip="Agents" isActive={isAgentsPage} onClick={() => router.push('/flows/agents')} />

              <div className="w-6 border-t border-zinc-200 dark:border-zinc-700" />

              <SidebarIconButton
                icon={BookOpen}
                tooltip="文档"
                isActive={isContextPage || isDocsPage}
                onClick={() => router.push(activeKey ? `/flows/docs/${activeKey}` : '/flows/docs')}
              />
              <SidebarIconButton icon={Blocks} tooltip="Skills" isActive={isSkillsPage} onClick={() => router.push('/flows/skills')} />
              <SidebarIconButton icon={ScrollText} tooltip="提示词" isActive={isPromptsPage} onClick={() => router.push('/flows/prompts')} />

              <div className="w-6 border-t border-zinc-200 dark:border-zinc-700" />

              <SidebarIconButton icon={ListTodo} tooltip="待办" isActive={isTodosPage} onClick={() => router.push('/flows/todos')} />
              {taskTriggersPageEnabled && (
                <SidebarIconButton icon={Zap} tooltip="任务触发" isActive={isTaskTriggersPage} onClick={() => router.push('/flows/task-triggers')} />
              )}

              <div className="w-6 border-t border-zinc-200 dark:border-zinc-700" />

              {schedulesPageEnabled && (
                <SidebarIconButton icon={Timer} tooltip="定时运行" isActive={isSchedulesPage} onClick={() => router.push('/flows/schedules')} />
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
