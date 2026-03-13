'use client';

import { useState, useEffect, useCallback, useRef, createContext, useContext } from 'react';
import { TopNav } from '@/components/top-nav';
import dynamic from 'next/dynamic';
const AgentChatPanel = dynamic(
  () => import('@/components/agent-chat-panel').then(m => m.AgentChatPanel),
  { ssr: false },
);
import { useProject } from '@/components/project-context';
import { FolderKanban, Plus, Trash2, Network, Bot, Layers, BookOpen, FileText, ListTodo, Table2, Timer, Satellite, MessageSquare } from 'lucide-react';
import { SidebarIconButton } from '@/components/sidebar-icon-button';
import { BUTLER_AGENT_ID } from '@/lib/default-agents';
import type { Agent } from '@/types';
import { useRouter, usePathname } from '@/i18n/routing';
import { TooltipProvider } from '@/components/ui/tooltip';
const SortableProjectTree = dynamic(
  () => import('@/components/sortable-project-tree').then(m => m.SortableProjectTree),
  { ssr: false },
);

interface FlowsContextValue {
  highlightSectionId: string | null;
  setHighlightSectionId: (id: string | null) => void;
}

const FlowsContext = createContext<FlowsContextValue | null>(null);
export function useFlowsContext() {
  const ctx = useContext(FlowsContext);
  if (!ctx) throw new Error('useFlowsContext must be inside FlowsLayout');
  return ctx;
}

