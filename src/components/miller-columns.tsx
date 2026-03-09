'use client';

import {
  memo,
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  createContext,
  useContext,
} from 'react';
import {
  Plus,
  GripVertical,
  Bot,
} from 'lucide-react';
import { ItemActionsPanel, ItemAgentPickerPanel } from './miller-item-panels';
import * as Dialog from '@radix-ui/react-dialog';
import { TaskContextDialog } from './task-context-dialog';
import { useRouter } from '@/i18n/routing';
import { useTranslations } from 'next-intl';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useFlowData, filterTreeItems } from './flow-editor';
import {
  nextStatus,
  getEffectiveStatus,
  countDone,
  findItemById,
  collectFlowTaskContext,
  StatusIcon,
  StatusBadge,
  AIStatusBadge,
  ProgressBar,
  CollapseIcon,
  EditableText,
  DeleteButton,
  AddItemInput,
  ItemActionsContext,
} from './flow-shared';
import type { ItemActionsCtx } from './flow-shared';
import type {
  Section,
  TreeItem,
  Status,
} from '@/types/flow';

// --- Selection context ---

interface MillerSelectionCtx {
  selectionPath: string[];
  onSelect: (itemId: string, depth: number) => void;
  addingToItemId: string | null;
  setAddingToItemId: (id: string | null) => void;
}

const MillerSelectionContext = createContext<MillerSelectionCtx>({
  selectionPath: [],
  onSelect: () => {},
  addingToItemId: null,
  setAddingToItemId: () => {},
});

// --- Helpers ---

/** Walk the tree to find the ancestor path to a target item */
function getAncestorPath(items: TreeItem[], targetId: string): string[] | null {
  for (const item of items) {
    if (item.id === targetId) return [item.id];
    if (item.children?.length) {
      const sub = getAncestorPath(item.children, targetId);
      if (sub) return [item.id, ...sub];
    }
  }
  return null;
}

/** Reconstruct ancestor TreeItem objects from selection path */
function getAncestors(items: TreeItem[], path: string[]): TreeItem[] {
  const result: TreeItem[] = [];
  let current = items;
  for (const id of path) {
    const found = current.find(i => i.id === id);
    if (!found) break;
    result.push(found);
    current = found.children ?? [];
  }
  return result;
}

// --- MillerColumnItem ---

