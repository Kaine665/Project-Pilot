'use client';

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useEffect,
  useMemo,
} from 'react';
import { useTranslations } from 'next-intl';
import type {
  FlowData,
  Section,
  TreeItem,
  Status,
} from '@/types/flow';
import type { Agent } from '@/types';
import { Search, X } from 'lucide-react';
import { MillerSectionBlock as SectionBlock } from './miller-columns';
import { getEffectiveStatus } from './flow-shared';
import { ProjectSettings } from './project-settings';
import {
  genId,
  updateItemRecursive,
  deleteItemRecursive,
  addChildItem,
  deriveStatuses,
  reorderArray,
  reorderChildItems,
} from '@/lib/flow-tree-helpers';

/** Highlight target passed from URL params when navigating back from task agent */
export interface HighlightTarget {
  sectionId?: string;
  itemId?: string;
}

// --- Tree filter for search/status ---

function treeItemMatches(item: TreeItem, query: string): boolean {
  if (item.content.toLowerCase().includes(query)) return true;
  if (item.description?.toLowerCase().includes(query)) return true;
  return false;
}

function treeItemMatchesDeep(item: TreeItem, query: string, showDeferred: boolean): boolean {
  if (!showDeferred && item.deferred) return false;
  if (treeItemMatches(item, query)) return true;
  if (item.children?.length) {
    return item.children.some(c => treeItemMatchesDeep(c, query, showDeferred));
  }
  return false;
}

export function filterTreeItems(
  items: TreeItem[],
  searchText: string,
  statusFilter: Status | 'all',
  showDeferred: boolean,
): TreeItem[] {
  const query = searchText.toLowerCase().trim();
  return items.filter(item => {
    if (!showDeferred && item.deferred) return false;

    // Status filter
    if (statusFilter !== 'all') {
      const effectiveStatus = getEffectiveStatus(item, !showDeferred);
      if (effectiveStatus !== statusFilter) return false;
    }

    // Text search — keep parent if any descendant matches
    if (query) {
      return treeItemMatchesDeep(item, query, showDeferred);
    }

    return true;
  }).map(item => {
    // Recursively filter children
    if (item.children?.length) {
      const filteredChildren = filterTreeItems(item.children, searchText, statusFilter, showDeferred);
      return { ...item, children: filteredChildren };
    }
    return item;
  });
}

// --- Actions interface ---

export interface FlowActions {
  addSection: (name?: string) => void;
  updateSection: (sectionId: string, patch: Partial<Pick<Section, 'name' | 'description'>>) => void;
  deleteSection: (sectionId: string) => void;
  addItem: (sectionId: string, content: string, parentItemId?: string) => void;
  updateItem: (sectionId: string, itemId: string, patch: Partial<Pick<TreeItem, 'content' | 'status' | 'description' | 'deferred' | 'context' | 'agentId'>>) => void;
  deleteItem: (sectionId: string, itemId: string) => void;
  setCycleDeadline: (date: string | undefined) => void;
  reorderItems: (sectionId: string, parentItemId: string | null, oldIndex: number, newIndex: number) => void;
  reorderSections: (oldIndex: number, newIndex: number) => void;
}

export type AIStatusMap = Record<string, 'running' | 'waiting' | 'confirm'>;

interface FlowContextValue {
  projectKey: string;
  projectName: string;
  data: FlowData;
  actions: FlowActions;
  agents: Agent[];
  showDeferred: boolean;
  toggleShowDeferred: () => void;
  highlightTarget: HighlightTarget | null;
  clearHighlight: () => void;
  aiStatusMap: AIStatusMap;
  batchMode: boolean;
  selectedItems: Set<string>;
  toggleBatchMode: () => void;
  toggleItemSelection: (itemId: string) => void;
  clearSelection: () => void;
  batchDelete: (sectionId: string) => void;
  batchDefer: (sectionId: string, deferred: boolean) => void;
  batchUpdateStatus: (sectionId: string, status: Status) => void;
  searchText: string;
  setSearchText: (text: string) => void;
  statusFilter: Status | 'all';
  setStatusFilter: (filter: Status | 'all') => void;
}

