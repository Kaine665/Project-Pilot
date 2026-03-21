'use client';

import { useState, useEffect, useCallback, useRef, createContext, useContext } from 'react';
import { TopNav } from '@/components/top-nav';
import dynamic from 'next/dynamic';
const AgentChatPanel = dynamic(
  () => import('@/components/agent-chat-panel').then(m => m.AgentChatPanel),
  { ssr: false },
);
import { useProject } from '@/components/project-context';
import { FolderKanban, Plus, Bot, BookOpen, FileText, ListTodo, Timer, Satellite, MessageSquare, Blocks, Library, ScrollText, MessagesSquare } from 'lucide-react';
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
  const [newPath, setNewPath] = useState('');
  const [sections, setSections] = useState<{ id: string; name: string }[]>([]);
  const [highlightSectionId, setHighlightSectionId] = useState<string | null>(null);
  const [plannerOpen, setPlannerOpen] = useState(false);
  const [butlerAgent, setButlerAgent] = useState<Agent | null>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);

  const isAgentsPage = pathname.startsWith('/flows/agents');
  const isContextPage = pathname.startsWith('/flows/context');
  const isButlerPage = pathname.startsWith('/flows/butler');
  const isDocsPage = pathname.startsWith('/flows/docs');
  const isTodosPage = pathname.startsWith('/flows/todos');
  const isSchedulesPage = pathname.startsWith('/flows/schedules');
  const isSatelliteTasksPage = pathname.startsWith('/flows/satellite-tasks');
  const isChatPage = pathname.startsWith('/flows/chat');
  const isDialoguesPage = pathname.startsWith('/flows/dialogues');
  const isSkillsPage = pathname.startsWith('/flows/skills');
  const isKnowledgePage = pathname.startsWith('/flows/knowledge');
  const isPromptsPage = pathname.startsWith('/flows/prompts');
  const isSubRoute = isAgentsPage || isContextPage || isDocsPage || isButlerPage || isTodosPage || isSchedulesPage || isSatelliteTasksPage || isChatPage || isDialoguesPage || isSkillsPage || isKnowledgePage || isPromptsPage;

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
    const projectPath = newPath.trim();
    if (!name || !projectPath) return;
    const asciiKey = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      || `p${Date.now()}`;

    try {
      const res = await fetch('/api/data/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: asciiKey, name, path: projectPath }),
      });
      if (res.ok) {
        await fetchProjects();
        setActiveKey(asciiKey);
        setNewName('');
        setNewPath('');
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
              {/* Group: Core */}
              <SidebarIconButton icon={FolderKanban} tooltip="项目管理" isActive={!isSubRoute && panelOpen} onClick={handleToggleProjects} />
              <SidebarIconButton icon={Bot} tooltip="Agents" isActive={isAgentsPage} onClick={handleNavigateAgents} />

              <div className="w-6 border-t border-zinc-200 dark:border-zinc-700" />

              {/* Group: Knowledge */}
              <SidebarIconButton icon={Library} tooltip="知识库" isActive={isKnowledgePage} onClick={() => router.push('/flows/knowledge')} />
              <SidebarIconButton icon={BookOpen} tooltip="上下文" isActive={isContextPage} onClick={handleNavigateContext} />
              <SidebarIconButton icon={FileText} tooltip="设计文档" isActive={isDocsPage} onClick={handleNavigateDocs} />
              <SidebarIconButton icon={Blocks} tooltip="Skills" isActive={isSkillsPage} onClick={() => router.push('/flows/skills')} />
              <SidebarIconButton icon={ScrollText} tooltip="提示词管理" isActive={isPromptsPage} onClick={() => router.push('/flows/prompts')} />

              <div className="w-6 border-t border-zinc-200 dark:border-zinc-700" />

              {/* Group: Tasks & Data */}
              <SidebarIconButton icon={ListTodo} tooltip="AI 待办" isActive={isTodosPage} onClick={handleNavigateTodos} />

              <div className="w-6 border-t border-zinc-200 dark:border-zinc-700" />

              {/* Group: Automation */}
              <SidebarIconButton icon={Timer} tooltip="定时运行" isActive={isSchedulesPage} onClick={() => router.push('/flows/schedules')} />
              <SidebarIconButton icon={Satellite} tooltip="卫星任务" isActive={isSatelliteTasksPage} onClick={() => router.push('/flows/satellite-tasks')} />

              <div className="w-6 border-t border-zinc-200 dark:border-zinc-700" />

              {/* Group: Communication */}
              <SidebarIconButton icon={MessagesSquare} tooltip="Agent 对话" isActive={isDialoguesPage} onClick={() => router.push('/flows/dialogues')} />
              <SidebarIconButton icon={MessageSquare} tooltip="P2P 聊天" isActive={isChatPage} onClick={() => router.push('/flows/chat')} />
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
                              if (e.key === 'Escape') { setCreating(false); setNewName(''); setNewPath(''); }
                            }}
                            placeholder="项目名称"
                            className="w-full rounded border border-zinc-300 px-2 py-1 text-xs outline-none focus:border-zinc-500 dark:border-zinc-600 dark:bg-zinc-900 dark:focus:border-zinc-400"
                          />
                          <input
                            value={newPath}
                            onChange={e => setNewPath(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') handleCreate();
                              if (e.key === 'Escape') { setCreating(false); setNewName(''); setNewPath(''); }
                            }}
                            placeholder="项目路径 (必填)"
                            className="w-full rounded border border-zinc-300 px-2 py-1 text-xs outline-none focus:border-zinc-500 dark:border-zinc-600 dark:bg-zinc-900 dark:focus:border-zinc-400"
                          />
                          <div className="flex gap-1">
                            <button
                              onClick={handleCreate}
                              disabled={!newName.trim() || !newPath.trim()}
                              className="flex-1 rounded bg-zinc-900 px-2 py-1 text-xs text-white hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                            >
                              创建
                            </button>
                            <button
                              onClick={() => { setCreating(false); setNewName(''); setNewPath(''); }}
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