const MillerColumnItem = memo(function MillerColumnItem({
  item,
  depth,
  sectionItems,
}: {
  item: TreeItem;
  depth: number;
  sectionItems: TreeItem[];
}) {
  const t = useTranslations();
  const ctx = useContext(ItemActionsContext);
  const { selectionPath, onSelect, setAddingToItemId } = useContext(MillerSelectionContext);
  const { showDeferred, highlightTarget, aiStatusMap, batchMode, selectedItems, toggleItemSelection, data, agents, agentMap } = useFlowData();

  if (!ctx) return null;
  if (!showDeferred && item.deferred) return null;

  const hasChildren = !!(item.children && item.children.length > 0);
  const isDeferred = !!item.deferred;
  const filterDeferred = !showDeferred;
  const effectiveStatus = hasChildren
    ? getEffectiveStatus(item, filterDeferred)
    : item.status;

  const isSelected = selectionPath[depth] === item.id;
  const isHighlighted = highlightTarget?.itemId === item.id;

  const { done: doneCount, total: totalCount } = hasChildren
    ? countDone(item.children!, filterDeferred)
    : { done: 0, total: 0 };

  // Reconstruct ancestors for AI launch
  const handleLaunchAI = () => {
    const pathToItem = selectionPath.slice(0, depth);
    const ancestors = getAncestors(sectionItems, pathToItem);
    ctx.onLaunchAI(item, ancestors);
  };

  const rowRef = useRef<HTMLDivElement>(null);
  const [addingDesc, setAddingDesc] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const actionsPanelRef = useRef<HTMLDivElement>(null);
  const [actionsPos, setActionsPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const actionsCloseTimer = useRef<ReturnType<typeof setTimeout>>(null);
  const [agentPickerOpen, setAgentPickerOpen] = useState(false);
  const agentPickerRef = useRef<HTMLDivElement>(null);
  const [agentPickerPos, setAgentPickerPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  const boundAgent = item.agentId ? agentMap.get(item.agentId) : undefined;

  useEffect(() => {
    if (!agentPickerOpen) return;
    const handler = (e: MouseEvent) => {
      if (agentPickerRef.current && !agentPickerRef.current.contains(e.target as Node)) {
        setAgentPickerOpen(false);
      }
    };
    const timer = setTimeout(() => document.addEventListener('mousedown', handler), 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handler);
    };
  }, [agentPickerOpen]);

  const openActions = useCallback(() => {
    if (actionsCloseTimer.current) { clearTimeout(actionsCloseTimer.current); actionsCloseTimer.current = null; }
    if (!actionsOpen) {
      const rect = rowRef.current?.getBoundingClientRect();
      if (rect) {
        setActionsPos({ top: rect.top + rect.height / 2, left: rect.right + 6 });
        setActionsOpen(true);
      }
    }
  }, [actionsOpen]);

  const scheduleCloseActions = useCallback(() => {
    if (actionsCloseTimer.current) clearTimeout(actionsCloseTimer.current);
    actionsCloseTimer.current = setTimeout(() => setActionsOpen(false), 150);
  }, []);

  const cancelCloseActions = useCallback(() => {
    if (actionsCloseTimer.current) { clearTimeout(actionsCloseTimer.current); actionsCloseTimer.current = null; }
  }, []);

  const contextAncestors = useMemo(
    () => getAncestors(sectionItems, selectionPath.slice(0, depth)),
    [sectionItems, selectionPath, depth],
  );

  useEffect(() => {
    if (isHighlighted && rowRef.current) {
      const timer = setTimeout(() => {
        rowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [isHighlighted]);

  const isItemSelected = selectedItems.has(item.id);

  return (
    <div
      ref={rowRef}
      className={`group/item flex items-start gap-2 px-3 py-2 cursor-pointer transition-colors relative ${
        isHighlighted
          ? 'bg-yellow-200! dark:bg-yellow-500/20!'
          : batchMode && isItemSelected
          ? 'bg-purple-50 dark:bg-purple-950/30'
          : isSelected
          ? 'bg-blue-50 dark:bg-blue-950/30'
          : 'hover:bg-zinc-50/80 dark:hover:bg-zinc-800/30'
      } ${isDeferred ? 'opacity-40' : ''}`}
      onClick={() => {
        if (batchMode) {
          toggleItemSelection(item.id);
        } else {
          onSelect(item.id, depth);
        }
      }}
      onMouseEnter={openActions}
      onMouseLeave={scheduleCloseActions}
    >
      {/* Batch mode checkbox */}
      {batchMode && (
        <input
          type="checkbox"
          checked={isItemSelected}
          onChange={() => toggleItemSelection(item.id)}
          onClick={e => e.stopPropagation()}
          className="shrink-0 mt-1 w-4 h-4 rounded border-zinc-300 text-purple-600 focus:ring-purple-500"
        />
      )}

      {/* Status icon */}
      {!batchMode && (
        <button
          className="shrink-0 mt-0.5"
          onClick={e => {
            e.stopPropagation();
            if (!hasChildren) ctx.onToggleStatus(item.id);
          }}
          title={hasChildren ? t('status.decidedByChildren') : t('actions.clickToToggle')}
        >
          <StatusIcon status={effectiveStatus} />
        </button>
      )}

      {/* Content area */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <EditableText
            value={item.content}
            onChange={v => ctx.onUpdate(item.id, { content: v })}
            placeholder={t('flows.unnamed')}
            className={`text-sm font-medium ${
              effectiveStatus === 'done' ? 'text-muted-foreground' : 'text-foreground'
            }`}
          />
          <AIStatusBadge status={aiStatusMap[item.id]} />
          {boundAgent && (
            <span
              className="inline-flex items-center gap-0.5 rounded bg-blue-100 dark:bg-blue-900/30 px-1 text-[10px] text-blue-600 dark:text-blue-400 shrink-0 leading-[1.4]"
              title={t('flows.agentBound', { agent: boundAgent.name })}
            >
              <Bot className="w-2.5 h-2.5" />
              {boundAgent.name}
            </span>
          )}
          {item.context?.items?.length ? (
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" title={t('flows.taskContext')} />
          ) : null}
          {hasChildren && (
            <span className="flex items-center gap-0.5 ml-auto shrink-0 pl-2">
              {item.children!
                .filter(c => showDeferred || !c.deferred)
                .slice(0, 8)
                .map(c => {
                  const cs = getEffectiveStatus(c, filterDeferred);
                  const ai = aiStatusMap[c.id];
                  const dotClass = ai === 'confirm'
                    ? 'animate-blink-confirm'
                    : ai === 'waiting'
                    ? 'animate-blink-waiting'
                    : ai === 'running'
                    ? 'bg-blue-500 animate-pulse'
                    : cs === 'done' ? 'bg-emerald-500'
                    : cs === 'doing' ? 'bg-blue-500'
                    : 'bg-zinc-300 dark:bg-zinc-600';
                  return (
                    <span key={c.id} className={`inline-block w-1.5 h-1.5 rounded-full ${dotClass}`} title={c.content} />
                  );
                })}
              <span className="text-[10px] text-muted-foreground ml-0.5">{doneCount}/{totalCount}</span>
            </span>
          )}
        </div>
        {item.description ? (
          <EditableText
            value={item.description}
            onChange={v => ctx.onUpdate(item.id, { description: v || undefined })}
            className="text-xs text-muted-foreground mt-0.5 block truncate"
            multiline
            maxLength={500}
          />
        ) : addingDesc ? (
          <EditableText
            value=""
            onChange={v => {
              if (v) ctx.onUpdate(item.id, { description: v });
              setAddingDesc(false);
            }}
            className="text-xs text-muted-foreground mt-0.5 block"
            placeholder={t('flows.descriptionPlaceholder')}
            autoEdit
            multiline
            maxLength={500}
          />
        ) : null}
      </div>

      {/* Selection arrow (right edge) */}
      {isSelected && hasChildren && (
        <div className="absolute right-0 top-1/2 -translate-y-1/2 z-10">
          <div className="w-0 h-0 border-t-[6px] border-t-transparent border-b-[6px] border-b-transparent border-l-[6px] border-l-blue-400" />
        </div>
      )}

      {/* Actions panel — rendered via portal to escape overflow clipping */}
      {actionsOpen && (
        <ItemActionsPanel
          panelRef={actionsPanelRef}
          pos={actionsPos}
          item={item}
          addingDesc={addingDesc}
          isDeferred={isDeferred}
          isSelected={isSelected}
          boundAgent={boundAgent}
          onAddDescription={() => { setActionsOpen(false); setAddingDesc(true); }}
          onOpenContext={() => { setActionsOpen(false); setContextOpen(true); }}
          onOpenAgentPicker={e => {
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            setAgentPickerPos({ top: rect.bottom + 4, left: rect.left });
            setActionsOpen(false);
            setAgentPickerOpen(v => !v);
          }}
          onLaunchAI={() => { setActionsOpen(false); handleLaunchAI(); }}
          onToggleDefer={() => { setActionsOpen(false); ctx.onToggleDefer(item.id, !!item.deferred); }}
          onAddSubItem={() => {
            setActionsOpen(false);
            if (!isSelected) { onSelect(item.id, depth); }
            setAddingToItemId(item.id);
          }}
          onDelete={() => { setActionsOpen(false); ctx.onDelete(item.id); }}
          onMouseEnter={cancelCloseActions}
          onMouseLeave={scheduleCloseActions}
        />
      )}

      {/* Agent picker panel */}
      {agentPickerOpen && (
        <ItemAgentPickerPanel
          panelRef={agentPickerRef}
          pos={agentPickerPos}
          agents={agents}
          currentAgentId={item.agentId}
          onAssign={agentId => { ctx.onAssignAgent(item.id, agentId); setAgentPickerOpen(false); }}
        />
      )}

      {/* Context dialog */}
      <Dialog.Root open={contextOpen} onOpenChange={setContextOpen}>
        <TaskContextDialog
          open={contextOpen}
          onOpenChange={setContextOpen}
          item={item}
          section={ctx.section}
          ancestors={contextAncestors}
          allSections={data.sections}
          cycleDeadline={data.cycleDeadline}
          onUpdateContext={newCtx => ctx.onUpdate(item.id, { context: newCtx })}
          onLaunchAI={() => {
            setContextOpen(false);
            handleLaunchAI();
          }}
        />
      </Dialog.Root>
    </div>
  );
});

// --- SortableMillerColumnItem ---

const SortableMillerColumnItem = memo(function SortableMillerColumnItem({
  item,
  depth,
  sectionItems,
}: {
  item: TreeItem;
  depth: number;
  sectionItems: TreeItem[];
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });

  const style = useMemo(() => ({
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    position: 'relative' as const,
    zIndex: isDragging ? 10 : undefined,
  }), [transform, transition, isDragging]);

  return (
    <div ref={setNodeRef} style={style} {...attributes} className="flex items-stretch">
      <button
        className="flex items-center px-0.5 cursor-grab active:cursor-grabbing text-zinc-300 hover:text-zinc-500 opacity-0 group-hover/col:opacity-100 transition-opacity shrink-0"
        {...listeners}
      >
        <GripVertical className="w-3 h-3" />
      </button>
      <div className="flex-1 min-w-0">
        <MillerColumnItem item={item} depth={depth} sectionItems={sectionItems} />
      </div>
    </div>
  );
});

// --- MillerColumn ---

const MillerColumn = memo(function MillerColumn({
  items,
  depth,
  parentItemId,
  sectionItems,
}: {
  items: TreeItem[];
  depth: number;
  parentItemId: string | null;
  sectionItems: TreeItem[];
}) {
  const ctx = useContext(ItemActionsContext);
  const { addingToItemId, setAddingToItemId } = useContext(MillerSelectionContext);
  const { showDeferred, actions } = useFlowData();
  const t = useTranslations();
  const columnRef = useRef<HTMLDivElement>(null);

  const visibleItems = useMemo(
    () => showDeferred ? items : items.filter(i => !i.deferred),
    [items, showDeferred],
  );

  const sortableIds = useMemo(() => visibleItems.map(i => i.id), [visibleItems]);

  const isAddingHere = parentItemId !== null && addingToItemId === parentItemId;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id && parentItemId && ctx) {
      const oldIndex = visibleItems.findIndex(i => i.id === active.id);
      const newIndex = visibleItems.findIndex(i => i.id === over.id);
      if (oldIndex !== -1 && newIndex !== -1) {
        actions.reorderItems(ctx.sectionId, parentItemId, oldIndex, newIndex);
      }
    }
  }, [visibleItems, parentItemId, ctx, actions]);

  // Auto-scroll this column into view when it appears
  useEffect(() => {
    if (columnRef.current) {
      columnRef.current.scrollIntoView({ behavior: 'smooth', inline: 'end', block: 'nearest' });
    }
  }, []);

  return (
    <div
      ref={columnRef}
      className="group/col flex flex-col min-w-[240px] max-w-[320px] w-[280px] shrink-0 border-r border-border/50 last:border-r-0"
    >
      {/* Items */}
      <div className="flex-1 overflow-y-auto">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
            {visibleItems.map(item => (
              <SortableMillerColumnItem
                key={item.id}
                item={item}
                depth={depth}
                sectionItems={sectionItems}
              />
            ))}
          </SortableContext>
        </DndContext>
      </div>

      {/* Add item input at column bottom */}
      <div className="px-3 py-2 border-t border-border/30">
        <AddItemInput
          onAdd={content => {
            if (parentItemId) {
              ctx?.onAddChild(parentItemId, content);
            }
          }}
          onCancel={() => setAddingToItemId(null)}
          placeholder={t('flows.addSubItem')}
          autoFocus={isAddingHere}
        />
      </div>
    </div>
  );
});

// --- Root column (depth 0, adds to section directly) ---

function RootColumn({
  items,
  sectionItems,
}: {
  items: TreeItem[];
  sectionItems: TreeItem[];
}) {
  const t = useTranslations();
  const { showDeferred, actions } = useFlowData();
  const ctx = useContext(ItemActionsContext);

  const visibleItems = showDeferred
    ? items
    : items.filter(i => !i.deferred);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id && ctx) {
      const oldIndex = visibleItems.findIndex(i => i.id === active.id);
      const newIndex = visibleItems.findIndex(i => i.id === over.id);
      if (oldIndex !== -1 && newIndex !== -1) {
        actions.reorderItems(ctx.sectionId, null, oldIndex, newIndex);
      }
    }
  }, [visibleItems, ctx, actions]);

  return (
    <div className="group/col flex flex-col min-w-[240px] max-w-[320px] w-[280px] shrink-0 border-r border-border/50">
      {/* Items */}
      <div className="flex-1 overflow-y-auto">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={visibleItems.map(i => i.id)} strategy={verticalListSortingStrategy}>
            {visibleItems.map(item => (
              <SortableMillerColumnItem
                key={item.id}
                item={item}
                depth={0}
                sectionItems={sectionItems}
              />
            ))}
          </SortableContext>
        </DndContext>
      </div>

      {/* Add root item */}
      <div className="px-3 py-2 border-t border-border/30">
        <AddItemInput
          onAdd={content => {
            if (ctx) {
              // Use the actions from FlowData context to add at section root
              actions.addItem(ctx.sectionId, content);
            }
          }}
          placeholder={t('flows.addItem')}
        />
      </div>
    </div>
  );
}

