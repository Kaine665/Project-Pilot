'use client';

import { useState, useRef, useEffect, createContext } from 'react';
import {
  Check,
  Clock,
  Circle,
  ChevronRight,
  Plus,
  X,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import type {
  Section,
  TreeItem,
  Status,
  ContextItem,
} from '@/types/flow';
import type {
  FlowTaskContext,
  AncestorBrief,
  SiblingBrief,
  SectionBrief,
} from '@/types/flow-context';
import type { Agent } from '@/types';

// --- Status config ---

export const statusConfig: Record<
  Status,
  {
    labelKey: string; // Changed from label to labelKey
    color: string;
    border: string;
    dot: string;
    icon: typeof Check;
  }
> = {
  done: {
    labelKey: 'status.done',
    color: 'text-emerald-600',
    border: 'border-emerald-300 dark:border-emerald-700',
    dot: 'bg-emerald-500',
    icon: Check,
  },
  doing: {
    labelKey: 'status.doing',
    color: 'text-amber-600',
    border: 'border-amber-300 dark:border-amber-700',
    dot: 'bg-amber-500',
    icon: Clock,
  },
  todo: {
    labelKey: 'status.todo',
    color: 'text-zinc-400',
    border: 'border-zinc-200 dark:border-zinc-600',
    dot: 'bg-zinc-300 dark:bg-zinc-600',
    icon: Circle,
  },
};

export const nextStatus: Record<Status, Status> = {
  done: 'doing',
  doing: 'todo',
  todo: 'done',
};

// --- Status helpers ---

export function getEffectiveStatus(item: TreeItem, filterDeferred: boolean): Status {
  if (!item.children?.length) return item.status;
  const children = filterDeferred
    ? item.children.filter(c => !c.deferred)
    : item.children;
  if (children.length === 0) return 'todo';
  const statuses = children.map(c => getEffectiveStatus(c, filterDeferred));
  if (statuses.every(s => s === 'done')) return 'done';
  if (statuses.some(s => s === 'done' || s === 'doing')) return 'doing';
  return 'todo';
}

/**
 * 预计算所有 item 的 effective status，返回 Map<itemId, Status>。
 * 一次遍历替代渲染期间 N 次递归调用。
 */
export function buildStatusMap(items: TreeItem[], filterDeferred: boolean): Map<string, Status> {
  const map = new Map<string, Status>();
  function walk(item: TreeItem): Status {
    const s = getEffectiveStatus(item, filterDeferred);
    map.set(item.id, s);
    if (item.children) {
      for (const c of item.children) walk(c);
    }
    return s;
  }
  for (const item of items) walk(item);
  return map;
}

export function countDone(items: TreeItem[], filterDeferred: boolean): { done: number; total: number } {
  const visible = filterDeferred ? items.filter(i => !i.deferred) : items;
  let done = 0;
  for (const item of visible) {
    if (getEffectiveStatus(item, filterDeferred) === 'done') done++;
  }
  return { done, total: visible.length };
}

export function findItemById(items: TreeItem[], id: string): TreeItem | null {
  for (const item of items) {
    if (item.id === id) return item;
    if (item.children?.length) {
      const found = findItemById(item.children, id);
      if (found) return found;
    }
  }
  return null;
}

// --- FlowTaskContext collection ---

export function collectFlowTaskContext(params: {
  projectKey: string;
  projectName: string;
  section: Section;
  ancestors: TreeItem[];
  task: TreeItem;
  allSections: Section[];
  cycleDeadline?: string;
  excludes?: string[];
  customItems?: ContextItem[];
  globalContextIds?: string[];
}): FlowTaskContext {
  const { projectKey, projectName, section, ancestors, task, allSections, cycleDeadline, excludes = [], customItems, globalContextIds } = params;

  const skip = (key: string) => excludes.includes(key);

  const parent = ancestors.length > 0 ? ancestors[ancestors.length - 1] : null;
  const siblingSource = parent ? (parent.children ?? []) : section.items;
  const siblings: SiblingBrief[] = skip('siblings') ? [] : siblingSource
    .filter(item => item.id !== task.id)
    .map(item => ({ content: item.content, status: item.status }));

  const ancestorBriefs: AncestorBrief[] = skip('ancestors') ? [] : ancestors.map(a => ({
    id: a.id,
    content: a.content,
    description: a.description,
    status: a.status,
  }));

  const otherSections: SectionBrief[] = skip('otherSections') ? [] : allSections
    .filter(s => s.id !== section.id)
    .map(s => ({ name: s.name, description: s.description }));

  return {
    projectKey,
    projectName,
    flowTaskId: task.id,
    taskContent: task.content,
    taskDescription: task.description,
    sectionId: skip('section') ? '' : section.id,
    sectionName: skip('section') ? '' : section.name,
    sectionDescription: skip('section') ? undefined : section.description,
    ancestors: ancestorBriefs,
    siblings,
    otherSections,
    cycleDeadline: skip('cycleDeadline') ? undefined : cycleDeadline,
    customContext: customItems?.length ? customItems : undefined,
    globalContextIds: globalContextIds?.length ? globalContextIds : undefined,
  };
}

// --- Shared UI components ---

export function StatusIcon({ status }: { status: Status }) {
  const config = statusConfig[status];
  const Icon = config.icon;
  return <Icon className={`w-3.5 h-3.5 ${config.color} shrink-0`} />;
}

export function AIStatusBadge({ status }: { status?: 'running' | 'waiting' | 'confirm' }) {
  const t = useTranslations();
  if (!status) return null;
  if (status === 'running') {
    return (
      <span className="inline-flex items-center rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium leading-none text-emerald-500">
        -ing
      </span>
    );
  }
  if (status === 'confirm') {
    return (
      <span className="inline-block h-2 w-2 shrink-0 rounded-full animate-blink-confirm" title={t('status.aiComplete')} />
    );
  }
  return (
    <span className="inline-block h-2 w-2 shrink-0 rounded-full animate-blink-waiting" title={t('status.waiting')} />
  );
}

export function ProgressBar({
  done,
  total,
  status,
}: {
  done: number;
  total: number;
  status: Status;
}) {
  const barColor =
    status === 'done'
      ? 'bg-emerald-500'
      : status === 'doing'
      ? 'bg-amber-400'
      : 'bg-zinc-300';
  return (
    <div className="flex items-center gap-2 mt-1.5">
      <div className="h-1 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden flex-1">
        <div
          className={`h-full rounded-full ${barColor}`}
          style={{ width: `${total > 0 ? (done / total) * 100 : 0}%` }}
        />
      </div>
      <span className="text-[10px] text-muted-foreground shrink-0">
        {done}/{total}
      </span>
    </div>
  );
}

export function CollapseIcon({ open }: { open: boolean }) {
  return (
    <ChevronRight
      className={`w-3.5 h-3.5 text-muted-foreground transition-transform duration-150 ${
        open ? 'rotate-90' : ''
      }`}
    />
  );
}

export function EditableText({
  value,
  onChange,
  className = '',
  placeholder,
  placeholderClassName,
  autoEdit = false,
  multiline = false,
  maxLength,
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
  placeholder?: string;
  placeholderClassName?: string;
  autoEdit?: boolean;
  multiline?: boolean;
  maxLength?: number;
}) {
  const [editing, setEditing] = useState(autoEdit);
  const [draft, setDraft] = useState(value);

  if (!editing) {
    if (!value && placeholder) {
      return (
        <span
          className={`cursor-text rounded px-1 -mx-1 transition-colors ${placeholderClassName ?? className}`}
          onClick={e => {
            e.stopPropagation();
            setEditing(true);
            setDraft('');
          }}
        >
          {placeholder}
        </span>
      );
    }
    return (
      <span
        className={`cursor-text hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded px-1 -mx-1 transition-colors ${className}`}
        onClick={e => {
          e.stopPropagation();
          setEditing(true);
          setDraft(value);
        }}
      >
        {value}
      </span>
    );
  }

  const commit = () => {
    onChange(draft.trim());
    setEditing(false);
  };

  if (multiline) {
    return (
      <textarea
        autoFocus
        placeholder={placeholder}
        maxLength={maxLength}
        rows={3}
        className={`bg-white dark:bg-zinc-900 border border-border rounded px-1 -mx-1 outline-none focus:ring-1 focus:ring-ring w-full resize-y ${className}`}
        value={draft}
        onClick={e => e.stopPropagation()}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) commit();
          if (e.key === 'Escape') setEditing(false);
        }}
      />
    );
  }

  return (
    <input
      autoFocus
      placeholder={placeholder}
      maxLength={maxLength}
      className={`bg-white dark:bg-zinc-900 border border-border rounded px-1 -mx-1 outline-none focus:ring-1 focus:ring-ring w-full ${className}`}
      value={draft}
      onClick={e => e.stopPropagation()}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') setEditing(false);
      }}
    />
  );
}

