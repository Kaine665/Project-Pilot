'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslations } from '@/client/i18n/use-translations';
import * as Dialog from '@radix-ui/react-dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  X,
  Sparkles,
  Plus,
  Trash2,
  Layers,
  GitBranch,
  Users,
  LayoutGrid,
  CalendarDays,
  FileText,
  StickyNote,
  FolderOpen,
} from 'lucide-react';
import { genId } from '@/lib/flow-tree-helpers';
import type {
  TreeItem,
  Section,
  ContextItem,
} from '@/types/flow';
import type {
  AncestorBrief,
  SiblingBrief,
  SectionBrief,
} from '@/types/flow-context';
import type { DocEntry } from '@/types/index';

// --- Auto-collected category definitions ---

const AUTO_CATEGORIES = ['section', 'ancestors', 'siblings', 'otherSections', 'cycleDeadline'] as const;
type AutoCategory = typeof AUTO_CATEGORIES[number];

const CATEGORY_ICONS: Record<AutoCategory, React.ComponentType<{ className?: string }>> = {
  section: Layers,
  ancestors: GitBranch,
  siblings: Users,
  otherSections: LayoutGrid,
  cycleDeadline: CalendarDays,
};

// --- Preview computation ---

interface AutoContextPreview {
  section: { name: string; description?: string };
  ancestors: AncestorBrief[];
  siblings: SiblingBrief[];
  otherSections: SectionBrief[];
  cycleDeadline?: string;
}

function computeAutoPreview(
  item: TreeItem,
  section: Section,
  ancestors: TreeItem[],
  allSections: Section[],
  cycleDeadline?: string,
): AutoContextPreview {
  const parent = ancestors.length > 0 ? ancestors[ancestors.length - 1] : null;
  const siblingSource = parent ? (parent.children ?? []) : section.items;

  return {
    section: { name: section.name, description: section.description },
    ancestors: ancestors.map(a => ({
      id: a.id,
      content: a.content,
      description: a.description,
      status: a.status,
    })),
    siblings: siblingSource
      .filter(i => i.id !== item.id)
      .map(i => ({ content: i.content, status: i.status })),
    otherSections: allSections
      .filter(s => s.id !== section.id)
      .map(s => ({ name: s.name, description: s.description })),
    cycleDeadline,
  };
}

function getCategoryPreviewText(
  category: AutoCategory,
  preview: AutoContextPreview,
  t: ReturnType<typeof useTranslations>,
): string {
  switch (category) {
    case 'section':
      return preview.section.description
        ? `${preview.section.name}（${preview.section.description}）`
        : preview.section.name;
    case 'ancestors':
      return preview.ancestors.length > 0
        ? preview.ancestors.map(a => a.content).join(' → ')
        : t('contextNoData');
    case 'siblings':
      return preview.siblings.length > 0
        ? t('contextItemCount', { count: preview.siblings.length })
        : t('contextNoData');
    case 'otherSections':
      return preview.otherSections.length > 0
        ? t('contextItemCount', { count: preview.otherSections.length })
        : t('contextNoData');
    case 'cycleDeadline':
      return preview.cycleDeadline ?? t('contextNoData');
  }
}

// --- Toggle switch ---

function Toggle({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      className={`relative w-8 h-[18px] rounded-full transition-colors shrink-0 ${
        enabled ? 'bg-emerald-500' : 'bg-zinc-300 dark:bg-zinc-600'
      }`}
      onClick={() => onChange(!enabled)}
    >
      <span
        className={`absolute top-[2px] block w-[14px] h-[14px] rounded-full bg-white shadow transition-transform ${
          enabled ? 'left-[15px]' : 'left-[2px]'
        }`}
      />
    </button>
  );
}

// --- Props ---

interface TaskContextDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: TreeItem;
  section: Section;
  ancestors: TreeItem[];
  allSections: Section[];
  cycleDeadline?: string;
  onUpdateContext: (context: TreeItem['context']) => void;
  onLaunchAI: () => void;
}