// --- MillerColumnsContainer ---

function MillerColumnsContainer({
  items,
  allItems,
}: {
  items: TreeItem[];
  allItems: TreeItem[];
}) {
  const { selectionPath, addingToItemId } = useContext(MillerSelectionContext);

  // Compute columns from selection path
  const columns = useMemo(() => {
    const cols: { items: TreeItem[]; parentItemId: string | null }[] = [];
    // Columns beyond depth 0 are driven by selection
    let currentItems = items;
    for (let d = 0; d < selectionPath.length; d++) {
      const selectedId = selectionPath[d];
      const selectedItem = currentItems.find(i => i.id === selectedId);
      if (selectedItem?.children?.length) {
        cols.push({ items: selectedItem.children, parentItemId: selectedItem.id });
        currentItems = selectedItem.children;
      } else if (selectedItem && addingToItemId === selectedItem.id) {
        // No children yet but user wants to add — show empty column with input
        cols.push({ items: [], parentItemId: selectedItem.id });
        break;
      } else {
        break;
      }
    }
    return cols;
  }, [items, selectionPath, addingToItemId]);

  return (
    <div className="flex overflow-x-auto miller-scroll">
      {/* Root column (depth 0) */}
      <RootColumn items={items} sectionItems={allItems} />

      {/* Child columns */}
      {columns.map((col, idx) => (
        <MillerColumn
          key={selectionPath[idx]}
          items={col.items}
          depth={idx + 1}
          parentItemId={col.parentItemId}
          sectionItems={allItems}
        />
      ))}
    </div>
  );
}

