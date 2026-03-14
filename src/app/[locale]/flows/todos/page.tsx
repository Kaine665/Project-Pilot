'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import {
  AlertCircle,
  Bot,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  Clock,
  ExternalLink,
  Inbox,
  LayoutDashboard,
  List,
  Plus,
  Search,
  Tag,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import { useLocale } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useProject } from '@/components/project-context';
import type { Agent, TodoItem, TodoPriority, TodoStatus, TodoSubTask } from '@/types';

// ─── Constants ──────────────────────────────────────────────────────────────

type ViewMode = 'kanban' | 'today' | 'upcoming' | 'all' | 'done';
const statusOrder: TodoStatus[] = ['pending', 'in_progress', 'done'];
const priorityOrder: TodoPriority[] = ['high', 'medium', 'low'];

const statusMeta: Record<TodoStatus, { label: string; dot: string; chip: string; text: string; colHead: string; countBg: string }> = {
  pending: {
    label: '待办',
    dot: 'bg-zinc-400',
    chip: 'bg-zinc-100 border-zinc-200 text-zinc-700',
    text: 'text-zinc-700',
    colHead: 'text-zinc-500',
    countBg: 'bg-zinc-200/70 text-zinc-600',
  },
  in_progress: {
    label: '进行中',
    dot: 'bg-blue-500',
    chip: 'bg-blue-50 border-blue-100 text-blue-700',
    text: 'text-blue-700',
    colHead: 'text-blue-600',
    countBg: 'bg-blue-100 text-blue-600',
  },
  done: {
    label: '已完成',
    dot: 'bg-green-500',
    chip: 'bg-green-50 border-green-100 text-green-700',
    text: 'text-green-700',
    colHead: 'text-green-600',
    countBg: 'bg-green-100 text-green-600',
  },
};

const priorityMeta: Record<TodoPriority, { label: string; dot: string; chip: string; text: string }> = {
  high: { label: '高', dot: 'bg-red-500', chip: 'bg-red-50 border-red-100', text: 'text-red-700' },
  medium: { label: '中', dot: 'bg-amber-400', chip: 'bg-amber-50 border-amber-100', text: 'text-amber-700' },
  low: { label: '低', dot: 'bg-blue-400', chip: 'bg-blue-50 border-blue-100', text: 'text-blue-700' },
};

