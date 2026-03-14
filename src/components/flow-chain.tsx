'use client';

import { useState, useEffect, useRef, createContext, useContext } from 'react';
import {
  Check,
  Clock,
  Circle,
  ChevronRight,
  ChevronsRight,
  Plus,
  Sparkles,
  X,
} from 'lucide-react';
import { useRouter } from '@/i18n/routing';
import { Badge } from '@/components/ui/badge';
import { useFlowData } from './flow-editor';
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

// --- Status config ---

const statusConfig: Record<
  Status,
  {
    label: string;
    color: string;
    border: string;
    dot: string;
    icon: typeof Check;
  }
> = {
  done: {
    label: '已完成',
    color: 'text-emerald-600',
    border: 'border-emerald-300 dark:border-emerald-700',
    dot: 'bg-emerald-500',
    icon: Check,
  },
  doing: {
    label: '进行中',
    color: 'text-amber-600',
    border: 'border-amber-300 dark:border-amber-700',
    dot: 'bg-amber-500',
    icon: Clock,
  },
  todo: {
    label: '计划中',
    color: 'text-zinc-400',
    border: 'border-zinc-200 dark:border-zinc-600',
    dot: 'bg-zinc-300 dark:bg-zinc-600',
    icon: Circle,
  },
};

const nextStatus: Record<Status, Status> = {
  done: 'doing',
  doing: 'todo',
  todo: 'done',
};

// --- Depth-based visual weight ---

interface DepthStyles {
  wrapper: string;
  row: string;
  textClass: string;
  childrenIndent: string;
  showDescription: boolean;
  showProgressBar: boolean;
}

function getDepthStyles(depth: number): DepthStyles {
  switch (depth) {
    case 0:
      return {
        wrapper: 'border-b border-border',
        row: 'py-3 px-4 bg-zinc-50/50 dark:bg-zinc-800/30 hover:bg-zinc-100/60 dark:hover:bg-zinc-800/60 transition-colors',
        textClass: 'font-semibold text-sm',
        childrenIndent: 'pl-6',
        showDescription: true,
        showProgressBar: true,
      };
    case 1:
      return {
        wrapper: 'border-b border-border/50',
        row: 'py-2.5 px-4 hover:bg-zinc-50/50 dark:hover:bg-zinc-800/30 transition-colors',
        textClass: 'font-medium text-sm',
        childrenIndent: 'pl-5',
        showDescription: true,
        showProgressBar: true,
      };
    case 2:
      return {
        wrapper: '',
        row: 'py-1.5',
        textClass: 'text-sm',
        childrenIndent: 'pl-5',
        showDescription: false,
        showProgressBar: false,
      };
    default:
      return {
        wrapper: '',
        row: 'py-1',
        textClass: 'text-sm',
        childrenIndent: 'pl-5',
        showDescription: false,
        showProgressBar: false,
      };
  }
}

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

function countDone(items: TreeItem[], filterDeferred: boolean): { done: number; total: number } {
  const visible = filterDeferred ? items.filter(i => !i.deferred) : items;
  let done = 0;
  for (const item of visible) {
    if (getEffectiveStatus(item, filterDeferred) === 'done') done++;
  }
  return { done, total: visible.length };
}