export function TaskContextDialog({
  open,
  onOpenChange,
  item,
  section,
  ancestors,
  allSections,
  cycleDeadline,
  onUpdateContext,
  onLaunchAI,
}: TaskContextDialogProps) {
  const t = useTranslations('flows');
  const tActions = useTranslations('actions');

  const [excludes, setExcludes] = useState<string[]>([]);
  const [customItems, setCustomItems] = useState<ContextItem[]>([]);
  const [globalContextIds, setGlobalContextIds] = useState<string[]>([]);
  const [globalEntries, setGlobalEntries] = useState<DocEntry[]>([]);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Add/edit form state
  const [formType, setFormType] = useState<'text' | 'file'>('text');
  const [formLabel, setFormLabel] = useState('');
  const [formContent, setFormContent] = useState('');

  // Sync from item.context when dialog opens + fetch global entries
  useEffect(() => {
    if (open) {
      setExcludes(item.context?.excludes ?? []);
      setCustomItems(item.context?.items ?? []);
      setGlobalContextIds(item.context?.globalContextIds ?? []);
      setAdding(false);
      setEditingId(null);
      setFormType('text');
      setFormLabel('');
      setFormContent('');

      fetch('/api/docs?documentKind=knowledge')
        .then(r => (r.ok ? r.json() : { docs: [] }))
        .then((data: { docs?: DocEntry[] }) =>
          setGlobalEntries(
            (data.docs ?? []).filter(e => !e.status || e.status === 'active'),
          ),
        )
        .catch(() => setGlobalEntries([]));
    }
  }, [open, item.context]);

  const preview = useMemo(
    () => computeAutoPreview(item, section, ancestors, allSections, cycleDeadline),
    [item, section, ancestors, allSections, cycleDeadline],
  );

  const persist = useCallback(
    (newExcludes: string[], newItems: ContextItem[], newGlobalIds: string[]) => {
      const ctx: TreeItem['context'] =
        newExcludes.length === 0 && newItems.length === 0 && newGlobalIds.length === 0
          ? undefined
          : {
              ...(newExcludes.length > 0 ? { excludes: newExcludes } : {}),
              ...(newItems.length > 0 ? { items: newItems } : {}),
              ...(newGlobalIds.length > 0 ? { globalContextIds: newGlobalIds } : {}),
            };
      onUpdateContext(ctx);
    },
    [onUpdateContext],
  );

  const toggleCategory = useCallback(
    (key: string) => {
      const next = excludes.includes(key)
        ? excludes.filter(k => k !== key)
        : [...excludes, key];
      setExcludes(next);
      persist(next, customItems, globalContextIds);
    },
    [excludes, customItems, globalContextIds, persist],
  );

  const toggleGlobalContext = useCallback(
    (id: string) => {
      const next = globalContextIds.includes(id)
        ? globalContextIds.filter(gid => gid !== id)
        : [...globalContextIds, id];
      setGlobalContextIds(next);
      persist(excludes, customItems, next);
    },
    [globalContextIds, excludes, customItems, persist],
  );

  const handleAddItem = useCallback(() => {
    const label = formLabel.trim();
    const content = formContent.trim();
    if (!label || !content) return;

    const newItem: ContextItem = {
      id: genId(),
      type: formType,
      label,
      content,
    };
    const next = [...customItems, newItem];
    setCustomItems(next);
    persist(excludes, next, globalContextIds);
    setFormLabel('');
    setFormContent('');
    setFormType('text');
    setAdding(false);
  }, [formLabel, formContent, formType, customItems, excludes, globalContextIds, persist]);

  const handleUpdateItem = useCallback(() => {
    if (!editingId) return;
    const label = formLabel.trim();
    const content = formContent.trim();
    if (!label || !content) return;

    const next = customItems.map(ci =>
      ci.id === editingId ? { ...ci, type: formType, label, content } : ci,
    );
    setCustomItems(next);
    persist(excludes, next, globalContextIds);
    setEditingId(null);
    setFormLabel('');
    setFormContent('');
    setFormType('text');
  }, [editingId, formLabel, formContent, formType, customItems, excludes, globalContextIds, persist]);

  const handleDeleteItem = useCallback(
    (id: string) => {
      const next = customItems.filter(ci => ci.id !== id);
      setCustomItems(next);
      persist(excludes, next, globalContextIds);
    },
    [customItems, excludes, globalContextIds, persist],
  );

  const startEdit = useCallback((ci: ContextItem) => {
    setEditingId(ci.id);
    setFormType(ci.type);
    setFormLabel(ci.label);
    setFormContent(ci.content);
    setAdding(false);
  }, []);

  const cancelForm = useCallback(() => {
    setAdding(false);
    setEditingId(null);
    setFormLabel('');
    setFormContent('');
    setFormType('text');
  }, []);

  const isFormActive = adding || editingId !== null;

  return (
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
      <Dialog.Content className="fixed top-1/2 left-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-800 dark:bg-zinc-950 flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-3">
          <Dialog.Title className="text-lg font-semibold">{t('taskContextTitle')}</Dialog.Title>
          <Dialog.Close asChild>
            <button className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300">
              <X className="h-4 w-4" />
            </button>
          </Dialog.Close>
        </div>

        {/* Task name preview */}
        <div className="px-6 pb-3">
          <p className="text-sm text-muted-foreground truncate">{item.content}</p>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6">
          {/* Auto-collected context */}
          <div className="mb-4">
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
              {t('autoContext')}
            </h3>
            <div className="flex flex-col gap-1">
              {AUTO_CATEGORIES.map(key => {
                const Icon = CATEGORY_ICONS[key];
                const enabled = !excludes.includes(key);
                const previewText = getCategoryPreviewText(key, preview, t);

                return (
                  <div
                    key={key}
                    className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <Icon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      <span className="text-sm font-medium shrink-0">
                        {t(`contextCategories.${key}`)}
                      </span>
                      <span className={`text-xs truncate ${enabled ? 'text-muted-foreground' : 'text-muted-foreground/40 line-through'}`}>
                        {previewText}
                      </span>
                    </div>
                    <Toggle enabled={enabled} onChange={() => toggleCategory(key)} />
                  </div>
                );
              })}
            </div>
          </div>

          {/* Divider */}
          <div className="border-t border-zinc-200 dark:border-zinc-800 my-3" />

          {/* 全局知识文档（documents，documentKind=knowledge） */}
          <div className="mb-4">
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
              {t('globalContext')}
            </h3>
            {globalEntries.length > 0 ? (
              <div className="flex flex-col gap-1">
                {/* Grouped entries */}
                {(() => {
                  const groups = [...new Set(globalEntries.map(e => e.category).filter((g): g is string => !!g))].sort();
                  const ungrouped = globalEntries.filter(e => !e.category);
                  return (
                    <>
                      {groups.map(group => {
                        const groupEntries = globalEntries.filter(e => e.category === group);
                        return (
                          <div key={group}>
                            <div className="flex items-center gap-1.5 px-2 pt-1.5 pb-0.5">
                              <FolderOpen className="w-3 h-3 text-muted-foreground/60" />
                              <span className="text-xs font-medium text-muted-foreground/70">{group}</span>
                            </div>
                            {groupEntries.map(entry => {
                              const enabled = globalContextIds.includes(entry.id);
                              return (
                                <div
                                  key={entry.id}
                                  className="flex items-center justify-between py-1.5 pl-7 pr-2 rounded hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
                                >
                                  <div className="flex items-center gap-2 min-w-0 flex-1">
                                    <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                                    <span className="text-sm font-medium shrink-0">{entry.title}</span>
                                    <span className={`text-xs truncate ${enabled ? 'text-muted-foreground' : 'text-muted-foreground/40'}`}>
                                      {entry.description}
                                    </span>
                                  </div>
                                  <Toggle enabled={enabled} onChange={() => toggleGlobalContext(entry.id)} />
                                </div>
                              );
                            })}
                          </div>
                        );
                      })}
                      {ungrouped.map(entry => {
                        const enabled = globalContextIds.includes(entry.id);
                        return (
                          <div
                            key={entry.id}
                            className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
                          >
                            <div className="flex items-center gap-2 min-w-0 flex-1">
                              <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                              <span className="text-sm font-medium shrink-0">{entry.title}</span>
                              <span className={`text-xs truncate ${enabled ? 'text-muted-foreground' : 'text-muted-foreground/40'}`}>
                                {entry.description}
                              </span>
                            </div>
                            <Toggle enabled={enabled} onChange={() => toggleGlobalContext(entry.id)} />
                          </div>
                        );
                      })}
                    </>
                  );
                })()}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground px-2 py-1.5">
                {t('globalContextEmpty')}
              </p>
            )}
          </div>

          {/* Divider */}
          <div className="border-t border-zinc-200 dark:border-zinc-800 my-3" />

          {/* Custom context */}
          <div className="mb-4">
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
              {t('customContext')}
            </h3>

            {/* Existing custom items */}
            {customItems.length > 0 && (
              <div className="flex flex-col gap-1 mb-2">
                {customItems.map(ci => (
                  <div
                    key={ci.id}
                    className="group flex items-start gap-2 py-1.5 px-2 rounded hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
                  >
                    {ci.type === 'file' ? (
                      <FileText className="w-3.5 h-3.5 text-blue-500 shrink-0 mt-0.5" />
                    ) : (
                      <StickyNote className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                    )}
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium">{ci.label}</span>
                      <p className="text-xs text-muted-foreground truncate">{ci.content}</p>
                    </div>
                    <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 shrink-0 transition-opacity">
                      <button
                        className="p-0.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-muted-foreground hover:text-foreground transition-colors"
                        onClick={() => startEdit(ci)}
                      >
                        <StickyNote className="w-3 h-3" />
                      </button>
                      <button
                        className="p-0.5 rounded hover:bg-red-50 dark:hover:bg-red-950/30 text-muted-foreground hover:text-red-500 transition-colors"
                        onClick={() => handleDeleteItem(ci.id)}
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Add/Edit form */}
            {isFormActive ? (
              <div className="rounded-md border border-zinc-200 dark:border-zinc-700 p-3 space-y-2">
                {/* Type selector */}
                <div className="flex gap-1">
                  <button
                    className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors ${
                      formType === 'text'
                        ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                        : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700'
                    }`}
                    onClick={() => setFormType('text')}
                  >
                    <StickyNote className="w-3 h-3" />
                    {t('contextTypeNote')}
                  </button>
                  <button
                    className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors ${
                      formType === 'file'
                        ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                        : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700'
                    }`}
                    onClick={() => setFormType('file')}
                  >
                    <FileText className="w-3 h-3" />
                    {t('contextTypeFile')}
                  </button>
                </div>

                <Input
                  value={formLabel}
                  onChange={e => setFormLabel(e.target.value)}
                  placeholder={t('contextLabelPlaceholder')}
                  className="text-sm"
                />
                <Textarea
                  value={formContent}
                  onChange={e => setFormContent(e.target.value)}
                  placeholder={t('contextContentPlaceholder')}
                  rows={3}
                  className="text-sm resize-none"
                />
                <div className="flex gap-2 justify-end">
                  <button
                    onClick={cancelForm}
                    className="px-3 py-1 rounded text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                  >
                    {tActions('cancel')}
                  </button>
                  <button
                    onClick={editingId ? handleUpdateItem : handleAddItem}
                    disabled={!formLabel.trim() || !formContent.trim()}
                    className="px-3 py-1 rounded text-xs font-medium bg-zinc-900 text-white hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                  >
                    {tActions('save')}
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setAdding(true)}
                className="flex items-center gap-1.5 px-2 py-1.5 rounded text-sm text-muted-foreground hover:bg-zinc-50 hover:text-foreground dark:hover:bg-zinc-800/50 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                {t('addContextItem')}
              </button>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-zinc-200 dark:border-zinc-800">
          <button
            onClick={onLaunchAI}
            className="w-full flex items-center justify-center gap-2 rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 transition-colors"
          >
            <Sparkles className="w-4 h-4" />
            {t('launchAIWithContext')}
          </button>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  );
}