export function DeleteButton({ onClick }: { onClick: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(null);

  useEffect(() => {
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  return (
    <button
      className={`p-0.5 rounded transition-all shrink-0 ${
        confirming
          ? 'bg-red-500 text-white hover:bg-red-600'
          : 'text-muted-foreground hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30'
      }`}
      onClick={e => {
        e.stopPropagation();
        if (confirming) {
          if (timerRef.current) clearTimeout(timerRef.current);
          setConfirming(false);
          onClick();
        } else {
          setConfirming(true);
          timerRef.current = setTimeout(() => setConfirming(false), 2000);
        }
      }}
      onMouseLeave={() => {
        if (confirming) {
          if (timerRef.current) clearTimeout(timerRef.current);
          timerRef.current = setTimeout(() => setConfirming(false), 1000);
        }
      }}
    >
      <X className="w-3.5 h-3.5" />
    </button>
  );
}

export function AddItemInput({
  onAdd,
  onCancel,
  placeholder,
  autoFocus = false,
}: {
  onAdd: (content: string) => void;
  onCancel?: () => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const t = useTranslations();
  const [value, setValue] = useState('');
  const defaultPlaceholder = t('flows.addItem');

  return (
    <div className="flex items-center gap-2 mt-1">
      <Plus className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
      <input
        autoFocus={autoFocus}
        placeholder={placeholder || defaultPlaceholder}
        className="text-sm bg-transparent outline-none placeholder:text-muted-foreground/50 w-full"
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && value.trim()) {
            onAdd(value.trim());
            setValue('');
          }
          if (e.key === 'Escape') onCancel?.();
        }}
        onBlur={() => {
          if (!value.trim()) onCancel?.();
        }}
      />
    </div>
  );
}

export function StatusBadge({
  status,
  onClick,
}: {
  status: Status;
  onClick: () => void;
}) {
  const t = useTranslations();
  const config = statusConfig[status];
  return (
    <Badge
      variant="outline"
      className={`text-[10px] px-1.5 py-0 cursor-pointer hover:opacity-70 transition-opacity ${config.color} ${config.border}`}
      onClick={e => {
        e.stopPropagation();
        onClick();
      }}
      title={t('actions.clickToToggle')}
    >
      {t(config.labelKey)}
    </Badge>
  );
}

// --- Actions context ---

export interface ItemActionsCtx {
  sectionId: string;
  section: Section;
  onToggleStatus: (itemId: string) => void;
  onUpdate: (itemId: string, patch: Partial<Pick<TreeItem, 'content' | 'description' | 'status' | 'deferred' | 'context' | 'agentId'>>) => void;
  onDelete: (itemId: string) => void;
  onAddChild: (parentItemId: string, content: string) => void;
  onToggleDefer: (itemId: string, currentDeferred: boolean) => void;
  onLaunchAI: (item: TreeItem, ancestors: TreeItem[]) => void;
  agents: Agent[];
  onAssignAgent: (itemId: string, agentId: string | null) => void;
}

export const ItemActionsContext = createContext<ItemActionsCtx | null>(null);