const FlowDataContext = createContext<FlowContextValue | null>(null);

export function useFlowData() {
  const ctx = useContext(FlowDataContext);
  if (!ctx) throw new Error('useFlowData must be inside FlowEditor');
  return ctx;
}

// --- Cycle Deadline ---

function CycleDeadline({
  deadline,
  onChange,
}: {
  deadline?: string;
  onChange: (d: string | undefined) => void;
}) {
  const t = useTranslations();
  const [editing, setEditing] = useState(false);

  if (!deadline && !editing) {
    return (
      <button
        className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => setEditing(true)}
      >
        + {t('flows.setDeadline')}
      </button>
    );
  }

  if (editing) {
    return (
      <input
        type="date"
        autoFocus
        className="text-xs border border-border rounded px-2 py-1 outline-none focus:ring-1 focus:ring-ring"
        defaultValue={deadline || ''}
        onBlur={e => {
          const v = e.target.value;
          if (v) onChange(v);
          setEditing(false);
        }}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            const v = (e.target as HTMLInputElement).value;
            if (v) onChange(v);
            setEditing(false);
          }
          if (e.key === 'Escape') setEditing(false);
        }}
      />
    );
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(deadline + 'T00:00:00');
  const diffMs = target.getTime() - today.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  const color =
    diffDays < 0
      ? 'text-red-500'
      : diffDays <= 7
      ? 'text-amber-600'
      : 'text-emerald-600';

  const label =
    diffDays < 0
      ? t('flows.overdueByDays', { days: -diffDays })
      : diffDays === 0
      ? t('flows.dueToday')
      : t('flows.daysRemaining', { days: diffDays });

  return (
    <div className="flex items-center gap-2">
      <button
        className={`text-xs ${color} hover:opacity-70 transition-opacity`}
        onClick={() => setEditing(true)}
        title="点击修改截止日期"
      >
        {deadline} ({label})
      </button>
      <button
        className="text-xs text-muted-foreground hover:text-red-500 transition-colors"
        onClick={() => onChange(undefined)}
        title={t('flows.clearDeadline')}
      >
        ×
      </button>
    </div>
  );
}

// --- FlowEditor ---

interface FlowEditorProps {
  projectKey: string;
  projectName: string;
  projectDescription?: string;
  initialHighlight?: HighlightTarget | null;
  onProjectUpdated?: () => void;
  onProjectDeleted?: () => void;
}

const EMPTY_DATA: FlowData = { sections: [] };