// --- MillerSectionBlock ---

export function MillerSectionBlock({ section }: { section: Section }) {
  const t = useTranslations();
  const { projectKey, projectName, data, actions, agents, showDeferred, highlightTarget, aiStatusMap, batchMode, selectedItems, clearSelection, batchDelete, batchDefer, batchUpdateStatus, searchText, statusFilter } = useFlowData();
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(true);
  const [selectionPath, setSelectionPath] = useState<string[]>([]);
  const [addingToItemId, setAddingToItemId] = useState<string | null>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const filterDeferred = !showDeferred;

  // Filtered items for search/status
  const filteredItems = useMemo(
    () => filterTreeItems(section.items, searchText, statusFilter, showDeferred),
    [section.items, searchText, statusFilter, showDeferred],
  );

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

      // Scroll into view
      requestAnimationFrame(() => {
        sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });

      // Auto-set selection path to navigate to highlighted item
      if (highlightTarget.itemId) {
        const path = getAncestorPath(section.items, highlightTarget.itemId);
        if (path) {
          setSelectionPath(path);
        }
      }
    }
  }, [highlightTarget, section.id, section.items]);

  const toggleOpen = (open: boolean) => {
    setIsOpen(open);
    sessionStorage.setItem(`section-open:${section.id}`, open ? '1' : '0');
  };

  const handleSelect = useCallback((itemId: string, depth: number) => {
    setSelectionPath(prev => {
      const next = prev.slice(0, depth);
      // If clicking the already-selected item, deselect it
      if (prev[depth] === itemId) {
        return next;
      }
      next.push(itemId);
      return next;
    });
  }, []);

  // Clean up selection path when items change (e.g. deleted item)
  useEffect(() => {
    setSelectionPath(prev => {
      let current = section.items;
      const validated: string[] = [];
      for (const id of prev) {
        const found = current.find(i => i.id === id);
        if (!found) break;
        validated.push(id);
        current = found.children ?? [];
      }
      if (validated.length !== prev.length) return validated;
      return prev;
    });
  }, [section.items]);

  // Stats
  const { done: doneCount, total: totalCount } = countDone(section.items, filterDeferred);
  const sectionStatus: Status =
    totalCount === 0 ? 'todo' : doneCount === totalCount ? 'done' : doneCount > 0 ? 'doing' : 'todo';

  // AI launch handler
  const handleLaunchAI = useCallback(async (item: TreeItem, ancestors: TreeItem[]) => {
    try {
      const lookupRes = await fetch(`/api/tasks?flowTaskId=${item.id}`);
      if (lookupRes.ok) {
        const { session: existing } = await lookupRes.json();
        if (existing) {
          router.push(`/tasks/${existing.id}`);
          return;
        }
      }
    } catch {
      // fall through
    }

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

    const res = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: item.content,
        projectKey,
        flowContext,
        ...(item.agentId && { agentId: item.agentId }),
      }),
    });

    if (res.ok) {
      const session = await res.json();
      router.push(`/tasks/${session.id}`);
    }
  }, [projectKey, projectName, section, data.sections, data.cycleDeadline, router]);

  const itemActions: ItemActionsCtx = useMemo(() => ({
    sectionId: section.id,
    section,
    onToggleStatus: (itemId: string) => {
      const found = findItemById(section.items, itemId);
      if (found) {
        actions.updateItem(section.id, itemId, { status: nextStatus[found.status] });
      }
    },
    onUpdate: (itemId: string, patch: Partial<TreeItem>) => actions.updateItem(section.id, itemId, patch),
    onDelete: (itemId: string) => actions.deleteItem(section.id, itemId),
    onAddChild: (parentItemId: string, content: string) => actions.addItem(section.id, content, parentItemId),
    onToggleDefer: (itemId: string, currentDeferred: boolean) =>
      actions.updateItem(section.id, itemId, { deferred: !currentDeferred }),
    onLaunchAI: handleLaunchAI,
    agents,
    onAssignAgent: (itemId: string, agentId: string | null) =>
      actions.updateItem(section.id, itemId, { agentId: agentId ?? undefined }),
  }), [section, actions, agents, handleLaunchAI]);

  const isSectionHighlighted =
    highlightTarget?.sectionId === section.id && !highlightTarget?.itemId;

  return (
    <section
      ref={sectionRef}
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

      {/* Batch operation toolbar */}
      {isOpen && batchMode && selectedItems.size > 0 && (
        <div className="border-x border-border bg-purple-50/50 px-4 py-2 flex items-center gap-2 dark:bg-purple-950/20">
          <span className="text-sm text-purple-700 dark:text-purple-300">
            {t('flows.selectedItems', { count: selectedItems.size })}
          </span>
          <button
            className="text-xs px-2 py-1 rounded bg-red-500 text-white hover:bg-red-600 transition-colors"
            onClick={() => batchDelete(section.id)}
          >
            {t('flows.batchDelete')}
          </button>
          <button
            className="text-xs px-2 py-1 rounded bg-blue-500 text-white hover:bg-blue-600 transition-colors"
            onClick={() => batchDefer(section.id, true)}
          >
            {t('flows.batchDefer')}
          </button>
          <button
            className="text-xs px-2 py-1 rounded bg-green-500 text-white hover:bg-green-600 transition-colors"
            onClick={() => batchDefer(section.id, false)}
          >
            {t('flows.batchUndefer')}
          </button>
          <button
            className="text-xs px-2 py-1 rounded bg-emerald-500 text-white hover:bg-emerald-600 transition-colors"
            onClick={() => batchUpdateStatus(section.id, 'done')}
          >
            {t('flows.batchMarkDone')}
          </button>
          <button
            className="text-xs px-2 py-1 rounded bg-amber-500 text-white hover:bg-amber-600 transition-colors"
            onClick={() => batchUpdateStatus(section.id, 'doing')}
          >
            {t('flows.batchMarkDoing')}
          </button>
          <button
            className="text-xs px-2 py-1 rounded bg-zinc-400 text-white hover:bg-zinc-500 transition-colors"
            onClick={() => batchUpdateStatus(section.id, 'todo')}
          >
            {t('flows.batchMarkTodo')}
          </button>
          <button
            className="ml-auto text-xs px-2 py-1 rounded border border-zinc-300 dark:border-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            onClick={clearSelection}
          >
            {t('flows.clearSelection')}
          </button>
        </div>
      )}

      {/* Section body — Miller Columns */}
      {isOpen && (
        <div className={`border-x border-b border-border rounded-b-lg overflow-hidden ${batchMode && selectedItems.size > 0 ? '' : ''}`}>
          <ItemActionsContext.Provider value={itemActions}>
            <MillerSelectionContext.Provider
              value={{ selectionPath, onSelect: handleSelect, addingToItemId, setAddingToItemId }}
            >
              <MillerColumnsContainer items={filteredItems} allItems={section.items} />
            </MillerSelectionContext.Provider>
          </ItemActionsContext.Provider>
        </div>
      )}

      {/* Collapsed summary */}
      {!isOpen && filteredItems.length > 0 && (
        <div className="flex flex-wrap gap-3 py-2.5 px-4 border-x border-b border-border rounded-b-lg">
          {filteredItems
            .map(item => {
              const s = getEffectiveStatus(item, filterDeferred);
              const ai = aiStatusMap[item.id];
              return (
                <div key={item.id} className={`flex items-center gap-1.5 ${item.deferred ? 'opacity-40' : ''}`}>
                  <StatusIcon status={s} />
                  <span className={`text-xs ${s === 'done' ? 'text-muted-foreground' : 'text-foreground'}`}>
                    {item.content || t('flows.unnamed')}
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
