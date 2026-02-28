'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { TopNav } from '@/components/top-nav';
import { AgentChatPanel } from '@/components/agent-chat-panel';
import { FolderKanban, Plus, Trash2, Network, GripVertical, Bot, Layers, BookOpen, ListTodo, ChevronRight } from 'lucide-react';
import { BUTLER_AGENT_ID } from '@/lib/default-agents';
import type { Agent } from '@/types';
import { useRouter, usePathname } from '@/i18n/routing';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface ProjectEntry {
  key: string;
  name: string;
  description?: string;
}

interface FlowsContextValue {
  projects: ProjectEntry[];
  activeKey: string | null;
  setActiveKey: (key: string) => void;
  fetchProjects: () => Promise<ProjectEntry[]>;
  highlightSectionId: string | null;
  setHighlightSectionId: (id: string | null) => void;
}

import { createContext, useContext } from 'react';
const FlowsContext = createContext<FlowsContextValue | null>(null);
export function useFlowsContext() {
  const ctx = useContext(FlowsContext);
  if (!ctx) throw new Error('useFlowsContext must be inside FlowsLayout');
  return ctx;
}

export default function FlowsLayout({ children }: { children: React.ReactNode }) {
  const searchParams = useSearchParams();
  const projectParam = searchParams.get('project');
  const router = useRouter();
  const pathname = usePathname();
  const [projects, setProjects] = useState<ProjectEntry[]>([]);
  const [activeKeyRaw, setActiveKeyRaw] = useState<string | null>(null);
  const internalKeyChangeRef = useRef(false);

  const setActiveKey = useCallback((key: string) => {
    internalKeyChangeRef.current = true;
    setActiveKeyRaw(key);
    // Sync to URL (replaceState doesn't update Next.js searchParams,
    // so we use internalKeyChangeRef to prevent the sync effect from resetting)
    const url = new URL(window.location.href);
    if (key) {
      url.searchParams.set('project', key);
    } else {
      url.searchParams.delete('project');
    }
    window.history.replaceState({}, '', url.toString());
  }, []);

  const activeKey = activeKeyRaw;
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
  const isTodosPage = pathname.startsWith('/flows/todos');
  const isSubRoute = isAgentsPage || isDimensionsPage || isContextPage || isRecycleBinPage || isButlerPage || isTodosPage;

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
    // Skip sync if the change was initiated internally (via setActiveKey),
    // because window.history.replaceState doesn't update useSearchParams,
    // causing projectParam to be stale and fight with the new activeKey.
    if (internalKeyChangeRef.current) {
      internalKeyChangeRef.current = false;
      return;
    }
    if (projectParam && activeKey && projectParam !== activeKey) {
      if (projects.some(p => p.key === projectParam)) {
        setActiveKey(projectParam);
      }
    }
  }, [projectParam, activeKey, projects]);

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

  const handleNavigateTodos = () => {
    router.push('/flows/todos');
  };

  const [projectDragging, setProjectDragging] = useState(false);

  const projectSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const handleProjectDragEnd = useCallback(async (event: DragEndEvent) => {
    setProjectDragging(false);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = projects.findIndex(p => p.key === active.id);
    const newIndex = projects.findIndex(p => p.key === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    // Optimistic UI update
    const reordered = [...projects];
    const [moved] = reordered.splice(oldIndex, 1);
    reordered.splice(newIndex, 0, moved);
    setProjects(reordered);

    // Persist
    try {
      await fetch('/api/data/projects', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order: reordered.map(p => p.key) }),
      });
    } catch { /* ignore */ }
  }, [projects]);

  const sectionSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const handleSectionDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id || !activeKey) return;
    const oldIndex = sections.findIndex(s => s.id === active.id);
    const newIndex = sections.findIndex(s => s.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    // Optimistic UI update
    const reordered = [...sections];
    const [moved] = reordered.splice(oldIndex, 1);
    reordered.splice(newIndex, 0, moved);
    setSections(reordered);

    // Persist: read full data, reorder sections, save
    try {
      const res = await fetch(`/api/data?project=${encodeURIComponent(activeKey)}`);
      if (!res.ok) return;
      const data = await res.json();
      const fullSections = data.sections ?? [];
      const [movedFull] = fullSections.splice(oldIndex, 1);
      fullSections.splice(newIndex, 0, movedFull);
      await fetch(`/api/data?project=${encodeURIComponent(activeKey)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data, sections: fullSections }),
      });
    } catch { /* ignore */ }
  }, [sections, activeKey]);

  const panelWidth = 'w-60';
  const panelInnerWidth = 'w-60';

  return (
    <FlowsContext.Provider value={{ projects, activeKey, setActiveKey, fetchProjects, highlightSectionId, setHighlightSectionId }}>
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
            <div className="flex w-13 flex-col items-center border-r border-zinc-200 bg-zinc-50 py-2 gap-1 dark:border-zinc-800 dark:bg-zinc-950">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    className={`flex h-11 w-11 items-center justify-center rounded-md transition-colors ${
                      !isSubRoute && panelOpen
                        ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
                        : 'text-zinc-500 hover:bg-zinc-200 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-200'
                    }`}
                    onClick={handleToggleProjects}
                  >
                    <FolderKanban className="h-5 w-5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">项目管理</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    className={`flex h-11 w-11 items-center justify-center rounded-md transition-colors ${
                      isAgentsPage
                        ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
                        : 'text-zinc-500 hover:bg-zinc-200 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-200'
                    }`}
                    onClick={handleNavigateAgents}
                  >
                    <Bot className="h-5 w-5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">Agents</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    className={`flex h-11 w-11 items-center justify-center rounded-md transition-colors ${
                      isDimensionsPage
                        ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
                        : 'text-zinc-500 hover:bg-zinc-200 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-200'
                    }`}
                    onClick={handleNavigateDimensions}
                  >
                    <Layers className="h-5 w-5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">信息角度</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    className={`flex h-11 w-11 items-center justify-center rounded-md transition-colors ${
                      isContextPage
                        ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
                        : 'text-zinc-500 hover:bg-zinc-200 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-200'
                    }`}
                    onClick={handleNavigateContext}
                  >
                    <BookOpen className="h-5 w-5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">上下文</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    className={`flex h-11 w-11 items-center justify-center rounded-md transition-colors ${
                      isTodosPage
                        ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
                        : 'text-zinc-500 hover:bg-zinc-200 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-200'
                    }`}
                    onClick={handleNavigateTodos}
                  >
                    <ListTodo className="h-5 w-5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">AI 待办</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    className={`flex h-11 w-11 items-center justify-center rounded-md transition-colors ${
                      isRecycleBinPage
                        ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
                        : 'text-zinc-500 hover:bg-zinc-200 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-200'
                    }`}
                    onClick={handleNavigateRecycleBin}
                  >
                    <Trash2 className="h-5 w-5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">回收站</TooltipContent>
              </Tooltip>
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
                      <DndContext sensors={projectSensors} collisionDetection={closestCenter} onDragStart={() => setProjectDragging(true)} onDragEnd={handleProjectDragEnd}>
                        <SortableContext items={projects.map(p => p.key)} strategy={verticalListSortingStrategy}>
                          {projects.map(p => (
                            <SortableProjectItem
                              key={p.key}
                              project={p}
                              isActive={p.key === activeKey}
                              onSelect={setActiveKey}
                              sections={p.key === activeKey ? sections : []}
                              sectionSensors={sectionSensors}
                              onSectionDragEnd={handleSectionDragEnd}
                              onHighlightSection={setHighlightSectionId}
                              hideSections={projectDragging}
                            />
                          ))}
                        </SortableContext>
                      </DndContext>
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

function SortableProjectItem({
  project,
  isActive,
  onSelect,
  sections,
  sectionSensors,
  onSectionDragEnd,
  onHighlightSection,
  hideSections,
}: {
  project: ProjectEntry;
  isActive: boolean;
  onSelect: (key: string) => void;
  sections: { id: string; name: string }[];
  sectionSensors: ReturnType<typeof useSensors>;
  onSectionDragEnd: (event: DragEndEvent) => void;
  onHighlightSection: (id: string | null) => void;
  hideSections: boolean;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: project.key });
  const yOnlyTransform = transform ? { ...transform, x: 0 } : null;
  const style = {
    transform: CSS.Transform.toString(yOnlyTransform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const hasSections = isActive && sections.length > 0;
  const expanded = hasSections && !collapsed && !hideSections;

  const handleChevronClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isActive) {
      // 非 active 项目：先选中（会自动展开）
      onSelect(project.key);
      setCollapsed(false);
    } else {
      // active 项目：切换展开/收起
      setCollapsed(prev => !prev);
    }
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      {/* Project row */}
      <div
        className={`group flex w-full items-center gap-1 rounded-md px-1.5 py-1.5 text-base cursor-pointer transition-colors ${
          isActive
            ? 'text-zinc-900 font-medium dark:text-zinc-100'
            : 'text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/50 dark:hover:text-zinc-200'
        }`}
      >
        <button
          className="shrink-0 p-0 bg-transparent border-none cursor-pointer"
          onClick={handleChevronClick}
        >
          <ChevronRight className={`h-3.5 w-3.5 text-zinc-400 transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`} />
        </button>
        <div className="flex flex-1 items-center gap-1 min-w-0" onClick={() => { onSelect(project.key); setCollapsed(false); }}>
          <FolderKanban className="h-4 w-4 shrink-0" />
          <span className="truncate">{project.name}</span>
        </div>
        <button
          className="shrink-0 cursor-grab active:cursor-grabbing text-zinc-300 hover:text-zinc-500 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={e => e.stopPropagation()}
          {...listeners}
        >
          <GripVertical className="h-3 w-3" />
        </button>
      </div>
      {/* Sections under active project */}
      {expanded && (
        <DndContext sensors={sectionSensors} collisionDetection={closestCenter} onDragEnd={onSectionDragEnd}>
          <SortableContext items={sections.map(s => s.id)} strategy={verticalListSortingStrategy}>
            {sections.map(s => (
              <SortableSectionItem key={s.id} section={s} onHighlight={onHighlightSection} />
            ))}
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}

function SortableSectionItem({
  section,
  onHighlight,
}: {
  section: { id: string; name: string };
  onHighlight: (id: string | null) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: section.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const handleClick = () => {
    onHighlight(section.id);
    window.dispatchEvent(new CustomEvent('pp:highlight-section', { detail: section.id }));
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      onClick={handleClick}
      className="group flex w-full items-center gap-1 rounded-md pl-6 pr-1 py-1.5 text-sm cursor-pointer text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900 transition-colors dark:text-zinc-400 dark:hover:bg-zinc-800/50 dark:hover:text-zinc-200"
    >
      <Network className="h-3.5 w-3.5 shrink-0" />
      <span className="flex-1 truncate">{section.name || '未命名'}</span>
      <button
        className="shrink-0 cursor-grab active:cursor-grabbing text-zinc-300 hover:text-zinc-500 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={e => e.stopPropagation()}
        {...listeners}
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