export function FlowEditor({ projectKey, projectName, projectDescription, initialHighlight, onProjectUpdated, onProjectDeleted }: FlowEditorProps) {
  const t = useTranslations();
  const [data, setData] = useState<FlowData>(EMPTY_DATA);
  const [loading, setLoading] = useState(true);
  const [showDeferred, setShowDeferred] = useState(true);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [aiStatusMap, setAiStatusMap] = useState<AIStatusMap>({});
  const [batchMode, setBatchMode] = useState(false);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [searchText, setSearchText] = useState('');
  const [statusFilter, setStatusFilter] = useState<Status | 'all'>('all');
  const [agents, setAgents] = useState<Agent[]>([]);

  useEffect(() => {
    fetch('/api/agents')
      .then(r => r.ok ? r.json() : { agents: [] })
      .then(({ agents }: { agents: Agent[] }) => setAgents(agents))
      .catch(() => {});
  }, []);

  const [highlightTarget, setHighlightTarget] = useState<HighlightTarget | null>(
    initialHighlight ?? null,
  );

  useEffect(() => {
    setHighlightTarget(initialHighlight ?? null);
  }, [initialHighlight]);

  // Listen for sidebar branch click via CustomEvent (avoids useEffect timing race)
  useEffect(() => {
    const handler = (e: Event) => {
      const sectionId = (e as CustomEvent).detail;
      if (sectionId) setHighlightTarget({ sectionId });
    };
    window.addEventListener('pp:highlight-section', handler);
    return () => window.removeEventListener('pp:highlight-section', handler);
  }, []);

  const clearHighlight = useCallback(() => {
    setHighlightTarget(null);
  }, []);

  useEffect(() => {
    if (!highlightTarget) return;
    const handler = (e: MouseEvent) => {
      // Don't clear if clicking inside the sidebar
      if ((e.target as HTMLElement)?.closest('[data-sidebar]')) return;
      setHighlightTarget(null);
    };
    // Delay adding listener so the triggering click doesn't immediately clear
    const timer = setTimeout(() => {
      window.addEventListener('click', handler);
    }, 300);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('click', handler);
    };
  }, [highlightTarget]);

  const isSaving = useRef(false);

  // Load data
  useEffect(() => {
    setLoading(true);
    fetch(`/api/data?project=${projectKey}`)
      .then(res => res.ok ? res.json() : EMPTY_DATA)
      .then(d => setData({ ...EMPTY_DATA, ...d }))
      .catch(() => setData(EMPTY_DATA))
      .finally(() => setLoading(false));
  }, [projectKey]);

  // Fetch AI status
  useEffect(() => {
    const fetchAIStatus = () => {
      fetch('/api/tasks')
        .then(res => res.ok ? res.json() : { tasks: [] })
        .then(({ tasks }: { tasks: Array<{ flowContext?: { flowTaskId: string }; aiStatus?: 'running' | 'waiting' | 'confirm' | null }> }) => {
          const map: AIStatusMap = {};
          for (const t of tasks) {
            if (t.flowContext?.flowTaskId && t.aiStatus) {
              map[t.flowContext.flowTaskId] = t.aiStatus;
            }
          }
          setAiStatusMap(map);
        })
        .catch(() => {});
    };
    fetchAIStatus();
    const timer = setInterval(fetchAIStatus, 5000);
    return () => clearInterval(timer);
  }, []);

  const persist = useCallback((newData: FlowData) => {
    setData(newData);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      isSaving.current = true;
      fetch(`/api/data?project=${projectKey}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newData),
      }).finally(() => {
        setTimeout(() => { isSaving.current = false; }, 300);
      });
    }, 500);
  }, [projectKey]);

  // SSE
  useEffect(() => {
    const es = new EventSource(`/api/data/stream?project=${projectKey}`);
    es.onmessage = (event) => {
      if (isSaving.current) return;
      try {
        const newData: FlowData = JSON.parse(event.data);
        setData(newData);
      } catch {
        // ignore
      }
    };
    return () => es.close();
  }, [projectKey]);

  // --- Actions ---

  const actions: FlowActions = {
    addSection: (name) => {
      persist({
        ...data,
        sections: [
          { id: genId(), name: name ?? t('flows.newSection'), items: [] },
          ...data.sections,
        ],
      });
    },
    updateSection: (sectionId, patch) => {
      persist({
        ...data,
        sections: data.sections.map(s =>
          s.id === sectionId ? { ...s, ...patch } : s,
        ),
      });
    },
    deleteSection: (sectionId) => {
      persist({
        ...data,
        sections: data.sections.filter(s => s.id !== sectionId),
      });
    },
    addItem: (sectionId, content, parentItemId?) => {
      const newItem: TreeItem = {
        id: genId(),
        content,
        status: 'todo' as Status,
      };
      persist({
        ...data,
        sections: data.sections.map(s => {
          if (s.id !== sectionId) return s;
          const raw = parentItemId
            ? addChildItem(s.items, parentItemId, newItem)
            : [...s.items, newItem];
          return { ...s, items: deriveStatuses(raw) };
        }),
      });
    },
    updateItem: (sectionId, itemId, patch) => {
      persist({
        ...data,
        sections: data.sections.map(s => {
          if (s.id !== sectionId) return s;
          const items = deriveStatuses(updateItemRecursive(s.items, itemId, patch));
          return { ...s, items };
        }),
      });
    },
    deleteItem: (sectionId, itemId) => {
      persist({
        ...data,
        sections: data.sections.map(s => {
          if (s.id !== sectionId) return s;
          const items = deriveStatuses(deleteItemRecursive(s.items, itemId));
          return { ...s, items };
        }),
      });
    },
    setCycleDeadline: date => {
      persist({ ...data, cycleDeadline: date });
    },
    reorderItems: (sectionId, parentItemId, oldIndex, newIndex) => {
      persist({
        ...data,
        sections: data.sections.map(s => {
          if (s.id !== sectionId) return s;
          if (parentItemId === null) {
            return { ...s, items: reorderArray(s.items, oldIndex, newIndex) };
          }
          return { ...s, items: reorderChildItems(s.items, parentItemId, oldIndex, newIndex) };
        }),
      });
    },
    reorderSections: (oldIndex, newIndex) => {
      persist({ ...data, sections: reorderArray(data.sections, oldIndex, newIndex) });
    },
  };

  // --- Batch Operations ---

  const toggleBatchMode = useCallback(() => {
    setBatchMode(v => !v);
    setSelectedItems(new Set());
  }, []);

  const toggleItemSelection = useCallback((itemId: string) => {
    setSelectedItems(prev => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedItems(new Set());
  }, []);

  const batchDelete = useCallback((sectionId: string) => {
    if (selectedItems.size === 0) return;
    if (!confirm(t('flows.confirmBatchDelete', { count: selectedItems.size }))) return;

    persist({
      ...data,
      sections: data.sections.map(s => {
        if (s.id !== sectionId) return s;
        let items = s.items;
        for (const itemId of selectedItems) {
          items = deleteItemRecursive(items, itemId);
        }
        return { ...s, items: deriveStatuses(items) };
      }),
    });
    clearSelection();
  }, [selectedItems, data, persist, clearSelection, t]);

  const batchDefer = useCallback((sectionId: string, deferred: boolean) => {
    if (selectedItems.size === 0) return;

    persist({
      ...data,
      sections: data.sections.map(s => {
        if (s.id !== sectionId) return s;
        let items = s.items;
        for (const itemId of selectedItems) {
          items = updateItemRecursive(items, itemId, { deferred });
        }
        return { ...s, items: deriveStatuses(items) };
      }),
    });
    clearSelection();
  }, [selectedItems, data, persist, clearSelection]);

  const batchUpdateStatus = useCallback((sectionId: string, status: Status) => {
    if (selectedItems.size === 0) return;

    persist({
      ...data,
      sections: data.sections.map(s => {
        if (s.id !== sectionId) return s;
        let items = s.items;
        for (const itemId of selectedItems) {
          items = updateItemRecursive(items, itemId, { status });
        }
        return { ...s, items: deriveStatuses(items) };
      }),
    });
    clearSelection();
  }, [selectedItems, data, persist, clearSelection]);

  // --- Stats ---

  const filterDeferred = !showDeferred;
  const stats = data.sections.reduce(
    (acc, section) => {
      for (const item of section.items) {
        const visible = filterDeferred ? !item.deferred : true;
        if (!visible) continue;
        acc.total++;
        const s = getEffectiveStatus(item, filterDeferred);
        if (s === 'done') acc.done++;
        else if (s === 'doing') acc.doing++;
        else acc.todo++;
      }
      return acc;
    },
    { total: 0, done: 0, doing: 0, todo: 0 },
  );

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        {t('tasks.loading')}
      </div>
    );
  }

  return (
    <FlowDataContext.Provider
      value={{
        projectKey,
        projectName,
        data,
        actions,
        agents,
        showDeferred,
        toggleShowDeferred: () => setShowDeferred(v => !v),
        highlightTarget,
        clearHighlight,
        aiStatusMap,
        batchMode,
        selectedItems,
        toggleBatchMode,
        toggleItemSelection,
        clearSelection,
        batchDelete,
        batchDefer,
        batchUpdateStatus,
        searchText,
        setSearchText,
        statusFilter,
        setStatusFilter,
      }}
    >
      <div className="min-h-screen bg-background">
        <div className="max-w-7xl mx-auto px-8 py-12">
          {/* Header */}
          <header className="mb-10">
            <div className="flex items-center gap-2">
              <h1 className="text-3xl font-bold tracking-tight">
                {projectName}
              </h1>
              <ProjectSettings
                projectKey={projectKey}
                projectName={projectName}
                projectDescription={projectDescription}
                onUpdated={onProjectUpdated ?? (() => {})}
                onDeleted={onProjectDeleted ?? (() => {})}
              />
            </div>

            <div className="flex items-center gap-6 mt-5">
              <div className="flex items-center gap-1.5">
                <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500" />
                <span className="text-sm text-muted-foreground">
                  {t('flows.completed', { count: stats.done })}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-500" />
                <span className="text-sm text-muted-foreground">
                  {t('flows.inProgress', { count: stats.doing })}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="inline-block w-2.5 h-2.5 rounded-full bg-zinc-300" />
                <span className="text-sm text-muted-foreground">
                  {t('flows.planned', { count: stats.todo })}
                </span>
              </div>

              {/* Search & filter */}
              <div className="flex items-center gap-2 ml-4">
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                  <input
                    type="text"
                    placeholder={t('flows.searchPlaceholder')}
                    value={searchText}
                    onChange={e => setSearchText(e.target.value)}
                    className="text-xs border border-border rounded-full pl-7 pr-7 py-1 w-44 outline-none focus:ring-1 focus:ring-ring bg-background"
                  />
                  {searchText && (
                    <button
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      onClick={() => setSearchText('')}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
                <select
                  value={statusFilter}
                  onChange={e => setStatusFilter(e.target.value as Status | 'all')}
                  className="text-xs border border-border rounded-full px-2.5 py-1 outline-none bg-background text-muted-foreground"
                >
                  <option value="all">{t('flows.statusFilter.all')}</option>
                  <option value="todo">{t('status.todo')}</option>
                  <option value="doing">{t('status.doing')}</option>
                  <option value="done">{t('status.done')}</option>
                </select>
              </div>

              <div className="ml-auto flex items-center gap-3">
                <CycleDeadline
                  deadline={data.cycleDeadline}
                  onChange={d => actions.setCycleDeadline(d)}
                />
                <button
                  className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                    showDeferred
                      ? 'border-border text-muted-foreground hover:text-foreground'
                      : 'border-blue-300 bg-blue-50 text-blue-600'
                  }`}
                  onClick={() => setShowDeferred(v => !v)}
                >
                  {showDeferred ? t('flows.showAll') : t('flows.onlyThisCycle')}
                </button>
                <button
                  className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                    batchMode
                      ? 'border-purple-300 bg-purple-50 text-purple-600 dark:bg-purple-950/30'
                      : 'border-border text-muted-foreground hover:text-foreground hover:border-foreground/30'
                  }`}
                  onClick={toggleBatchMode}
                >
                  {batchMode ? t('flows.exitBatchMode') : t('flows.batchMode')}
                  {batchMode && selectedItems.size > 0 && ` (${selectedItems.size})`}
                </button>
                <button
                  className="text-xs px-3 py-1 rounded-full border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
                  onClick={() => {
                    const section = data.sections[0];
                    if (section) actions.addItem(section.id, t('flows.newItem'));
                  }}
                >
                  + {t('flows.addTopItem')}
                </button>
              </div>
            </div>
          </header>

          {/* Sections */}
          {data.sections.map(section => (
            <SectionBlock key={section.id} section={section} />
          ))}

        </div>
      </div>
    </FlowDataContext.Provider>
  );
}