const viewMeta: { id: ViewMode; label: string; icon: React.ReactNode }[] = [
  { id: 'today', label: '今天', icon: <Clock className="h-3.5 w-3.5" /> },
  { id: 'upcoming', label: '即将', icon: <Calendar className="h-3.5 w-3.5" /> },
  { id: 'kanban', label: '看板', icon: <LayoutDashboard className="h-3.5 w-3.5" /> },
  { id: 'all', label: '全部', icon: <List className="h-3.5 w-3.5" /> },
  { id: 'done', label: '已完成', icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isToday(dateStr?: string) {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

function isOverdue(dateStr?: string) {
  if (!dateStr) return false;
  return new Date(dateStr) < new Date(new Date().setHours(0, 0, 0, 0));
}

function isWithinDays(dateStr?: string, days: number = 7) {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const now = new Date();
  const future = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  return d > now && d <= future;
}

function fmtDate(iso?: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

function fmtDateTime(iso?: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric' });
}

// ─── Draft interfaces ────────────────────────────────────────────────────────

interface TodoDraft {
  title: string;
  description: string;
  status: TodoStatus;
  priority: TodoPriority;
  agentId: string;
  dueAt: string;
  tags: string[];
  subTasks: TodoSubTask[];
}

const emptyDraft = (overrides?: Partial<TodoDraft>): TodoDraft => ({
  title: '',
  description: '',
  status: 'pending',
  priority: 'medium',
  agentId: '',
  dueAt: '',
  tags: [],
  subTasks: [],
  ...overrides,
});

// ─── DraggableCard ──────────────────────────────────────────────────────────

interface DraggableCardProps {
  task: TodoItem;
  agentMap: Map<string, Agent>;
  onClick: () => void;
  overlay?: boolean;
}

function DraggableCard({ task, agentMap, onClick, overlay }: DraggableCardProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: task.id });
  const style = transform ? { transform: CSS.Translate.toString(transform) } : undefined;
  const overdue = isOverdue(task.dueAt) && task.status !== 'done';
  const agent = task.agentId ? agentMap.get(task.agentId) : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={[
        'group relative cursor-pointer rounded-2xl border bg-white px-4 py-3.5 shadow-sm transition select-none',
        'dark:bg-zinc-900',
        isDragging || overlay
          ? 'opacity-50 border-blue-300 dark:border-blue-700 shadow-lg'
          : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 hover:shadow-md',
      ].join(' ')}
    >
      {/* Priority + status dots */}
      <div className="mb-2.5 flex items-center gap-1.5">
        <span className={`inline-block h-2 w-2 rounded-full ${priorityMeta[task.priority].dot}`} />
        <span className={`inline-block h-2 w-2 rounded-full ${statusMeta[task.status].dot}`} />
        {overdue && <AlertCircle className="h-3 w-3 text-red-500" />}
        {task.subTasks && task.subTasks.length > 0 && (
          <span className="ml-auto text-[10px] text-zinc-400">
            {task.subTasks.filter(s => s.done).length}/{task.subTasks.length}
          </span>
        )}
      </div>

      {/* Title */}
      <p className={`text-sm font-medium leading-snug ${task.status === 'done' ? 'line-through text-zinc-400' : 'text-zinc-900 dark:text-zinc-100'}`}>
        {task.title}
      </p>

      {/* Tags */}
      {task.tags && task.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {task.tags.slice(0, 3).map(tag => (
            <span key={tag} className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Footer */}
      <div className="mt-3 flex items-center gap-2">
        {agent && (
          <div className="flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 dark:bg-zinc-800">
            <Bot className="h-3 w-3 text-zinc-400" />
            <span className="max-w-[80px] truncate text-[10px] text-zinc-500 dark:text-zinc-400">{agent.name}</span>
          </div>
        )}
        {task.dueAt && (
          <div className={`ml-auto flex items-center gap-1 text-[10px] ${overdue ? 'text-red-500' : 'text-zinc-400'}`}>
            <Calendar className="h-3 w-3" />
            <span>{fmtDate(task.dueAt)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── DroppableColumn ─────────────────────────────────────────────────────────

interface DroppableColumnProps {
  status: TodoStatus;
  tasks: TodoItem[];
  agentMap: Map<string, Agent>;
  onCardClick: (task: TodoItem) => void;
  onAddClick: () => void;
}

function DroppableColumn({ status, tasks, agentMap, onCardClick, onAddClick }: DroppableColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const meta = statusMeta[status];

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      {/* Column header */}
      <div className="mb-3 flex items-center gap-2 px-1">
        <span className={`h-2 w-2 rounded-full ${meta.dot}`} />
        <span className={`text-xs font-semibold uppercase tracking-wider ${meta.colHead}`}>{meta.label}</span>
        <span className={`ml-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${meta.countBg}`}>{tasks.length}</span>
      </div>

      {/* Cards area */}
      <div
        ref={setNodeRef}
        className={[
          'flex flex-1 flex-col gap-2 rounded-2xl p-2 transition-colors min-h-[120px]',
          isOver ? 'bg-blue-50/60 dark:bg-blue-900/10 ring-2 ring-blue-200 dark:ring-blue-800' : 'bg-zinc-50/60 dark:bg-zinc-900/30',
        ].join(' ')}
      >
        {tasks.map(task => (
          <DraggableCard key={task.id} task={task} agentMap={agentMap} onClick={() => onCardClick(task)} />
        ))}
        {tasks.length === 0 && (
          <div className="flex flex-1 items-center justify-center rounded-2xl border border-dashed border-zinc-200 py-8 text-xs text-zinc-300 dark:border-zinc-800 dark:text-zinc-600">
            拖入此列
          </div>
        )}

        {/* Add button at bottom */}
        <button
          type="button"
          onClick={onAddClick}
          className="flex items-center justify-center gap-1.5 rounded-2xl border border-dashed border-zinc-300 py-3 text-xs font-medium text-zinc-400 transition hover:border-zinc-400 hover:text-zinc-600 dark:border-zinc-700 dark:hover:border-zinc-600 dark:hover:text-zinc-300"
        >
          <Plus className="h-3.5 w-3.5" />
          添加任务
        </button>
      </div>
    </section>
  );
}

// ─── TaskCard (flat list view) ────────────────────────────────────────────────

interface FlatTaskCardProps {
  task: TodoItem;
  agentMap: Map<string, Agent>;
  onClick: () => void;
}

function FlatTaskCard({ task, agentMap, onClick }: FlatTaskCardProps) {
  const overdue = isOverdue(task.dueAt) && task.status !== 'done';
  const agent = task.agentId ? agentMap.get(task.agentId) : undefined;

  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full items-start gap-3 rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-left transition hover:border-zinc-300 hover:shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700"
    >
      {/* Status circle */}
      <div className="mt-0.5 shrink-0">
        {task.status === 'done'
          ? <CheckCircle2 className="h-4 w-4 text-green-500" />
          : task.status === 'in_progress'
          ? <Circle className="h-4 w-4 text-blue-500" />
          : <Circle className="h-4 w-4 text-zinc-300" />
        }
      </div>

      <div className="min-w-0 flex-1">
        <p className={`text-sm font-medium leading-snug ${task.status === 'done' ? 'line-through text-zinc-400' : 'text-zinc-900 dark:text-zinc-100'}`}>
          {task.title}
        </p>
        {task.description && (
          <p className="mt-0.5 line-clamp-1 text-xs text-zinc-400">{task.description}</p>
        )}
        {/* Meta row */}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${priorityMeta[task.priority].chip} ${priorityMeta[task.priority].text}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${priorityMeta[task.priority].dot}`} />
            {priorityMeta[task.priority].label}
          </span>
          {agent && (
            <span className="flex items-center gap-1 text-[10px] text-zinc-400">
              <Bot className="h-3 w-3" />
              {agent.name}
            </span>
          )}
          {task.dueAt && (
            <span className={`flex items-center gap-1 text-[10px] ${overdue ? 'text-red-500' : 'text-zinc-400'}`}>
              {overdue && <AlertCircle className="h-3 w-3" />}
              <Calendar className="h-3 w-3" />
              {fmtDate(task.dueAt)}
            </span>
          )}
          {task.tags && task.tags.slice(0, 2).map(tag => (
            <span key={tag} className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">{tag}</span>
          ))}
          {task.subTasks && task.subTasks.length > 0 && (
            <span className="text-[10px] text-zinc-400">
              {task.subTasks.filter(s => s.done).length}/{task.subTasks.length} 子任务
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

// ─── TaskDrawer ───────────────────────────────────────────────────────────────

interface TaskDrawerProps {
  mode: 'create' | 'edit';
  draft: TodoDraft;
  task?: TodoItem;
  agents: Agent[];
  agentMap: Map<string, Agent>;
  saving: boolean;
  onDraftChange: (d: Partial<TodoDraft>) => void;
  onSave: () => void;
  onDelete?: () => void;
  onClose: () => void;
  onNavigateSession: () => void;
  locale: string;
}

function TaskDrawer({
  mode, draft, task, agents, agentMap, saving,
  onDraftChange, onSave, onDelete, onClose, onNavigateSession, locale,
}: TaskDrawerProps) {
  const [tagInput, setTagInput] = useState('');
  const [newSubTask, setNewSubTask] = useState('');
  const titleRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setTimeout(() => titleRef.current?.focus(), 50);
  }, [mode]);

  function addTag(raw: string) {
    const tag = raw.trim().replace(/^#/, '');
    if (!tag || draft.tags.includes(tag)) return;
    onDraftChange({ tags: [...draft.tags, tag] });
    setTagInput('');
  }

  function removeTag(tag: string) {
    onDraftChange({ tags: draft.tags.filter(t => t !== tag) });
  }

  function addSubTask() {
    const title = newSubTask.trim();
    if (!title) return;
    const st: TodoSubTask = { id: `st-${Date.now()}`, title, done: false };
    onDraftChange({ subTasks: [...draft.subTasks, st] });
    setNewSubTask('');
  }

  function toggleSubTask(id: string) {
    onDraftChange({
      subTasks: draft.subTasks.map(s => s.id === id ? { ...s, done: !s.done } : s),
    });
  }

  function removeSubTask(id: string) {
    onDraftChange({ subTasks: draft.subTasks.filter(s => s.id !== id) });
  }

  const hasSession = mode === 'edit' && task?.sessionId;
  const hasAgent = draft.agentId;
  const donePct = draft.subTasks.length > 0
    ? Math.round(draft.subTasks.filter(s => s.done).length / draft.subTasks.length * 100)
    : 0;

  return (
    <aside className="flex w-[400px] shrink-0 flex-col border-l border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
            <LayoutDashboard className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {mode === 'create' ? '新建任务' : '任务详情'}
            </h2>
            {mode === 'edit' && task && (
              <p className="text-[10px] text-zinc-400">{task.id}</p>
            )}
          </div>
        </div>
        <button type="button" onClick={onClose} className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-900 dark:hover:text-zinc-300">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-5">
        <div className="space-y-6">

          {/* Title */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">任务标题</label>
            <textarea
              ref={titleRef}
              rows={2}
              value={draft.title}
              onChange={e => onDraftChange({ title: e.target.value })}
              placeholder="输入任务标题..."
              className="w-full resize-none border-none bg-transparent p-0 text-lg font-semibold text-zinc-900 outline-none placeholder:text-zinc-300 dark:text-zinc-100 dark:placeholder:text-zinc-600"
            />
          </div>

          {/* Status + Priority row */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">状态</label>
              <div className="flex flex-col gap-1">
                {statusOrder.map(s => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => onDraftChange({ status: s })}
                    className={[
                      'flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition',
                      draft.status === s
                        ? `${statusMeta[s].chip} ring-1 ring-offset-1`
                        : 'border-transparent bg-zinc-50 text-zinc-500 hover:bg-zinc-100 dark:bg-zinc-900 dark:hover:bg-zinc-800',
                    ].join(' ')}
                  >
                    <span className={`h-2 w-2 rounded-full ${statusMeta[s].dot}`} />
                    {statusMeta[s].label}
                    {draft.status === s && <Check className="ml-auto h-3 w-3" />}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">优先级</label>
              <div className="flex flex-col gap-1">
                {priorityOrder.map(p => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => onDraftChange({ priority: p })}
                    className={[
                      'flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition',
                      draft.priority === p
                        ? `${priorityMeta[p].chip} ${priorityMeta[p].text} border-current ring-1 ring-offset-1`
                        : 'border-transparent bg-zinc-50 text-zinc-500 hover:bg-zinc-100 dark:bg-zinc-900 dark:hover:bg-zinc-800',
                    ].join(' ')}
                  >
                    <span className={`h-2 w-2 rounded-full ${priorityMeta[p].dot}`} />
                    {priorityMeta[p].label}
                    {draft.priority === p && <Check className="ml-auto h-3 w-3" />}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Agent */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">负责 Agent</label>
            <div className="relative">
              <Bot className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
              <select
                value={draft.agentId}
                onChange={e => onDraftChange({ agentId: e.target.value })}
                className="w-full appearance-none rounded-lg border border-zinc-200 bg-white py-2 pl-8 pr-8 text-xs text-zinc-700 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
              >
                <option value="">不绑定 Agent</option>
                {agents.map(a => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
            </div>
          </div>

          {/* Due date */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">截止日期</label>
            <input
              type="date"
              value={draft.dueAt ? draft.dueAt.split('T')[0] : ''}
              onChange={e => onDraftChange({ dueAt: e.target.value ? new Date(e.target.value).toISOString() : '' })}
              className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-700 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
            />
          </div>

          {/* Tags */}
          <div className="space-y-2">
            <label className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">标签</label>
            {draft.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {draft.tags.map(tag => (
                  <span key={tag} className="flex items-center gap-1 rounded-full bg-zinc-100 px-2.5 py-1 text-[11px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                    <Tag className="h-3 w-3" />
                    {tag}
                    <button type="button" onClick={() => removeTag(tag)} className="ml-0.5 hover:text-red-500">
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <input
                value={tagInput}
                onChange={e => setTagInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(tagInput); }
                }}
                placeholder="输入标签，回车添加"
                className="flex-1 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-700 placeholder:text-zinc-300 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:placeholder:text-zinc-600"
              />
              <button
                type="button"
                onClick={() => addTag(tagInput)}
                className="rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 text-xs text-zinc-500 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:hover:bg-zinc-700"
              >
                添加
              </button>
            </div>
          </div>

          {/* Sub-tasks */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">子任务</label>
              {draft.subTasks.length > 0 && (
                <span className="text-[10px] text-zinc-400">{donePct}% 完成</span>
              )}
            </div>

            {draft.subTasks.length > 0 && (
              <>
                {/* Progress bar */}
                <div className="h-1 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                  <div className="h-full rounded-full bg-green-500 transition-all" style={{ width: `${donePct}%` }} />
                </div>
                <ul className="space-y-1.5">
                  {draft.subTasks.map(st => (
                    <li key={st.id} className="group flex items-center gap-2.5">
                      <button type="button" onClick={() => toggleSubTask(st.id)} className="shrink-0">
                        {st.done
                          ? <CheckCircle2 className="h-4 w-4 text-green-500" />
                          : <Circle className="h-4 w-4 text-zinc-300 group-hover:text-zinc-400" />
                        }
                      </button>
                      <span className={`flex-1 text-sm ${st.done ? 'line-through text-zinc-400' : 'text-zinc-700 dark:text-zinc-200'}`}>
                        {st.title}
                      </span>
                      <button type="button" onClick={() => removeSubTask(st.id)} className="opacity-0 group-hover:opacity-100 text-zinc-300 hover:text-red-400">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}

            <div className="flex gap-2">
              <input
                value={newSubTask}
                onChange={e => setNewSubTask(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSubTask(); } }}
                placeholder="添加子任务..."
                className="flex-1 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-700 placeholder:text-zinc-300 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:placeholder:text-zinc-600"
              />
              <button
                type="button"
                onClick={addSubTask}
                className="rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 text-xs text-zinc-500 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:hover:bg-zinc-700"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">备注说明</label>
            <textarea
              rows={4}
              value={draft.description}
              onChange={e => onDraftChange({ description: e.target.value })}
              placeholder="记录更多信息..."
              className="w-full resize-none rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700 placeholder:text-zinc-300 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:placeholder:text-zinc-600"
            />
          </div>

          {/* Session link */}
          {mode === 'edit' && (
            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">执行会话</label>
              {hasSession ? (
                <div className="flex items-center gap-3 rounded-xl border border-green-200 bg-green-50 px-3 py-3 dark:border-green-900 dark:bg-green-950/30">
                  <Zap className="h-4 w-4 shrink-0 text-green-500" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-green-700 dark:text-green-400">已关联会话</p>
                    <p className="truncate text-[10px] text-green-600/70 dark:text-green-500/70">{task?.sessionId}</p>
                  </div>
                  <button
                    type="button"
                    onClick={onNavigateSession}
                    className="flex shrink-0 items-center gap-1 rounded-lg bg-green-600 px-2.5 py-1.5 text-xs font-medium text-white transition hover:bg-green-700"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    查看
                  </button>
                </div>
              ) : hasAgent ? (
                <div className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-3 dark:border-zinc-700 dark:bg-zinc-900">
                  <Bot className="h-4 w-4 shrink-0 text-zinc-400" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-zinc-600 dark:text-zinc-300">{agentMap.get(draft.agentId)?.name}</p>
                    <p className="text-[10px] text-zinc-400">尚无关联会话</p>
                  </div>
                  <button
                    type="button"
                    onClick={onNavigateSession}
                    className="flex shrink-0 items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white transition hover:bg-blue-700"
                  >
                    <Zap className="h-3.5 w-3.5" />
                    启动
                  </button>
                </div>
              ) : (
                <p className="text-xs text-zinc-400">绑定 Agent 后可启动执行会话</p>
              )}
            </div>
          )}

          {/* Meta */}
          {mode === 'edit' && task && (
            <div className="space-y-1 border-t border-zinc-100 pt-4 dark:border-zinc-800">
              <div className="flex justify-between text-[10px]">
                <span className="text-zinc-400">创建时间</span>
                <span className="text-zinc-500">{fmtDateTime(task.createdAt)}</span>
              </div>
              <div className="flex justify-between text-[10px]">
                <span className="text-zinc-400">更新时间</span>
                <span className="text-zinc-500">{fmtDateTime(task.updatedAt)}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer actions */}
      <div className="border-t border-zinc-200 px-5 py-4 dark:border-zinc-800">
        <div className="flex gap-2">
          {mode === 'edit' && onDelete && (
            <button
              type="button"
              onClick={onDelete}
              className="flex items-center gap-1.5 rounded-xl border border-red-200 px-3 py-2 text-xs font-medium text-red-500 transition hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950/30"
            >
              <Trash2 className="h-3.5 w-3.5" />
              删除
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl border border-zinc-200 px-3 py-2 text-xs font-medium text-zinc-500 transition hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={!draft.title.trim() || saving}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-zinc-900 px-3 py-2 text-xs font-medium text-white transition hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {saving ? '保存中...' : mode === 'create' ? '创建任务' : '保存修改'}
          </button>
        </div>
      </div>
    </aside>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function TodosPage() {
  const { activeKey: projectKey } = useProject();
  const locale = useLocale();
  const router = useRouter();

  // Data state
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);

  // View + filter state
  const [view, setView] = useState<ViewMode>('kanban');
  const [searchQ, setSearchQ] = useState('');
  const [filterPriority, setFilterPriority] = useState<TodoPriority | 'all'>('all');
  const [filterAgent, setFilterAgent] = useState('');
  const [filterOverdue, setFilterOverdue] = useState(false);

  // Drawer state
  type DrawerMode = 'closed' | 'create' | 'edit';
  const [drawerMode, setDrawerMode] = useState<DrawerMode>('closed');
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [draft, setDraft] = useState<TodoDraft>(emptyDraft());
  const [saving, setSaving] = useState(false);

  // Drag state
  const [dragId, setDragId] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const agentMap = useMemo(() => new Map(agents.map(a => [a.id, a])), [agents]);
  const activeTask = useMemo(() => todos.find(t => t.id === activeTaskId) ?? null, [todos, activeTaskId]);
  const dragTask = useMemo(() => todos.find(t => t.id === dragId) ?? null, [todos, dragId]);

  // ── Fetch data ──────────────────────────────────────────────────────────────

  const fetchTodos = useCallback(async () => {
    const projectParam = projectKey ? `?project=${projectKey}` : '';
    const r = await fetch(`/api/todos${projectParam}`);
    if (r.ok) {
      const data = await r.json();
      setTodos(data.todos ?? []);
    }
  }, [projectKey]);

  const fetchAgents = useCallback(async () => {
    const r = await fetch('/api/agents');
    if (r.ok) {
      const data = await r.json();
      setAgents(data.agents ?? []);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchTodos(), fetchAgents()]).finally(() => setLoading(false));
  }, [fetchTodos, fetchAgents]);

  // ── Filter logic ────────────────────────────────────────────────────────────

  const filteredTodos = useMemo(() => {
    let list = todos;

    // View filter
    if (view === 'today') {
      list = list.filter(t => t.status !== 'done' && (isToday(t.dueAt) || isOverdue(t.dueAt)));
    } else if (view === 'upcoming') {
      list = list.filter(t => t.status !== 'done' && isWithinDays(t.dueAt, 7));
    } else if (view === 'done') {
      list = list.filter(t => t.status === 'done');
    }
    // 'kanban' and 'all' show everything

    // Text search
    if (searchQ.trim()) {
      const q = searchQ.toLowerCase();
      list = list.filter(t =>
        t.title.toLowerCase().includes(q) ||
        (t.description?.toLowerCase().includes(q)) ||
        (t.tags?.some(tag => tag.toLowerCase().includes(q)))
      );
    }

    // Priority filter
    if (filterPriority !== 'all') {
      list = list.filter(t => t.priority === filterPriority);
    }

    // Agent filter
    if (filterAgent) {
      list = list.filter(t => t.agentId === filterAgent);
    }

    // Overdue filter
    if (filterOverdue) {
      list = list.filter(t => isOverdue(t.dueAt) && t.status !== 'done');
    }

    return list;
  }, [todos, view, searchQ, filterPriority, filterAgent, filterOverdue]);

  const todayCount = useMemo(() =>
    todos.filter(t => t.status !== 'done' && (isToday(t.dueAt) || isOverdue(t.dueAt))).length,
    [todos]);

  // ── Drawer helpers ──────────────────────────────────────────────────────────

  function openCreate(defaultStatus?: TodoStatus) {
    setDraft(emptyDraft({ status: defaultStatus ?? 'pending' }));
    setActiveTaskId(null);
    setDrawerMode('create');
  }

  function openEdit(task: TodoItem) {
    setDraft({
      title: task.title,
      description: task.description ?? '',
      status: task.status,
      priority: task.priority,
      agentId: task.agentId ?? '',
      dueAt: task.dueAt ?? '',
      tags: task.tags ?? [],
      subTasks: task.subTasks ?? [],
    });
    setActiveTaskId(task.id);
    setDrawerMode('edit');
  }

  function closeDrawer() {
    setDrawerMode('closed');
    setActiveTaskId(null);
  }

  function patchDraft(patch: Partial<TodoDraft>) {
    setDraft(cur => ({ ...cur, ...patch }));
  }

  // ── CRUD ────────────────────────────────────────────────────────────────────

  async function handleSave() {
    if (!draft.title.trim() || saving) return;
    setSaving(true);
    try {
      if (drawerMode === 'create') {
        const body = {
          title: draft.title.trim(),
          description: draft.description || undefined,
          status: draft.status,
          priority: draft.priority,
          agentId: draft.agentId || undefined,
          dueAt: draft.dueAt || undefined,
          tags: draft.tags.length ? draft.tags : undefined,
          subTasks: draft.subTasks.length ? draft.subTasks : undefined,
          projectKey: projectKey ?? undefined,
        };
        const r = await fetch('/api/todos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (r.ok) {
          const newTodo = await r.json();
          setTodos(cur => [...cur, newTodo]);
          closeDrawer();
        }
      } else if (drawerMode === 'edit' && activeTaskId) {
        const body = {
          title: draft.title.trim(),
          description: draft.description || undefined,
          status: draft.status,
          priority: draft.priority,
          agentId: draft.agentId || undefined,
          dueAt: draft.dueAt || undefined,
          tags: draft.tags,
          subTasks: draft.subTasks,
        };
        const r = await fetch(`/api/todos/${activeTaskId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (r.ok) {
          const updated = await r.json();
          setTodos(cur => cur.map(t => t.id === activeTaskId ? updated : t));
          closeDrawer();
        }
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!activeTaskId) return;
    const r = await fetch(`/api/todos/${activeTaskId}`, { method: 'DELETE' });
    if (r.ok) {
      setTodos(cur => cur.filter(t => t.id !== activeTaskId));
      closeDrawer();
    }
  }

  // ── Drag-and-drop ────────────────────────────────────────────────────────────

  function handleDragStart({ active }: DragStartEvent) {
    setDragId(active.id as string);
  }

  async function handleDragEnd({ active, over }: DragEndEvent) {
    setDragId(null);
    if (!over) return;
    const newStatus = over.id as TodoStatus;
    const task = todos.find(t => t.id === active.id);
    if (!task || task.status === newStatus) return;

    // Optimistic update
    setTodos(cur => cur.map(t => t.id === task.id ? { ...t, status: newStatus, updatedAt: new Date().toISOString() } : t));

    // Persist
    await fetch(`/api/todos/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    });
  }

  // ── Session navigation ───────────────────────────────────────────────────────

  function handleNavigateSession() {
    if (!activeTask) return;
    if (activeTask.sessionId) {
      router.push(`/${locale}/agents?session=${activeTask.sessionId}`);
    } else if (activeTask.agentId) {
      router.push(`/${locale}/agents?agent=${activeTask.agentId}`);
    }
    closeDrawer();
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      {/* Main area */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">

        {/* Top bar */}
        <div className="flex shrink-0 flex-col gap-3 border-b border-zinc-200 bg-white px-5 py-4 dark:border-zinc-800 dark:bg-zinc-950">

          {/* Row 1: View tabs + New button */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-1 rounded-xl border border-zinc-200 bg-zinc-50 p-1 dark:border-zinc-800 dark:bg-zinc-900">
              {viewMeta.map(v => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setView(v.id)}
                  className={[
                    'relative flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition',
                    view === v.id
                      ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-100'
                      : 'text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200',
                  ].join(' ')}
                >
                  {v.icon}
                  {v.label}
                  {v.id === 'today' && todayCount > 0 && (
                    <span className="ml-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">
                      {todayCount}
                    </span>
                  )}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => openCreate()}
              className="flex items-center gap-1.5 rounded-xl bg-zinc-900 px-3.5 py-2 text-xs font-medium text-white transition hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              <Plus className="h-3.5 w-3.5" />
              新建任务
            </button>
          </div>

          {/* Row 2: Filter bar */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Search */}
            <div className="relative min-w-[180px] flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
              <input
                value={searchQ}
                onChange={e => setSearchQ(e.target.value)}
                placeholder="搜索任务..."
                className="w-full rounded-lg border border-zinc-200 bg-white py-1.5 pl-8 pr-3 text-xs text-zinc-700 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
              />
              {searchQ && (
                <button type="button" onClick={() => setSearchQ('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600">
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>

            {/* Priority chips */}
            <div className="flex items-center gap-1">
              {(['all', ...priorityOrder] as const).map(p => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setFilterPriority(p)}
                  className={[
                    'rounded-full border px-2.5 py-1 text-[11px] font-medium transition',
                    filterPriority === p
                      ? p === 'all'
                        ? 'border-zinc-800 bg-zinc-800 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
                        : `${priorityMeta[p].chip} ${priorityMeta[p].text} border-current`
                      : 'border-zinc-200 bg-white text-zinc-500 hover:border-zinc-300 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-zinc-600',
                  ].join(' ')}
                >
                  {p === 'all' ? '全部' : priorityMeta[p].label}
                </button>
              ))}
            </div>

            {/* Agent filter */}
            {agents.length > 0 && (
              <div className="relative">
                <Bot className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
                <select
                  value={filterAgent}
                  onChange={e => setFilterAgent(e.target.value)}
                  className="appearance-none rounded-lg border border-zinc-200 bg-white py-1.5 pl-8 pr-7 text-xs text-zinc-600 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
                >
                  <option value="">所有 Agent</option>
                  {agents.map(a => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-zinc-400" />
              </div>
            )}

            {/* Overdue toggle */}
            <button
              type="button"
              onClick={() => setFilterOverdue(v => !v)}
              className={[
                'flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition',
                filterOverdue
                  ? 'border-red-200 bg-red-50 text-red-600 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400'
                  : 'border-zinc-200 bg-white text-zinc-500 hover:border-zinc-300 dark:border-zinc-700 dark:bg-zinc-900',
              ].join(' ')}
            >
              <AlertCircle className="h-3.5 w-3.5" />
              逾期
            </button>
          </div>
        </div>

        {/* Content area */}
        <div className="flex min-h-0 flex-1 overflow-auto p-5">
          {loading ? (
            <div className="flex flex-1 items-center justify-center text-sm text-zinc-400">加载中...</div>
          ) : view === 'kanban' ? (
            /* ─ Kanban view ─ */
            <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
              <div className="flex min-h-full w-full gap-4">
                {statusOrder.map(status => (
                  <DroppableColumn
                    key={status}
                    status={status}
                    tasks={filteredTodos.filter(t => t.status === status)}
                    agentMap={agentMap}
                    onCardClick={openEdit}
                    onAddClick={() => openCreate(status)}
                  />
                ))}
              </div>
              <DragOverlay>
                {dragTask && (
                  <DraggableCard task={dragTask} agentMap={agentMap} onClick={() => {}} overlay />
                )}
              </DragOverlay>
            </DndContext>
          ) : (
            /* ─ List views ─ */
            <div className="w-full max-w-3xl mx-auto">
              {filteredTodos.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-3 py-20 text-zinc-400">
                  <Inbox className="h-10 w-10" />
                  <p className="text-sm">
                    {view === 'today' ? '今天没有到期任务' :
                     view === 'upcoming' ? '未来 7 天没有待处理任务' :
                     view === 'done' ? '暂无完成任务' : '暂无任务'}
                  </p>
                  {view === 'all' && (
                    <button
                      type="button"
                      onClick={() => openCreate()}
                      className="flex items-center gap-1.5 rounded-xl bg-zinc-900 px-4 py-2 text-xs font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      新建第一个任务
                    </button>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  {view !== 'done' && filteredTodos.filter(t => t.status !== 'done').length > 0 && (
                    <>
                      {/* Group by status in 'all' view */}
                      {view === 'all' && (
                        <>
                          {statusOrder.filter(s => s !== 'done').map(status => {
                            const group = filteredTodos.filter(t => t.status === status);
                            if (group.length === 0) return null;
                            return (
                              <div key={status} className="mb-4">
                                <div className="mb-2 flex items-center gap-2">
                                  <span className={`h-2 w-2 rounded-full ${statusMeta[status].dot}`} />
                                  <span className={`text-xs font-semibold uppercase tracking-wider ${statusMeta[status].colHead}`}>{statusMeta[status].label}</span>
                                  <span className={`rounded-full px-2 py-0.5 text-[10px] ${statusMeta[status].countBg}`}>{group.length}</span>
                                </div>
                                <div className="space-y-2">
                                  {group.map(task => (
                                    <FlatTaskCard key={task.id} task={task} agentMap={agentMap} onClick={() => openEdit(task)} />
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                        </>
                      )}
                      {view !== 'all' && filteredTodos.filter(t => t.status !== 'done').map(task => (
                        <FlatTaskCard key={task.id} task={task} agentMap={agentMap} onClick={() => openEdit(task)} />
                      ))}
                    </>
                  )}
                  {(view === 'done' || view === 'all') && filteredTodos.filter(t => t.status === 'done').length > 0 && (
                    <div className={view === 'all' ? 'mt-4' : ''}>
                      {view === 'all' && (
                        <div className="mb-2 flex items-center gap-2">
                          <span className={`h-2 w-2 rounded-full ${statusMeta.done.dot}`} />
                          <span className={`text-xs font-semibold uppercase tracking-wider ${statusMeta.done.colHead}`}>{statusMeta.done.label}</span>
                          <span className={`rounded-full px-2 py-0.5 text-[10px] ${statusMeta.done.countBg}`}>{filteredTodos.filter(t => t.status === 'done').length}</span>
                        </div>
                      )}
                      <div className="space-y-2">
                        {filteredTodos.filter(t => t.status === 'done').map(task => (
                          <FlatTaskCard key={task.id} task={task} agentMap={agentMap} onClick={() => openEdit(task)} />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Drawer */}
      {drawerMode !== 'closed' && (
        <TaskDrawer
          mode={drawerMode}
          draft={draft}
          task={activeTask ?? undefined}
          agents={agents}
          agentMap={agentMap}
          saving={saving}
          onDraftChange={patchDraft}
          onSave={handleSave}
          onDelete={drawerMode === 'edit' ? handleDelete : undefined}
          onClose={closeDrawer}
          onNavigateSession={handleNavigateSession}
          locale={locale}
        />
      )}
    </div>
  );
}
