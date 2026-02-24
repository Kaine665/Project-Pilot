'use client';

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useEffect,
} from 'react';
import { useTranslations } from 'next-intl';
import type {
  FlowData,
  Section,
  TreeItem,
  Status,
} from '@/types/flow';
import { MillerSectionBlock as SectionBlock } from './miller-columns';
import { getEffectiveStatus } from './flow-shared';

/** Highlight target passed from URL params when navigating back from task agent */
export interface HighlightTarget {
  sectionId?: string;
  itemId?: string;
}

const genId = () => Math.random().toString(36).slice(2, 8);

// --- Recursive tree helpers ---

function updateItemRecursive(
  items: TreeItem[],
  itemId: string,
  patch: Partial<Pick<TreeItem, 'content' | 'status' | 'description' | 'deferred'>>,
): TreeItem[] {
  return items.map(item => {
    if (item.id === itemId) return { ...item, ...patch };
    if (item.children?.length) {
      return { ...item, children: updateItemRecursive(item.children, itemId, patch) };
    }
    return item;
  });
}

function deleteItemRecursive(items: TreeItem[], itemId: string): TreeItem[] {
  return items
    .filter(item => item.id !== itemId)
    .map(item =>
      item.children?.length
        ? { ...item, children: deleteItemRecursive(item.children, itemId) }
        : item,
    );
}

function addChildItem(items: TreeItem[], parentId: string, child: TreeItem): TreeItem[] {
  return items.map(item => {
    if (item.id === parentId) {
      return { ...item, children: [...(item.children || []), child] };
    }
    if (item.children?.length) {
      return { ...item, children: addChildItem(item.children, parentId, child) };
    }
    return item;
  });
}

// Derive statuses bottom-up: parent status = derived from children
function deriveStatuses(items: TreeItem[]): TreeItem[] {
  return items.map(item => {
    if (!item.children?.length) return item;
    const children = deriveStatuses(item.children);
    const statuses = children.map(c => c.status);
    let status: Status;
    if (statuses.every(s => s === 'done')) status = 'done';
    else if (statuses.some(s => s === 'done' || s === 'doing')) status = 'doing';
    else status = 'todo';
    return { ...item, children, status };
  });
}

// --- Actions interface ---

export interface FlowActions {
  addSection: (name?: string) => void;
  updateSection: (sectionId: string, patch: Partial<Pick<Section, 'name' | 'description'>>) => void;
  deleteSection: (sectionId: string) => void;
  addItem: (sectionId: string, content: string, parentItemId?: string) => void;
  updateItem: (sectionId: string, itemId: string, patch: Partial<Pick<TreeItem, 'content' | 'status' | 'description' | 'deferred'>>) => void;
  deleteItem: (sectionId: string, itemId: string) => void;
  setCycleDeadline: (date: string | undefined) => void;
}

export type AIStatusMap = Record<string, 'running' | 'waiting' | 'confirm'>;

interface FlowContextValue {
  projectKey: string;
  projectName: string;
  data: FlowData;
  actions: FlowActions;
  showDeferred: boolean;
  toggleShowDeferred: () => void;
  highlightTarget: HighlightTarget | null;
  clearHighlight: () => void;
  aiStatusMap: AIStatusMap;
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
  initialHighlight?: HighlightTarget | null;
}

const EMPTY_DATA: FlowData = { sections: [] };

export function FlowEditor({ projectKey, projectName, initialHighlight }: FlowEditorProps) {
  const t = useTranslations();
  const [data, setData] = useState<FlowData>(EMPTY_DATA);
  const [loading, setLoading] = useState(true);
  const [showDeferred, setShowDeferred] = useState(true);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [aiStatusMap, setAiStatusMap] = useState<AIStatusMap>({});

  const [highlightTarget, setHighlightTarget] = useState<HighlightTarget | null>(
    initialHighlight ?? null,
  );

  useEffect(() => {
    setHighlightTarget(initialHighlight ?? null);
  }, [initialHighlight]);

  const clearHighlight = useCallback(() => {
    setHighlightTarget(null);
  }, []);

  useEffect(() => {
    if (!highlightTarget) return;
    const handler = () => setHighlightTarget(null);
    const timer = setTimeout(() => {
      window.addEventListener('click', handler, { once: true });
    }, 500);
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
      .then(d => setData(d))
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
  };

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
        showDeferred,
        toggleShowDeferred: () => setShowDeferred(v => !v),
        highlightTarget,
        clearHighlight,
        aiStatusMap,
      }}
    >
      <div className="min-h-screen bg-background">
        <div className="max-w-7xl mx-auto px-8 py-12">
          {/* Header */}
          <header className="mb-10">
            <h1 className="text-3xl font-bold tracking-tight">
              {projectName}
            </h1>

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
                  className="text-xs px-3 py-1 rounded-full border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
                  onClick={() => actions.addSection()}
                >
                  + {t('flows.addSection')}
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
