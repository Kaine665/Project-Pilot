'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { TopNav } from '@/components/top-nav';
import { PlannerChatPanel } from '@/components/planner-chat-panel';
import { FolderKanban, Plus, Sparkles } from 'lucide-react';

interface ProjectEntry {
  key: string;
  name: string;
}

interface FlowsContextValue {
  projects: ProjectEntry[];
  activeKey: string | null;
  setActiveKey: (key: string) => void;
  fetchProjects: () => Promise<ProjectEntry[]>;
}

import { createContext, useContext } from 'react';
const FlowsContext = createContext<FlowsContextValue | null>(null);
export function useFlowsContext() {
  const ctx = useContext(FlowsContext);
  if (!ctx) throw new Error('useFlowsContext must be inside FlowsLayout');
  return ctx;
}

type SidebarMode = 'projects' | 'planner';

export default function FlowsLayout({ children }: { children: React.ReactNode }) {
  const searchParams = useSearchParams();
  const projectParam = searchParams.get('project');
  const [projects, setProjects] = useState<ProjectEntry[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>('projects');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const sidebarRef = useRef<HTMLDivElement>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchProjects = useCallback(async () => {
    try {
      const res = await fetch('/api/data/projects');
      const data = await res.json();
      const list = data.projects ?? [];
      setProjects(list);
      return list;
    } catch {
      return [];
    }
  }, []);

  useEffect(() => {
    fetchProjects().then((list: ProjectEntry[]) => {
      if (list.length > 0 && !activeKey) {
        if (projectParam && list.some((p: ProjectEntry) => p.key === projectParam)) {
          setActiveKey(projectParam);
        } else {
          setActiveKey(list[0].key);
        }
      }
    });
  }, [fetchProjects, activeKey, projectParam]);

  useEffect(() => {
    if (projectParam && activeKey && projectParam !== activeKey) {
      if (projects.some(p => p.key === projectParam)) {
        setActiveKey(projectParam);
      }
    }
  }, [projectParam, activeKey, projects]);

  const handleMouseEnter = () => {
    // Don't auto-open on hover when in planner mode (it's pinned)
    if (sidebarMode === 'planner') return;
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setPanelOpen(true), 150);
  };

  const handleMouseLeave = () => {
    // Don't auto-close when in planner mode (it's pinned)
    if (sidebarMode === 'planner') return;
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => {
      setPanelOpen(false);
      setCreating(false);
      setNewName('');
    }, 200);
  };

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

  const handleTogglePlanner = () => {
    if (sidebarMode === 'planner') {
      // Switch back to projects mode
      setSidebarMode('projects');
      setPanelOpen(false);
    } else {
      // Switch to planner mode
      setSidebarMode('planner');
      setPanelOpen(true);
    }
  };

  const handleToggleProjects = () => {
    if (sidebarMode === 'planner') {
      // Switch from planner to projects
      setSidebarMode('projects');
      setPanelOpen(true);
    } else {
      // Toggle projects panel
      setPanelOpen(v => !v);
    }
  };

  // Panel width depends on mode
  const panelWidth = sidebarMode === 'planner' ? 'w-[360px]' : 'w-52';
  const panelInnerWidth = sidebarMode === 'planner' ? 'w-[360px]' : 'w-52';

  return (
    <FlowsContext.Provider value={{ projects, activeKey, setActiveKey, fetchProjects }}>
      <div className="flex h-screen flex-col overflow-hidden">
        <TopNav />
        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar: icon strip + expandable panel */}
          <div
            ref={sidebarRef}
            className="flex shrink-0 h-full"
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
          >
            {/* Icon strip — always visible */}
            <div className="flex w-10 flex-col items-center border-r border-zinc-200 bg-zinc-50 py-2 gap-1 dark:border-zinc-800 dark:bg-zinc-950">
              <button
                className={`flex h-8 w-8 items-center justify-center rounded-md transition-colors ${
                  sidebarMode === 'planner'
                    ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400'
                    : 'text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-300'
                }`}
                title="AI 规划助手"
                onClick={handleTogglePlanner}
              >
                <Sparkles className="h-4 w-4" />
              </button>
              <button
                className={`flex h-8 w-8 items-center justify-center rounded-md transition-colors ${
                  sidebarMode === 'projects' && panelOpen
                    ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
                    : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-300'
                }`}
                title="项目管理"
                onClick={handleToggleProjects}
              >
                <FolderKanban className="h-4 w-4" />
              </button>
            </div>

            {/* Expandable panel */}
            <div
              className={`overflow-hidden border-r border-zinc-200 bg-white transition-[width] duration-200 ease-in-out dark:border-zinc-800 dark:bg-zinc-950 ${
                panelOpen ? panelWidth : 'w-0 border-r-0'
              }`}
            >
              <div className={`flex h-full ${panelInnerWidth} flex-col`}>
                {sidebarMode === 'planner' ? (
                  /* AI Planner Panel */
                  <PlannerChatPanel projectKey={activeKey} />
                ) : (
                  /* Projects Panel */
                  <>
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

                    <div className="px-3 pt-2 pb-1">
                      <span className="text-xs font-medium uppercase tracking-wider text-zinc-400">
                        项目列表
                      </span>
                    </div>

                    {/* Project list */}
                    <div className="flex-1 overflow-y-auto px-1.5">
                      {projects.map(p => (
                        <button
                          key={p.key}
                          onClick={() => setActiveKey(p.key)}
                          className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors ${
                            p.key === activeKey
                              ? 'bg-zinc-100 text-zinc-900 font-medium dark:bg-zinc-800 dark:text-zinc-100'
                              : 'text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/50 dark:hover:text-zinc-200'
                          }`}
                        >
                          <FolderKanban className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate">{p.name}</span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Main content */}
          <main className="flex-1 overflow-auto">{children}</main>
        </div>
      </div>
    </FlowsContext.Provider>
  );
}
