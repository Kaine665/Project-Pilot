'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { TopNav } from '@/components/top-nav';
import { PlannerChatPanel } from '@/components/planner-chat-panel';
import { FolderKanban, Plus, Pencil, Trash2, Network, GripVertical, Bot } from 'lucide-react';
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

type SidebarMode = 'projects' | 'branches' | 'agents' | 'recycle-bin';

interface AgentEntry {
  id: string;
  name: string;
  description?: string;
}

export default function FlowsLayout({ children }: { children: React.ReactNode }) {
  const searchParams = useSearchParams();
  const projectParam = searchParams.get('project');
  const [projects, setProjects] = useState<ProjectEntry[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>('projects');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [renamingKey, setRenamingKey] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [sections, setSections] = useState<{ id: string; name: string }[]>([]);
  const [highlightSectionId, setHighlightSectionId] = useState<string | null>(null);
  const [agents, setAgents] = useState<AgentEntry[]>([]);
  const [creatingAgent, setCreatingAgent] = useState(false);
  const [newAgentName, setNewAgentName] = useState('');
  const [renamingAgentId, setRenamingAgentId] = useState<string | null>(null);
  const [renameAgentValue, setRenameAgentValue] = useState('');
  const [plannerOpen, setPlannerOpen] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);

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

  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch('/api/agents');
      const data = await res.json();
      setAgents(data.agents ?? []);
    } catch {
      setAgents([]);
    }
  }, []);

  useEffect(() => { fetchAgents(); }, [fetchAgents]);

  const handleCreateAgent = async () => {
    const name = newAgentName.trim();
    if (!name) return;
    try {
      const res = await fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        await fetchAgents();
        setNewAgentName('');
        setCreatingAgent(false);
      }
    } catch { /* ignore */ }
  };

  const handleRenameAgent = async (id: string) => {
    const name = renameAgentValue.trim();
    if (!name) { setRenamingAgentId(null); return; }
    try {
      const res = await fetch('/api/agents', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, name }),
      });
      if (res.ok) await fetchAgents();
    } catch { /* ignore */ }
    setRenamingAgentId(null);
  };

  const handleDeleteAgent = async (id: string) => {
    const agent = agents.find(a => a.id === id);
    if (!confirm(`确定要删除 Agent「${agent?.name ?? id}」吗？`)) return;
    try {
      const res = await fetch('/api/agents', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (res.ok) await fetchAgents();
    } catch { /* ignore */ }
  };

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

  useEffect(() => {
    if (activeKey) fetchSections(activeKey);
    else setSections([]);
  }, [activeKey, fetchSections]);

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

  const handleRename = async (key: string) => {
    const name = renameValue.trim();
    if (!name) { setRenamingKey(null); return; }
    try {
      const res = await fetch('/api/data/projects', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, name }),
      });
      if (res.ok) await fetchProjects();
    } catch { /* ignore */ }
    setRenamingKey(null);
  };

  const handleDelete = async (key: string) => {
    const project = projects.find(p => p.key === key);
    if (!confirm(`确定要删除项目「${project?.name ?? key}」吗？流程数据也会被删除。`)) return;
    try {
      const res = await fetch('/api/data/projects', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key }),
      });
      if (res.ok) {
        const list = await fetchProjects();
        if (activeKey === key) {
          setActiveKey(list.length > 0 ? list[0].key : null);
        }
      }
    } catch { /* ignore */ }
  };

  const handleToggleProjects = () => {
    if (sidebarMode !== 'projects') {
      setSidebarMode('projects');
      setPanelOpen(true);
    } else {
      setPanelOpen(v => !v);
    }
  };

  const handleToggleBranches = () => {
    if (sidebarMode !== 'branches') {
      setSidebarMode('branches');
      setPanelOpen(true);
    } else {
      setPanelOpen(v => !v);
    }
  };

  const handleToggleAgents = () => {
    if (sidebarMode !== 'agents') {
      setSidebarMode('agents');
      setPanelOpen(true);
    } else {
      setPanelOpen(v => !v);
    }
  };

  const handleToggleRecycleBin = () => {
    if (sidebarMode !== 'recycle-bin') {
      setSidebarMode('recycle-bin');
      setPanelOpen(true);
    } else {
      setPanelOpen(v => !v);
    }
  };

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

  const panelWidth = 'w-52';
  const panelInnerWidth = 'w-52';

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
            <div className="flex w-13 flex-col items-center border-r border-zinc-200 bg-zinc-50 py-2 gap-1 dark:border-zinc-800 dark:bg-zinc-950">
              <button
                className={`flex h-11 w-11 items-center justify-center rounded-md transition-colors ${
                  sidebarMode === 'projects' && panelOpen
                    ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
                    : 'text-zinc-500 hover:bg-zinc-200 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-200'
                }`}
                title="项目管理"
                onClick={handleToggleProjects}
              >
                <FolderKanban className="h-5 w-5" />
              </button>
              <button
                className={`flex h-11 w-11 items-center justify-center rounded-md transition-colors ${
                  sidebarMode === 'branches' && panelOpen
                    ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
                    : 'text-zinc-500 hover:bg-zinc-200 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-200'
                }`}
                title="一级分支"
                onClick={handleToggleBranches}
              >
                <Network className="h-5 w-5" />
              </button>
              <button
                className={`flex h-11 w-11 items-center justify-center rounded-md transition-colors ${
                  sidebarMode === 'agents' && panelOpen
                    ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
                    : 'text-zinc-500 hover:bg-zinc-200 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-200'
                }`}
                title="Agents"
                onClick={handleToggleAgents}
              >
                <Bot className="h-5 w-5" />
              </button>
              <button
                className={`flex h-11 w-11 items-center justify-center rounded-md transition-colors ${
                  sidebarMode === 'recycle-bin' && panelOpen
                    ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
                    : 'text-zinc-500 hover:bg-zinc-200 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-200'
                }`}
                title="回收站"
                onClick={handleToggleRecycleBin}
              >
                <Trash2 className="h-5 w-5" />
              </button>
            </div>

            {/* Expandable panel */}
            <div
              className={`overflow-hidden border-r border-zinc-200 bg-white transition-[width] duration-200 ease-in-out dark:border-zinc-800 dark:bg-zinc-950 ${
                panelOpen ? panelWidth : 'w-0 border-r-0'
              }`}
            >
              <div className={`flex h-full ${panelInnerWidth} flex-col`}>
                {sidebarMode === 'agents' ? (
                  /* Agents Panel */
                  <>
                    <div className="border-b border-zinc-100 p-2 dark:border-zinc-800">
                      {creatingAgent ? (
                        <div className="space-y-1.5">
                          <input
                            autoFocus
                            value={newAgentName}
                            onChange={e => setNewAgentName(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') handleCreateAgent();
                              if (e.key === 'Escape') { setCreatingAgent(false); setNewAgentName(''); }
                            }}
                            placeholder="Agent 名称"
                            className="w-full rounded border border-zinc-300 px-2 py-1 text-xs outline-none focus:border-zinc-500 dark:border-zinc-600 dark:bg-zinc-900 dark:focus:border-zinc-400"
                          />
                          <div className="flex gap-1">
                            <button
                              onClick={handleCreateAgent}
                              className="flex-1 rounded bg-zinc-900 px-2 py-1 text-xs text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                            >
                              创建
                            </button>
                            <button
                              onClick={() => { setCreatingAgent(false); setNewAgentName(''); }}
                              className="px-2 py-1 text-xs text-zinc-400 hover:text-zinc-600"
                            >
                              取消
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          onClick={() => setCreatingAgent(true)}
                          className="flex w-full items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-zinc-400 hover:bg-zinc-50 hover:text-zinc-600 transition-colors dark:hover:bg-zinc-800/50 dark:hover:text-zinc-300"
                        >
                          <Plus className="h-3 w-3" />
                          新建 Agent
                        </button>
                      )}
                    </div>

                    <div className="px-3 pt-2 pb-1">
                      <span className="text-xs font-medium uppercase tracking-wider text-zinc-400">
                        Agents
                      </span>
                    </div>

                    <div className="flex-1 overflow-y-auto px-1.5">
                      {agents.length === 0 ? (
                        <div className="px-2.5 py-3 text-xs text-zinc-400">
                          暂无 Agent
                        </div>
                      ) : (
                        agents.map(a => (
                          <div
                            key={a.id}
                            className="group flex w-full items-center rounded-md px-2.5 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 transition-colors dark:text-zinc-400 dark:hover:bg-zinc-800/50 dark:hover:text-zinc-200"
                          >
                            {renamingAgentId === a.id ? (
                              <input
                                autoFocus
                                value={renameAgentValue}
                                onChange={e => setRenameAgentValue(e.target.value)}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') handleRenameAgent(a.id);
                                  if (e.key === 'Escape') setRenamingAgentId(null);
                                }}
                                onBlur={() => handleRenameAgent(a.id)}
                                className="w-full rounded border border-zinc-300 px-1.5 py-0.5 text-xs outline-none focus:border-zinc-500 dark:border-zinc-600 dark:bg-zinc-900 dark:focus:border-zinc-400"
                              />
                            ) : (
                              <>
                                <button
                                  className="flex flex-1 items-center gap-2 min-w-0"
                                  onDoubleClick={() => { setRenamingAgentId(a.id); setRenameAgentValue(a.name); }}
                                >
                                  <Bot className="h-3.5 w-3.5 shrink-0" />
                                  <span className="truncate">{a.name}</span>
                                </button>
                                <div className="flex shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button
                                    onClick={e => { e.stopPropagation(); setRenamingAgentId(a.id); setRenameAgentValue(a.name); }}
                                    className="rounded p-0.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                                    title="重命名"
                                  >
                                    <Pencil className="h-3 w-3" />
                                  </button>
                                  <button
                                    onClick={e => { e.stopPropagation(); handleDeleteAgent(a.id); }}
                                    className="rounded p-0.5 text-zinc-400 hover:text-red-500"
                                    title="删除"
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </>
                ) : sidebarMode === 'recycle-bin' ? (
                  /* Recycle Bin Panel — placeholder */
                  <div className="flex h-full items-center justify-center">
                    <span className="text-xs text-zinc-300 dark:text-zinc-600">回收站</span>
                  </div>
                ) : sidebarMode === 'branches' ? (
                  /* Branches Panel */
                  <>
                    <div className="px-3 pt-2 pb-1">
                      <span className="text-xs font-medium uppercase tracking-wider text-zinc-400">
                        一级分支
                      </span>
                    </div>
                    <div className="flex-1 overflow-y-auto px-1.5">
                      {sections.length === 0 ? (
                        <div className="px-2.5 py-3 text-xs text-zinc-400">
                          暂无分支
                        </div>
                      ) : (
                        <DndContext sensors={sectionSensors} collisionDetection={closestCenter} onDragEnd={handleSectionDragEnd}>
                          <SortableContext items={sections.map(s => s.id)} strategy={verticalListSortingStrategy}>
                            {sections.map(s => (
                              <SortableSectionItem key={s.id} section={s} onHighlight={setHighlightSectionId} />
                            ))}
                          </SortableContext>
                        </DndContext>
                      )}
                    </div>
                  </>
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
                        <div
                          key={p.key}
                          onClick={() => { if (renamingKey !== p.key) setActiveKey(p.key); }}
                          onDoubleClick={() => { setRenamingKey(p.key); setRenameValue(p.name); }}
                          className={`group flex w-full items-center rounded-md px-2.5 py-2 text-sm cursor-pointer transition-colors ${
                            p.key === activeKey
                              ? 'bg-zinc-100 text-zinc-900 font-medium dark:bg-zinc-800 dark:text-zinc-100'
                              : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/50 dark:hover:text-zinc-200'
                          }`}
                        >
                          {renamingKey === p.key ? (
                            <input
                              autoFocus
                              value={renameValue}
                              onChange={e => setRenameValue(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter') handleRename(p.key);
                                if (e.key === 'Escape') setRenamingKey(null);
                              }}
                              onBlur={() => handleRename(p.key)}
                              onClick={e => e.stopPropagation()}
                              className="w-full rounded border border-zinc-300 px-1.5 py-0.5 text-xs outline-none focus:border-zinc-500 dark:border-zinc-600 dark:bg-zinc-900 dark:focus:border-zinc-400"
                            />
                          ) : (
                            <>
                              <div className="flex flex-1 items-center gap-2 min-w-0">
                                <FolderKanban className="h-3.5 w-3.5 shrink-0" />
                                <span className="truncate">{p.name}</span>
                              </div>
                              <div className="flex shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                  onClick={e => { e.stopPropagation(); setRenamingKey(p.key); setRenameValue(p.name); }}
                                  className="rounded p-0.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                                  title="重命名"
                                >
                                  <Pencil className="h-3 w-3" />
                                </button>
                                <button
                                  onClick={e => { e.stopPropagation(); handleDelete(p.key); }}
                                  className="rounded p-0.5 text-zinc-400 hover:text-red-500"
                                  title="删除"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Main content */}
          <main className="flex-1 overflow-auto">{children}</main>

          {/* Right-side AI Planner panel */}
          <div
            style={{ width: plannerOpen ? 360 : 0 }}
            className={`shrink-0 overflow-hidden bg-white transition-[width] duration-200 ease-in-out dark:bg-zinc-950 ${
              plannerOpen ? 'border-l border-zinc-200 dark:border-zinc-800' : ''
            }`}
          >
            <div className="flex h-full w-[360px] flex-col">
              <PlannerChatPanel projectKey={activeKey} />
            </div>
          </div>
        </div>
      </div>
    </FlowsContext.Provider>
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
      className="group flex w-full items-center gap-1 rounded-md px-1 py-1.5 text-sm cursor-pointer text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 transition-colors dark:text-zinc-400 dark:hover:bg-zinc-800/50 dark:hover:text-zinc-200"
    >
      <Network className="h-3.5 w-3.5 shrink-0" />
      <span className="flex-1 truncate">{section.name}</span>
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