function findItemById(items: TreeItem[], id: string): TreeItem | null {
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

function collectFlowTaskContext(params: {
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

function StatusIcon({ status }: { status: Status }) {
  const config = statusConfig[status];
  const Icon = config.icon;
  return <Icon className={`w-3.5 h-3.5 ${config.color} shrink-0`} />;
}

function AIStatusBadge({ status }: { status?: 'running' | 'waiting' | 'confirm' }) {
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
      <span className="inline-block h-2 w-2 shrink-0 rounded-full animate-[blink-confirm_1.5s_ease-in-out_infinite]" title="AI 已完成，待确认" />
    );
  }
  return (
    <span className="inline-block h-2 w-2 shrink-0 rounded-full animate-blink-waiting" title="等待回复" />
  );
}

function ProgressBar({
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

function CollapseIcon({ open }: { open: boolean }) {
  return (
    <ChevronRight
      className={`w-3.5 h-3.5 text-muted-foreground transition-transform duration-150 ${
        open ? 'rotate-90' : ''
      }`}
    />
  );
}

function EditableText({
  value,
  onChange,
  className = '',
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  if (!editing) {
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

  return (
    <input
      autoFocus
      className={`bg-white dark:bg-zinc-900 border border-border rounded px-1 -mx-1 outline-none focus:ring-1 focus:ring-ring w-full ${className}`}
      value={draft}
      onClick={e => e.stopPropagation()}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => {
        if (draft.trim()) onChange(draft.trim());
        setEditing(false);
      }}
      onKeyDown={e => {
        if (e.key === 'Enter') {
          if (draft.trim()) onChange(draft.trim());
          setEditing(false);
        }
        if (e.key === 'Escape') setEditing(false);
      }}
    />
  );
}

function DeleteButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      className="opacity-0 group-hover/item:opacity-100 p-0.5 rounded hover:bg-red-50 dark:hover:bg-red-950/30 text-muted-foreground hover:text-red-500 transition-all shrink-0"
      onClick={e => {
        e.stopPropagation();
        onClick();
      }}
    >
      <X className="w-3.5 h-3.5" />
    </button>
  );
}

function AddItemInput({
  onAdd,
  onCancel,
  placeholder = '添加条目...',
  autoFocus = false,
}: {
  onAdd: (content: string) => void;
  onCancel?: () => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [value, setValue] = useState('');

  return (
    <div className="flex items-center gap-2 mt-1">
      <Plus className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
      <input
        autoFocus={autoFocus}
        placeholder={placeholder}
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

function StatusBadge({
  status,
  onClick,
}: {
  status: Status;
  onClick: () => void;
}) {
  const config = statusConfig[status];
  return (
    <Badge
      variant="outline"
      className={`text-[10px] px-1.5 py-0 cursor-pointer hover:opacity-70 transition-opacity ${config.color} ${config.border}`}
      onClick={e => {
        e.stopPropagation();
        onClick();
      }}
      title="点击切换状态"
    >
      {config.label}
    </Badge>
  );
}

// --- Actions context ---

interface ItemActionsCtx {
  sectionId: string;
  section: Section;
  onToggleStatus: (itemId: string) => void;
  onUpdate: (itemId: string, patch: Partial<Pick<TreeItem, 'content' | 'description' | 'status' | 'deferred' | 'context'>>) => void;
  onDelete: (itemId: string) => void;
  onAddChild: (parentItemId: string, content: string) => void;
  onToggleDefer: (itemId: string, currentDeferred: boolean) => void;
  onLaunchAI: (item: TreeItem, ancestors: TreeItem[]) => void;
}

const ItemActionsContext = createContext<ItemActionsCtx | null>(null);

// --- TreeItemRow — the unified recursive component ---

function TreeItemRow({
  item,
  depth,
  ancestors,
}: {
  item: TreeItem;
  depth: number;
  ancestors: TreeItem[];
}) {
  const ctx = useContext(ItemActionsContext);
  const { showDeferred, highlightTarget, aiStatusMap } = useFlowData();
  const [isOpen, setIsOpen] = useState(!!(item.children && item.children.length > 0));
  const [isAdding, setIsAdding] = useState(false);

  const hasChildren = !!(item.children && item.children.length > 0);
  const isDeferred = !!item.deferred;
  const filterDeferred = !showDeferred;
  const effectiveStatus = hasChildren
    ? getEffectiveStatus(item, filterDeferred)
    : item.status;

  const styles = getDepthStyles(depth);
  const isHighlighted = highlightTarget?.itemId === item.id;
  const rowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isHighlighted && rowRef.current) {
      const timer = setTimeout(() => {
        rowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [isHighlighted]);

  // Auto-expand if highlight target is within this item's descendants
  useEffect(() => {
    if (!highlightTarget?.itemId) return;
    if (hasChildren && findItemById(item.children!, highlightTarget.itemId)) {
      setIsOpen(true);
    }
  }, [highlightTarget, hasChildren, item.children]);

  if (!ctx) return null;
  if (!showDeferred && item.deferred) return null;

  const { done: doneCount, total: totalCount } = hasChildren
    ? countDone(item.children!, filterDeferred)
    : { done: 0, total: 0 };

  return (
    <div className={`${styles.wrapper} ${isDeferred ? 'opacity-40' : ''}`}>
      <div
        ref={rowRef}
        className={`flex items-start gap-2 group/item ${styles.row} ${isHighlighted ? 'bg-yellow-200! dark:bg-yellow-500/20!' : ''}`}
      >
        {/* Collapse toggle */}
        <button
          className="shrink-0 w-3.5 h-3.5 flex items-center justify-center mt-0.5"
          onClick={e => {
            e.stopPropagation();
            if (hasChildren) setIsOpen(!isOpen);
          }}
        >
          {hasChildren ? <CollapseIcon open={isOpen} /> : <span className="w-3.5" />}
        </button>

        {/* Status icon */}
        <button
          className="shrink-0 mt-0.5"
          onClick={hasChildren ? () => setIsOpen(!isOpen) : () => ctx.onToggleStatus(item.id)}
          title={hasChildren ? '状态由子项决定' : '点击切换状态'}
        >
          <StatusIcon status={effectiveStatus} />
        </button>

        {/* Content area */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <EditableText
              value={item.content}
              onChange={v => ctx.onUpdate(item.id, { content: v })}
              className={`${styles.textClass} ${
                effectiveStatus === 'done' ? 'text-muted-foreground' : 'text-foreground'
              }`}
            />
            {depth <= 1 && (
              <StatusBadge
                status={effectiveStatus}
                onClick={() => ctx.onUpdate(item.id, { status: nextStatus[item.status] })}
              />
            )}
            <AIStatusBadge status={aiStatusMap[item.id]} />
          </div>

          {/* Description (depth 0-1 only) */}
          {styles.showDescription && item.description && (
            <EditableText
              value={item.description}
              onChange={v => ctx.onUpdate(item.id, { description: v })}
              className="text-xs text-muted-foreground mt-1 block"
            />
          )}

          {/* Progress bar */}
          {styles.showProgressBar && hasChildren && (
            <ProgressBar done={doneCount} total={totalCount} status={effectiveStatus} />
          )}
        </div>

        {/* Hover actions */}
        <button
          className="opacity-0 group-hover/item:opacity-100 p-0.5 rounded hover:bg-violet-50 dark:hover:bg-violet-950/30 text-muted-foreground hover:text-violet-500 transition-all shrink-0"
          onClick={e => {
            e.stopPropagation();
            ctx.onLaunchAI(item, ancestors);
          }}
          title="发起 AI 协作"
        >
          <Sparkles className="w-3.5 h-3.5" />
        </button>
        <button
          className={`p-0.5 rounded transition-all shrink-0 ${
            isDeferred
              ? 'text-blue-400 hover:text-blue-600 opacity-100'
              : 'opacity-0 group-hover/item:opacity-100 text-muted-foreground hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-950/30'
          }`}
          onClick={e => {
            e.stopPropagation();
            ctx.onToggleDefer(item.id, !!item.deferred);
          }}
          title={isDeferred ? '移入本周期' : '推到以后'}
        >
          <ChevronsRight className="w-3.5 h-3.5" />
        </button>
        <button
          className="opacity-0 group-hover/item:opacity-100 p-0.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-muted-foreground hover:text-foreground transition-all shrink-0"
          onClick={e => {
            e.stopPropagation();
            setIsOpen(true);
            setIsAdding(true);
          }}
          title="添加子项"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
        <DeleteButton onClick={() => ctx.onDelete(item.id)} />
      </div>

      {/* Expanded children */}
      {((isOpen && hasChildren) || isAdding) && (
        <div className={styles.childrenIndent}>
          {item.children?.map(child => (
            <TreeItemRow
              key={child.id}
              item={child}
              depth={depth + 1}
              ancestors={[...ancestors, item]}
            />
          ))}
          {isAdding ? (
            <AddItemInput
              onAdd={content => ctx.onAddChild(item.id, content)}
              onCancel={() => setIsAdding(false)}
              placeholder="添加子项..."
              autoFocus
            />
          ) : (
            <AddItemInput
              onAdd={content => ctx.onAddChild(item.id, content)}
              placeholder="添加子项..."
            />
          )}
        </div>
      )}

      {/* Collapsed children summary */}
      {!isOpen && hasChildren && (
        <div
          className={`${styles.childrenIndent} flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 cursor-pointer hover:bg-zinc-50/50 dark:hover:bg-zinc-800/30 rounded transition-colors`}
          onClick={() => setIsOpen(true)}
        >
          {item.children!
            .filter(c => showDeferred || !c.deferred)
            .map(child => {
              const s = getEffectiveStatus(child, filterDeferred);
              return (
                <div key={child.id} className={`flex items-center gap-1 ${child.deferred ? 'opacity-40' : ''}`}>
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusConfig[s].dot}`} />
                  <span className={`text-xs ${s === 'done' ? 'text-muted-foreground line-through' : 'text-muted-foreground'}`}>
                    {child.content}
                  </span>
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}

// --- SectionBlock ---

export function SectionBlock({ section }: { section: Section }) {
  const { projectKey, projectName, data, actions, showDeferred, highlightTarget, aiStatusMap } = useFlowData();
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(true);
  const filterDeferred = !showDeferred;

  // Restore open state from sessionStorage
  useEffect(() => {
    const saved = sessionStorage.getItem(`section-open:${section.id}`);
    if (saved !== null) setIsOpen(saved === '1');
  }, [section.id]);

  // Auto-expand if highlight target is within this section
  useEffect(() => {
    if (!highlightTarget) return;
    if (highlightTarget.sectionId === section.id) {
      setIsOpen(true);
      sessionStorage.setItem(`section-open:${section.id}`, '1');
    }
  }, [highlightTarget, section.id]);

  const toggleOpen = (open: boolean) => {
    setIsOpen(open);
    sessionStorage.setItem(`section-open:${section.id}`, open ? '1' : '0');
  };

  // Stats
  const { done: doneCount, total: totalCount } = countDone(section.items, filterDeferred);
  const sectionStatus: Status =
    totalCount === 0 ? 'todo' : doneCount === totalCount ? 'done' : doneCount > 0 ? 'doing' : 'todo';

  // AI launch handler
  const handleLaunchAI = async (item: TreeItem, ancestors: TreeItem[]) => {
    const flowContext = collectFlowTaskContext({
      projectKey,
      projectName,
      section,
      ancestors,
      task: item,
      allSections: data.sections,
      cycleDeadline: data.cycleDeadline,
      excludes: item.context?.excludes,
      customItems: item.context?.items,
      globalContextIds: item.context?.globalContextIds,
    });

    const agentId = item.agentId?.trim() || 'agent-builtin-butler';
    const promptLines: string[] = [];
    promptLines.push(`任务：${flowContext.taskContent}`);
    if (flowContext.taskDescription?.trim()) promptLines.push(`任务描述：${flowContext.taskDescription.trim()}`);
    if (flowContext.sectionName?.trim()) promptLines.push(`所在板块：${flowContext.sectionName.trim()}`);
    if (flowContext.ancestors.length > 0) promptLines.push(`上级路径：${flowContext.ancestors.map(a => a.content).join(' > ')}`);
    if (flowContext.siblings.length > 0) promptLines.push(`同级任务：${flowContext.siblings.map(s => `${s.content}(${s.status})`).join('；')}`);
    promptLines.push('请先给出执行计划，再开始实施。');

    const res = await fetch('/api/agent-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId,
        message: promptLines.join('\n'),
        projectKey,
        initialTitle: item.content,
      }),
    });

    if (res.ok) {
      const session = await res.json() as { sessionId: string };
      const query = new URLSearchParams();
      query.set('project', projectKey);
      query.set('agent', agentId);
      query.set('session', session.sessionId);
      router.push(`/flows/agents?${query.toString()}`);
    }
  };

  const itemActions: ItemActionsCtx = {
    sectionId: section.id,
    section,
    onToggleStatus: itemId => {
      const found = findItemById(section.items, itemId);
      if (found) {
        actions.updateItem(section.id, itemId, { status: nextStatus[found.status] });
      }
    },
    onUpdate: (itemId, patch) => actions.updateItem(section.id, itemId, patch),
    onDelete: itemId => actions.deleteItem(section.id, itemId),
    onAddChild: (parentItemId, content) => actions.addItem(section.id, content, parentItemId),
    onToggleDefer: (itemId, currentDeferred) =>
      actions.updateItem(section.id, itemId, { deferred: !currentDeferred }),
    onLaunchAI: handleLaunchAI,
  };

  const isSectionHighlighted =
    highlightTarget?.sectionId === section.id && !highlightTarget?.itemId;

  return (
    <section
      className={`mb-8 ${isSectionHighlighted ? 'bg-yellow-200 dark:bg-yellow-500/20' : ''}`}
    >
      {/* Section header */}
      <div
        className="flex items-center gap-3 py-3 px-4 bg-zinc-100/60 dark:bg-zinc-800/60 border border-border rounded-t-lg cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors group/item"
        onClick={() => toggleOpen(!isOpen)}
      >
        <CollapseIcon open={isOpen} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <EditableText
              value={section.name}
              onChange={v => actions.updateSection(section.id, { name: v })}
              className="font-bold text-base"
            />
            <StatusBadge status={sectionStatus} onClick={() => {}} />
            <span className="text-[10px] text-muted-foreground">
              {doneCount}/{totalCount}
            </span>
            <DeleteButton onClick={() => actions.deleteSection(section.id)} />
          </div>
          {section.description && (
            <EditableText
              value={section.description}
              onChange={v => actions.updateSection(section.id, { description: v })}
              className="text-xs text-muted-foreground mt-0.5 block"
            />
          )}
        </div>
      </div>

      {/* Section body */}
      {isOpen && (
        <div className="border-x border-b border-border rounded-b-lg">
          <ItemActionsContext.Provider value={itemActions}>
            {section.items.map(item => (
              <TreeItemRow
                key={item.id}
                item={item}
                depth={0}
                ancestors={[]}
              />
            ))}
          </ItemActionsContext.Provider>
          <div className="px-4 py-2">
            <AddItemInput
              onAdd={content => actions.addItem(section.id, content)}
              placeholder="添加条目..."
            />
          </div>
        </div>
      )}

      {/* Collapsed summary */}
      {!isOpen && section.items.length > 0 && (
        <div className="flex flex-wrap gap-3 py-2.5 px-4 border-x border-b border-border rounded-b-lg">
          {section.items
            .filter(item => showDeferred || !item.deferred)
            .map(item => {
              const s = getEffectiveStatus(item, filterDeferred);
              const ai = aiStatusMap[item.id];
              return (
                <div key={item.id} className={`flex items-center gap-1.5 ${item.deferred ? 'opacity-40' : ''}`}>
                  <StatusIcon status={s} />
                  <span className={`text-xs ${s === 'done' ? 'text-muted-foreground' : 'text-foreground'}`}>
                    {item.content}
                    {ai && <>{' '}<AIStatusBadge status={ai} /></>}
                  </span>
                </div>
              );
            })}
        </div>
      )}
    </section>
  );
}