export default function FlowsLayout({ children }: { children: React.ReactNode }) {
  const { projects, activeKey, setActiveKey, fetchProjects } = useProject();
  const router = useRouter();
  const pathname = usePathname();

  const [panelOpen, setPanelOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [sections, setSections] = useState<{ id: string; name: string }[]>([]);
  const [highlightSectionId, setHighlightSectionId] = useState<string | null>(null);
  const [plannerOpen, setPlannerOpen] = useState(false);
  const [butlerAgent, setButlerAgent] = useState<Agent | null>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);

  const isAgentsPage = pathname.startsWith('/flows/agents');
  const isDimensionsPage = pathname.startsWith('/flows/dimensions');
  const isContextPage = pathname.startsWith('/flows/context');
  const isRecycleBinPage = pathname.startsWith('/flows/recycle-bin');
  const isButlerPage = pathname.startsWith('/flows/butler');
  const isDocsPage = pathname.startsWith('/flows/docs');
  const isTodosPage = pathname.startsWith('/flows/todos');
  const isOrchestratorPage = pathname.startsWith('/flows/orchestrator');
  const isBitablePage = pathname.startsWith('/flows/bitable');
  const isSchedulesPage = pathname.startsWith('/flows/schedules');
  const isSatelliteTasksPage = pathname.startsWith('/flows/satellite-tasks');
  const isChatPage = pathname.startsWith('/flows/chat');
  const isSubRoute = isAgentsPage || isDimensionsPage || isContextPage || isDocsPage || isRecycleBinPage || isButlerPage || isTodosPage || isOrchestratorPage || isBitablePage || isSchedulesPage || isSatelliteTasksPage || isChatPage;

  // Auto-close expandable panel when on sub-route pages
  useEffect(() => {
    if (isSubRoute) setPanelOpen(false);
  }, [isSubRoute]);

  const fetchSections = useCallback(async (projectKey: string) => {
    try {
      const res = await fetch(`/api/data?project=${encodeURIComponent(projectKey)}`);
      if (!res.ok) { setSections([]); return; }
      const data = await res.json();
      const list = (data.sections ?? []).map((s: { id: string; name: string }) => ({ id: s.id, name: s.name }));
      setSections(list);
    } catch {
      setSections([]);
    }
  }, []);

  useEffect(() => {
    if (activeKey) fetchSections(activeKey);
    else setSections([]);
  }, [activeKey, fetchSections]);

  // Load butler agent
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/agents');
        const data = await res.json();
        const agents: Agent[] = data.agents ?? [];
        const butler = agents.find(a => a.id === BUTLER_AGENT_ID && !a.archived);
        if (butler) setButlerAgent(butler);
      } catch { /* ignore */ }
    })();
  }, []);

  // Listen for planner toggle/open from TopNav
  useEffect(() => {
    const handleToggle = () => setPlannerOpen(v => !v);
    const handleOpen = () => setPlannerOpen(true);
    window.addEventListener('pp:toggle-planner', handleToggle);
    window.addEventListener('pp:open-planner', handleOpen);
    return () => {
      window.removeEventListener('pp:toggle-planner', handleToggle);
      window.removeEventListener('pp:open-planner', handleOpen);
    };
  }, []);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    const asciiKey = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      || `p${Date.now()}`;

    try {
      const res = await fetch('/api/data/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: asciiKey, name }),
      });
      if (res.ok) {
        await fetchProjects();
        setActiveKey(asciiKey);
        setNewName('');
        setCreating(false);
      }
    } catch {
      // ignore
    }
  };

  const handleToggleProjects = () => {
    if (isSubRoute) {
      router.push('/flows/projects');
      setPanelOpen(true);
    } else {
      setPanelOpen(v => !v);
    }
  };

  const handleNavigateAgents = () => {
    router.push('/flows/agents');
  };

  const handleNavigateRecycleBin = () => {
    router.push('/flows/recycle-bin');
  };

  const handleNavigateDimensions = () => {
    router.push('/flows/dimensions');
  };

  const handleNavigateContext = () => {
    router.push('/flows/context');
  };

  const handleNavigateDocs = () => {
    router.push(activeKey ? `/flows/docs/${activeKey}` : '/flows/docs');
  };

  const handleNavigateTodos = () => {
    router.push('/flows/todos');
  };


  const panelWidth = 'w-60';
  const panelInnerWidth = 'w-60';

  return (
    <FlowsContext.Provider value={{ highlightSectionId, setHighlightSectionId }}>
      <div className="flex h-screen flex-col overflow-hidden">
        <TopNav plannerOpen={plannerOpen} />
        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar: icon strip + expandable panel */}
          <div
            ref={sidebarRef}
            data-sidebar
            className="flex shrink-0 h-full"
          >
            {/* Icon strip — always visible */}
            <TooltipProvider delayDuration={300}>
            <div className="flex w-13 flex-col items-center border-r border-zinc-200 bg-zinc-50/50 py-4 gap-2 dark:border-zinc-800 dark:bg-zinc-950">
              <SidebarIconButton icon={FolderKanban} tooltip="项目管理" isActive={!isSubRoute && panelOpen} onClick={handleToggleProjects} />
              <SidebarIconButton icon={Bot} tooltip="Agents" isActive={isAgentsPage} onClick={handleNavigateAgents} />
              <SidebarIconButton icon={Layers} tooltip="信息角度" isActive={isDimensionsPage} onClick={handleNavigateDimensions} />
              <SidebarIconButton icon={BookOpen} tooltip="上下文" isActive={isContextPage} onClick={handleNavigateContext} />
              <SidebarIconButton icon={FileText} tooltip="设计文档" isActive={isDocsPage} onClick={handleNavigateDocs} />
              <SidebarIconButton icon={ListTodo} tooltip="AI 待办" isActive={isTodosPage} onClick={handleNavigateTodos} />
              <SidebarIconButton icon={Table2} tooltip="多维表格" isActive={isBitablePage} onClick={() => router.push('/flows/bitable')} />
              <SidebarIconButton icon={Network} tooltip="Agent 编排" isActive={isOrchestratorPage} onClick={() => router.push('/flows/orchestrator')} />
              <SidebarIconButton icon={Timer} tooltip="定时运行" isActive={isSchedulesPage} onClick={() => router.push('/flows/schedules')} />
              <SidebarIconButton icon={Satellite} tooltip="卫星任务" isActive={isSatelliteTasksPage} onClick={() => router.push('/flows/satellite-tasks')} />
              <SidebarIconButton icon={MessageSquare} tooltip="P2P 聊天" isActive={isChatPage} onClick={() => router.push('/flows/chat')} />
              <SidebarIconButton icon={Trash2} tooltip="回收站" isActive={isRecycleBinPage} onClick={handleNavigateRecycleBin} />
            </div>
            </TooltipProvider>

            {/* Expandable panel — only visible on main flows page */}
            {!isSubRoute && (
            <div
              className={`overflow-hidden border-r border-zinc-200 bg-white transition-[width] duration-200 ease-in-out dark:border-zinc-800 dark:bg-zinc-950 ${
                panelOpen ? panelWidth : 'w-0 border-r-0'
              }`}
            >
              <div className={`flex h-full ${panelInnerWidth} flex-col`}>
                    {/* Create project — top */}
                    <div className="border-b border-zinc-100 p-2 dark:border-zinc-800">
                      {creating ? (
                        <div className="space-y-1.5">
                          <input
                            autoFocus
                            value={newName}
                            onChange={e => setNewName(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') handleCreate();
                              if (e.key === 'Escape') { setCreating(false); setNewName(''); }
                            }}
                            placeholder="项目名称"
                            className="w-full rounded border border-zinc-300 px-2 py-1 text-xs outline-none focus:border-zinc-500 dark:border-zinc-600 dark:bg-zinc-900 dark:focus:border-zinc-400"
                          />
                          <div className="flex gap-1">
                            <button
                              onClick={handleCreate}
                              className="flex-1 rounded bg-zinc-900 px-2 py-1 text-xs text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                            >
                              创建
                            </button>
                            <button
                              onClick={() => { setCreating(false); setNewName(''); }}
                              className="px-2 py-1 text-xs text-zinc-400 hover:text-zinc-600"
                            >
                              取消
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          onClick={() => setCreating(true)}
                          className="flex w-full items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-zinc-400 hover:bg-zinc-50 hover:text-zinc-600 transition-colors dark:hover:bg-zinc-800/50 dark:hover:text-zinc-300"
                        >
                          <Plus className="h-3 w-3" />
                          新建项目
                        </button>
                      )}
                    </div>

                    {/* Project tree */}
                    <div className="flex-1 overflow-y-auto px-1.5 py-1">
                      <SortableProjectTree
                        projects={projects}
                        activeKey={activeKey}
                        sections={sections}
                        setSections={setSections}
                        setActiveKey={setActiveKey}
                        fetchProjects={fetchProjects}
                        setHighlightSectionId={setHighlightSectionId}
                      />
                    </div>
              </div>
            </div>
            )}
          </div>

          {/* Main content */}
          <main className="flex-1 overflow-auto">{children}</main>

          {/* Right-side AI Planner panel (hidden on butler page) */}
          {!isButlerPage && (
          <div
            style={{ width: plannerOpen ? 360 : 0 }}
            className={`shrink-0 overflow-hidden bg-white transition-[width] duration-200 ease-in-out dark:bg-zinc-950 ${
              plannerOpen ? 'border-l border-zinc-200 dark:border-zinc-800' : ''
            }`}
          >
            <div className="flex h-full w-[360px] flex-col">
              {butlerAgent && (
                <AgentChatPanel agent={butlerAgent} variant="sidebar" projectKey={activeKey} />
              )}
            </div>
          </div>
          )}
        </div>
      </div>
    </FlowsContext.Provider>
  );
}

