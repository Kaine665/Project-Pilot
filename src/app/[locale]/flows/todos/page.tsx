'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot,
  Calendar,
  CheckCircle2,
  ChevronRight,
  Circle,
  LayoutDashboard,
  ListTodo,
  MessageSquare,
  Play,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  User,
  X,
  Zap,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useProject } from '@/components/project-context';
import type { Agent, TodoItem, TodoPriority, TodoStatus } from '@/types';

const statusOrder: TodoStatus[] = ['pending', 'in_progress', 'done'];
const priorityOrder: TodoPriority[] = ['high', 'medium', 'low'];

type DrawerMode = 'closed' | 'create' | 'edit';

interface TodoDraft {
  title: string;
  description: string;
  status: TodoStatus;
  priority: TodoPriority;
  agentId: string;
  dueAt: string;
}

const statusTone: Record<TodoStatus, { dot: string; chip: string; text: string; columnText: string; countChip: string }> = {
  pending: {
    dot: 'bg-zinc-400',
    chip: 'bg-zinc-100 border-zinc-200',
    text: 'text-zinc-700',
    columnText: 'text-zinc-500',
    countChip: 'bg-zinc-200/70 text-zinc-600',
  },
  in_progress: {
    dot: 'bg-blue-500',
    chip: 'bg-blue-50 border-blue-100',
    text: 'text-blue-700',
    columnText: 'text-blue-600',
    countChip: 'bg-blue-100 text-blue-600',
  },
  done: {
    dot: 'bg-green-500',
    chip: 'bg-green-50 border-green-100',
    text: 'text-green-700',
    columnText: 'text-green-600',
    countChip: 'bg-green-100 text-green-600',
  },
};

const priorityTone: Record<TodoPriority, { dot: string; chip: string; text: string }> = {
  high: {
    dot: 'bg-red-500',
    chip: 'bg-red-50 border-red-100',
    text: 'text-red-700',
  },
  medium: {
    dot: 'bg-amber-400',
    chip: 'bg-amber-50 border-amber-100',
    text: 'text-amber-700',
  },
  low: {
    dot: 'bg-blue-400',
    chip: 'bg-blue-50 border-blue-100',
    text: 'text-blue-700',
  },
};

const localeText = {
  zh: {
    searchPlaceholder: '搜索任务...',
    boardLabel: '看板',
    filterLabel: '筛选',
    detailTitle: '任务详情',
    createTitle: '新建任务',
    titleField: '任务标题',
    statusField: '当前状态',
    priorityField: '优先级',
    agentField: '负责 Agent',
    dueDateField: '截止日期',
    projectField: '所属项目',
    createdAtField: '创建时间',
    updatedAtField: '更新时间',
    notesField: '备注说明',
    noDueDate: '未设置',
    noProject: '未绑定项目',
    linkedSession: '前往会话',
    save: '保存修改',
    create: '创建任务',
    close: '关闭',
    delete: '删除任务',
    selectTip: '点击卡片查看详情',
    emptyColumn: '这一列还没有任务',
    addTask: '添加任务',
    sessionCreated: '已关联会话',
    selectionCount: '已选 {count} 项',
  },
  en: {
    searchPlaceholder: 'Search tasks...',
    boardLabel: 'Board',
    filterLabel: 'Filters',
    detailTitle: 'Task Details',
    createTitle: 'New Task',
    titleField: 'Task Title',
    statusField: 'Status',
    priorityField: 'Priority',
    agentField: 'Assigned Agent',
    dueDateField: 'Due Date',
    projectField: 'Project',
    createdAtField: 'Created',
    updatedAtField: 'Updated',
    notesField: 'Notes',
    noDueDate: 'Not set',
    noProject: 'No project',
    linkedSession: 'Open Session',
    save: 'Save Changes',
    create: 'Create Task',
    close: 'Close',
    delete: 'Delete Task',
    selectTip: 'Click a card to open details',
    emptyColumn: 'No tasks in this column yet',
    addTask: 'Add task',
    sessionCreated: 'Linked session',
    selectionCount: '{count} selected',
  },
} as const;

function formatDateTime(iso?: string): string {
  if (!iso) return '--';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '--';
  return new Intl.DateTimeFormat('sv-SE', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatDateOnly(iso?: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('sv-SE', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function toDateInputValue(iso?: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function fromDateInputValue(value: string): string | undefined {
  if (!value) return undefined;
  return new Date(`${value}T12:00:00.000Z`).toISOString();
}

function createDraft(todo?: TodoItem, status: TodoStatus = 'pending'): TodoDraft {
  return {
    title: todo?.title ?? '',
    description: todo?.description ?? '',
    status: todo?.status ?? status,
    priority: todo?.priority ?? 'medium',
    agentId: todo?.agentId ?? '',
    dueAt: toDateInputValue(todo?.dueAt),
  };
}

export default function TodosPage() {
  const t = useTranslations('todos');
  const locale = useLocale();
  const router = useRouter();
  const { projects, activeKey } = useProject();
  const text = locale.startsWith('zh') ? localeText.zh : localeText.en;
  const activeProject = projects.find((project) => project.key === activeKey);

  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [drawerMode, setDrawerMode] = useState<DrawerMode>('closed');
  const [activeTodoId, setActiveTodoId] = useState<string | null>(null);
  const [draft, setDraft] = useState<TodoDraft>(() => createDraft());
  const [saving, setSaving] = useState(false);
  const [agentPickerFor, setAgentPickerFor] = useState<'assign' | 'execute' | null>(null);
  const [launchedSessionId, setLaunchedSessionId] = useState<string | null>(null);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const fetchTodos = useCallback(async () => {
    try {
      setLoading(true);
      const url = activeKey ? `/api/todos?project=${encodeURIComponent(activeKey)}` : '/api/todos';
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) return;
      const data = await response.json();
      setTodos(data.todos ?? []);
    } catch (error) {
      console.error('Failed to fetch todos:', error);
    } finally {
      setLoading(false);
    }
  }, [activeKey]);

  const fetchAgents = useCallback(async () => {
    try {
      const response = await fetch('/api/agents', { cache: 'no-store' });
      if (!response.ok) return;
      const data = await response.json();
      setAgents(data.agents ?? []);
    } catch (error) {
      console.error('Failed to fetch agents:', error);
    }
  }, []);

  useEffect(() => {
    fetchTodos();
    fetchAgents();
  }, [fetchTodos, fetchAgents]);

  const activeTodo = useMemo(
    () => (activeTodoId ? todos.find((todo) => todo.id === activeTodoId) ?? null : null),
    [activeTodoId, todos],
  );

  useEffect(() => {
    if (drawerMode !== 'edit') return;
    if (!activeTodo) {
      setDrawerMode('closed');
      setActiveTodoId(null);
      return;
    }
    setDraft(createDraft(activeTodo));
  }, [activeTodo, drawerMode]);

  useEffect(() => {
    if (drawerMode === 'create') {
      searchRef.current?.blur();
    }
  }, [drawerMode]);

  const filteredTodos = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return todos;
    return todos.filter((todo) => {
      const haystack = [
        todo.title,
        todo.description ?? '',
        agents.find((agent) => agent.id === todo.agentId)?.name ?? '',
      ].join(' ').toLowerCase();
      return haystack.includes(keyword);
    });
  }, [agents, search, todos]);

  const groupedTodos = useMemo(() => ({
    pending: filteredTodos.filter((todo) => todo.status === 'pending'),
    in_progress: filteredTodos.filter((todo) => todo.status === 'in_progress'),
    done: filteredTodos.filter((todo) => todo.status === 'done'),
  }), [filteredTodos]);

  const counts = useMemo(() => ({
    total: todos.length,
    pending: todos.filter((todo) => todo.status === 'pending').length,
    in_progress: todos.filter((todo) => todo.status === 'in_progress').length,
    done: todos.filter((todo) => todo.status === 'done').length,
  }), [todos]);

  const hasSelection = selectedIds.size > 0;

  const openCreateDrawer = (status: TodoStatus = 'pending') => {
    setDrawerMode('create');
    setActiveTodoId(null);
    setDraft(createDraft(undefined, status));
  };

  const openTodoDrawer = (todo: TodoItem) => {
    setDrawerMode('edit');
    setActiveTodoId(todo.id);
    setDraft(createDraft(todo));
  };

  const closeDrawer = () => {
    setDrawerMode('closed');
    setActiveTodoId(null);
    setDraft(createDraft());
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t('confirmDelete'))) return;
    try {
      const response = await fetch(`/api/todos/${id}`, { method: 'DELETE' });
      if (!response.ok) return;
      setSelectedIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
      if (activeTodoId === id) closeDrawer();
      await fetchTodos();
    } catch (error) {
      console.error('Failed to delete todo:', error);
    }
  };

  const handleBatchAction = async (
    action: 'delete' | 'update',
    updates?: { status?: TodoStatus; priority?: TodoPriority; agentId?: string | null; sessionId?: string },
  ) => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;

    if (action === 'delete' && !confirm(t('confirmBatchDelete', { count: ids.length }))) {
      return;
    }

    try {
      const response = await fetch('/api/todos/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, action, updates }),
      });
      if (!response.ok) return;
      setSelectedIds(new Set());
      await fetchTodos();
    } catch (error) {
      console.error('Failed batch action:', error);
    }
  };

  const launchAgentChat = useCallback(async (agentId: string, todoItems: TodoItem[]) => {
    const message = todoItems
      .map((todo) => {
        const lines = [`- ${todo.title}`];
        if (todo.description) lines.push(`  ${todo.description}`);
        return lines.join('\n');
      })
      .join('\n');

    try {
      const response = await fetch('/api/agent-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId,
          message,
          initialTitle: todoItems.length === 1 ? todoItems[0].title : `${todoItems.length} todos`,
        }),
      });
      if (!response.ok) return;
      const data = await response.json();
      setLaunchedSessionId(data.sessionId);
      await fetch('/api/todos/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ids: todoItems.map((todo) => todo.id),
          action: 'update',
          updates: { status: 'in_progress', sessionId: data.sessionId },
        }),
      });
      setSelectedIds(new Set());
      await fetchTodos();
    } catch (error) {
      console.error('Failed to launch agent chat:', error);
    }
  }, [fetchTodos]);

  const handleAIExecute = (agentId?: string) => {
    const selectedTodos = todos.filter((todo) => selectedIds.has(todo.id));
    if (selectedTodos.length === 0) return;

    let targetAgentId = agentId;
    if (!targetAgentId) {
      const boundAgentIds = [...new Set(selectedTodos.map((todo) => todo.agentId).filter(Boolean))];
      if (boundAgentIds.length === 1) {
        targetAgentId = boundAgentIds[0];
      } else {
        setAgentPickerFor('execute');
        return;
      }
    }

    if (targetAgentId) launchAgentChat(targetAgentId, selectedTodos);
  };

  const handleSingleAIExecute = () => {
    if (!activeTodo) return;
    setSelectedIds(new Set([activeTodo.id]));
    handleAIExecute(activeTodo.agentId);
  };

  const handleAgentPick = (agentId: string) => {
    if (agentPickerFor === 'assign') {
      handleBatchAction('update', { agentId });
    } else if (agentPickerFor === 'execute') {
      const selectedTodos = todos.filter((todo) => selectedIds.has(todo.id));
      if (selectedTodos.length > 0) launchAgentChat(agentId, selectedTodos);
    }
    setAgentPickerFor(null);
  };

  const handleSaveDrawer = async () => {
    const title = draft.title.trim();
    if (!title) return;

    const payload = {
      title,
      description: draft.description.trim() || undefined,
      status: draft.status,
      priority: draft.priority,
      agentId: draft.agentId || null,
      projectKey: activeKey ?? undefined,
      dueAt: fromDateInputValue(draft.dueAt),
    };

    try {
      setSaving(true);
      if (drawerMode === 'create') {
        const response = await fetch('/api/todos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!response.ok) return;
        const created = await response.json();
        await fetchTodos();
        setDrawerMode('edit');
        setActiveTodoId(created.id);
      } else if (drawerMode === 'edit' && activeTodoId) {
        const response = await fetch(`/api/todos/${activeTodoId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!response.ok) return;
        await fetchTodos();
      }
    } catch (error) {
      console.error('Failed to save todo:', error);
    } finally {
      setSaving(false);
    }
  };

  const getAgent = (agentId?: string) => agents.find((agent) => agent.id === agentId);

  return (
    <div className="h-full overflow-hidden">
      <div className="flex h-full min-h-0">
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-white dark:bg-zinc-950">
          <div className="border-b border-zinc-100 bg-white px-6 py-4 dark:border-zinc-800 dark:bg-zinc-950">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-100 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
                  <LayoutDashboard className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h1 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{t('title')}</h1>
                    <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-semibold text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
                      {counts.total}
                    </span>
                    {activeProject && (
                      <span className="rounded-full border border-zinc-200 px-2 py-0.5 text-[11px] font-medium text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                        {activeProject.name}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">{text.selectTip}</p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                  <input
                    ref={searchRef}
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder={text.searchPlaceholder}
                    className="h-10 w-72 rounded-xl border border-zinc-200 bg-zinc-50 pl-9 pr-3 text-sm text-zinc-700 outline-none transition focus:border-zinc-300 focus:bg-white dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:focus:border-zinc-600"
                  />
                </div>

                <button
                  type="button"
                  onClick={() => setIsFilterOpen((current) => !current)}
                  className={`flex h-10 w-10 items-center justify-center rounded-xl border transition-colors ${
                    isFilterOpen
                      ? 'border-zinc-300 bg-white text-zinc-900 shadow-sm dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100'
                      : 'border-zinc-200 text-zinc-500 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900'
                  }`}
                  title={text.filterLabel}
                >
                  <SlidersHorizontal className="h-4 w-4" />
                </button>

                <div className="flex items-center gap-1 rounded-xl border border-zinc-200 bg-zinc-50 p-1 text-[11px] font-semibold text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400">
                  <span className="rounded-lg bg-white px-2.5 py-1 text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-100">{text.boardLabel}</span>
                </div>

                <button
                  type="button"
                  onClick={() => openCreateDrawer()}
                  className="flex items-center gap-1.5 rounded-xl bg-zinc-900 px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {t('newTodo')}
                </button>
              </div>
            </div>

            {isFilterOpen && (
              <div className="mt-4 flex flex-wrap items-center gap-2 rounded-2xl border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/60">
                {statusOrder.map((status) => (
                  <button
                    key={status}
                    type="button"
                    onClick={() => openCreateDrawer(status)}
                    className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-medium transition hover:-translate-y-0.5 ${statusTone[status].chip} ${statusTone[status].text}`}
                  >
                    <span className={`h-2 w-2 rounded-full ${statusTone[status].dot}`} />
                    {t(`filters.${status}`)}
                    <span className="opacity-60">+</span>
                  </button>
                ))}

                {hasSelection && (
                  <button
                    type="button"
                    onClick={() => setSelectedIds(new Set())}
                    className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-500 transition hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  >
                    {text.selectionCount.replace('{count}', String(selectedIds.size))}
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="flex-1 overflow-auto bg-zinc-50/40 p-6 dark:bg-zinc-950">
            {loading ? (
              <div className="flex h-full flex-col items-center justify-center text-zinc-400">
                <ListTodo className="mb-3 h-10 w-10" />
                <p className="text-sm">{t('loading')}</p>
              </div>
            ) : filteredTodos.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center rounded-3xl border border-dashed border-zinc-200 bg-white/80 text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900/40">
                <ListTodo className="mb-3 h-10 w-10" />
                <p className="text-sm">{t('noTodos')}</p>
              </div>
            ) : (
              <div className="flex min-h-full gap-6">
                {statusOrder.map((status) => {
                  const columnTodos = groupedTodos[status];
                  return (
                    <section key={status} className="flex w-[340px] shrink-0 flex-col">
                      <div className="mb-3 flex items-center justify-between px-1">
                        <div className="flex items-center gap-2">
                          <span className={`text-[11px] font-bold uppercase tracking-[0.18em] ${statusTone[status].columnText}`}>
                            {t(`filters.${status}`)}
                          </span>
                          <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${statusTone[status].countChip}`}>
                            {columnTodos.length}
                          </span>
                        </div>
                      </div>
                      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
                        {columnTodos.map((todo) => {
                          const agent = getAgent(todo.agentId);
                          const isSelectedCard = activeTodoId === todo.id && drawerMode === 'edit';
                          const isChecked = selectedIds.has(todo.id);
                          const isDone = todo.status === 'done';
                          return (
                            <article
                              key={todo.id}
                              onClick={() => openTodoDrawer(todo)}
                              className={`group cursor-pointer rounded-2xl border bg-white p-3 shadow-sm transition ${
                                isSelectedCard
                                  ? 'border-zinc-900 ring-2 ring-zinc-900/5 dark:border-zinc-100 dark:ring-zinc-100/10'
                                  : 'border-zinc-200 hover:-translate-y-0.5 hover:border-zinc-300 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700'
                              } ${todo.status === 'in_progress' ? 'border-l-4 border-l-blue-500 pl-[11px]' : ''} ${isDone ? 'opacity-80' : ''}`}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex min-w-0 items-start gap-2">
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      toggleSelect(todo.id);
                                    }}
                                    className="mt-0.5 text-zinc-300 transition hover:text-blue-500 dark:text-zinc-600 dark:hover:text-blue-400"
                                  >
                                    {isChecked ? (
                                      <CheckCircle2 className="h-4 w-4 text-blue-500" />
                                    ) : (
                                      <Circle className="h-4 w-4" />
                                    )}
                                  </button>
                                  <div className="min-w-0">
                                    <h3 className={`text-sm leading-snug ${isDone ? 'text-zinc-500 line-through dark:text-zinc-500' : 'font-medium text-zinc-900 dark:text-zinc-100'}`}>
                                      {todo.title}
                                    </h3>
                                    {todo.description && (
                                      <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-zinc-400 dark:text-zinc-500">
                                        {todo.description}
                                      </p>
                                    )}
                                  </div>
                                </div>

                                <div className="flex items-center gap-1">
                                  {todo.status === 'in_progress' && <Zap className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-500" />}
                                  {todo.sessionId && (
                                    <button
                                      type="button"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        if (todo.agentId) {
                                          router.push(`/flows/agents?agent=${todo.agentId}&session=${todo.sessionId}`);
                                        }
                                      }}
                                      className="rounded-md p-1 text-zinc-300 transition hover:bg-blue-50 hover:text-blue-500 dark:text-zinc-600 dark:hover:bg-blue-950/30 dark:hover:text-blue-400"
                                    >
                                      <MessageSquare className="h-3.5 w-3.5" />
                                    </button>
                                  )}
                                  <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-300 transition group-hover:text-zinc-500 dark:text-zinc-600 dark:group-hover:text-zinc-400" />
                                </div>
                              </div>

                              <div className="mt-3 flex items-center justify-between gap-3">
                                <div className="flex min-w-0 flex-wrap items-center gap-2">
                                  <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-bold uppercase ${priorityTone[todo.priority].chip} ${priorityTone[todo.priority].text}`}>
                                    <span className={`h-1.5 w-1.5 rounded-full ${priorityTone[todo.priority].dot}`} />
                                    {t(`batchPriority${todo.priority.charAt(0).toUpperCase() + todo.priority.slice(1)}` as 'batchPriorityHigh' | 'batchPriorityMedium' | 'batchPriorityLow')}
                                  </span>
                                  <span className="text-[10px] font-medium text-zinc-400">{formatDateOnly(todo.dueAt || todo.updatedAt)}</span>
                                  {todo.sessionId && (
                                    <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                                      {text.sessionCreated}
                                    </span>
                                  )}
                                </div>

                                <div className="flex items-center gap-1.5">
                                  {agent ? (
                                    <div className={`flex h-5 w-5 items-center justify-center rounded-full border ${todo.agentId ? 'border-zinc-950 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900' : 'border-zinc-200 bg-zinc-100 text-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-500'}`}>
                                      <User className="h-2.5 w-2.5" />
                                    </div>
                                  ) : (
                                    <div className="flex h-5 w-5 items-center justify-center rounded-full border border-zinc-200 bg-zinc-100 text-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-500">
                                      <Bot className="h-2.5 w-2.5" />
                                    </div>
                                  )}
                                </div>
                              </div>
                            </article>
                          );
                        })}

                        <button
                          type="button"
                          onClick={() => openCreateDrawer(status)}
                          className="flex items-center justify-center gap-1.5 rounded-2xl border border-dashed border-zinc-300 py-3 text-xs font-medium text-zinc-400 transition hover:border-zinc-400 hover:text-zinc-600 dark:border-zinc-700 dark:hover:border-zinc-600 dark:hover:text-zinc-300"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          {text.addTask}
                        </button>

                        {columnTodos.length === 0 && (
                          <div className="rounded-2xl border border-dashed border-zinc-200 bg-white/70 px-4 py-5 text-center text-xs text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900/40">
                            {text.emptyColumn}
                          </div>
                        )}
                      </div>
                    </section>
                  );
                })}
              </div>
            )}
          </div>
        </div>
        {drawerMode !== 'closed' && (
          <aside className="w-[380px] shrink-0 border-l border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
            <div className="flex h-full min-h-0 flex-col">
              <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
                    <LayoutDashboard className="h-4 w-4" />
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                      {drawerMode === 'create' ? text.createTitle : text.detailTitle}
                    </h2>
                    {drawerMode === 'edit' && activeTodo && (
                      <p className="text-[10px] text-zinc-400 dark:text-zinc-500">{activeTodo.id}</p>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={closeDrawer}
                  className="rounded-md p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-900 dark:hover:text-zinc-300"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-5">
                <div className="space-y-6">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">{text.titleField}</label>
                    <textarea
                      rows={2}
                      value={draft.title}
                      onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
                      placeholder={t('placeholder')}
                      className="w-full resize-none border-none bg-transparent p-0 text-lg font-semibold text-zinc-900 outline-none placeholder:text-zinc-300 dark:text-zinc-100 dark:placeholder:text-zinc-600"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">{text.statusField}</label>
                      <select
                        value={draft.status}
                        onChange={(event) => setDraft((current) => ({ ...current, status: event.target.value as TodoStatus }))}
                        className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs font-medium text-zinc-700 outline-none transition focus:border-zinc-300 focus:bg-white dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:focus:border-zinc-600"
                      >
                        {statusOrder.map((status) => (
                          <option key={status} value={status}>
                            {t(`filters.${status}`)}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">{text.priorityField}</label>
                      <div className="grid grid-cols-3 gap-2">
                        {priorityOrder.map((priority) => (
                          <button
                            key={priority}
                            type="button"
                            onClick={() => setDraft((current) => ({ ...current, priority }))}
                            className={`rounded-xl border px-2 py-2 text-[11px] font-semibold transition ${
                              draft.priority === priority
                                ? `${priorityTone[priority].chip} ${priorityTone[priority].text} shadow-sm`
                                : 'border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800'
                            }`}
                          >
                            {t(`batchPriority${priority.charAt(0).toUpperCase() + priority.slice(1)}` as 'batchPriorityHigh' | 'batchPriorityMedium' | 'batchPriorityLow')}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">{text.agentField}</label>
                    <div className="rounded-xl border border-zinc-200 bg-white p-2.5 dark:border-zinc-700 dark:bg-zinc-900">
                      <div className="flex items-center gap-3">
                        <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${draft.agentId ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900' : 'bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500'}`}>
                          {draft.agentId ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
                        </div>
                        <select
                          value={draft.agentId}
                          onChange={(event) => setDraft((current) => ({ ...current, agentId: event.target.value }))}
                          className="w-full bg-transparent text-sm font-medium text-zinc-900 outline-none dark:text-zinc-100"
                        >
                          <option value="">{t('noAgent')}</option>
                          {agents.map((agent) => (
                            <option key={agent.id} value={agent.id}>
                              {agent.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">{text.dueDateField}</label>
                      <div className="relative">
                        <Calendar className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                        <input
                          type="date"
                          value={draft.dueAt}
                          onChange={(event) => setDraft((current) => ({ ...current, dueAt: event.target.value }))}
                          className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 pl-9 text-sm text-zinc-700 outline-none transition focus:border-zinc-300 focus:bg-white dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:focus:border-zinc-600"
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">{text.projectField}</label>
                      <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm font-medium text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                        {activeProject?.name ?? text.noProject}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-zinc-100 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/60">
                    <div className="space-y-3 text-xs">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-zinc-500">{text.createdAtField}</span>
                        <span className="font-medium text-zinc-900 dark:text-zinc-100">
                          {activeTodo ? formatDateTime(activeTodo.createdAt) : '--'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-zinc-500">{text.updatedAtField}</span>
                        <span className="font-medium text-zinc-900 dark:text-zinc-100">
                          {activeTodo ? formatDateTime(activeTodo.updatedAt) : '--'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-zinc-500">{text.dueDateField}</span>
                        <span className="font-medium text-zinc-900 dark:text-zinc-100">
                          {draft.dueAt || text.noDueDate}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">{text.notesField}</label>
                    <textarea
                      rows={6}
                      value={draft.description}
                      onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
                      placeholder={t('descriptionPlaceholder')}
                      className="min-h-[120px] w-full resize-y rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm leading-relaxed text-zinc-600 outline-none placeholder:text-zinc-300 transition focus:border-zinc-300 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:placeholder:text-zinc-600 dark:focus:border-zinc-600"
                    />
                  </div>

                  {activeTodo?.sessionId && activeTodo.agentId && (
                    <button
                      type="button"
                      onClick={() => router.push(`/flows/agents?agent=${activeTodo.agentId}&session=${activeTodo.sessionId}`)}
                      className="flex w-full items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm font-medium text-zinc-600 transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
                    >
                      <MessageSquare className="h-4 w-4" />
                      {text.linkedSession}
                    </button>
                  )}
                </div>
              </div>

              <div className="border-t border-zinc-200 bg-zinc-50/60 p-5 dark:border-zinc-800 dark:bg-zinc-950">
                <div className="flex flex-col gap-2.5">
                  {drawerMode === 'edit' && (
                    <button
                      type="button"
                      onClick={handleSingleAIExecute}
                      className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--color-ai)] px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110"
                    >
                      <Play className="h-4 w-4" />
                      {t('aiExecute')}
                    </button>
                  )}

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={handleSaveDrawer}
                      disabled={saving}
                      className="rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                    >
                      {drawerMode === 'create' ? text.create : text.save}
                    </button>

                    {drawerMode === 'edit' && activeTodo ? (
                      <button
                        type="button"
                        onClick={() => handleDelete(activeTodo.id)}
                        className="rounded-xl border border-red-100 bg-red-50/70 px-4 py-2.5 text-sm font-medium text-red-600 transition hover:bg-red-50 dark:border-red-950 dark:bg-red-950/30 dark:text-red-400"
                      >
                        {text.delete}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={closeDrawer}
                        className="rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm font-medium text-zinc-600 transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
                      >
                        {text.close}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </aside>
        )}
      </div>

      {hasSelection && (
        <div className="pointer-events-none fixed inset-x-0 bottom-8 z-50 flex justify-center px-6">
          <div className="pointer-events-auto flex flex-wrap items-center gap-2 rounded-2xl border border-zinc-200 bg-white px-4 py-3 shadow-2xl dark:border-zinc-700 dark:bg-zinc-900">
            <span className="mr-2 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
              {t('selectedCount', { count: selectedIds.size })}
            </span>

            <button
              type="button"
              onClick={() => handleAIExecute()}
              className="flex items-center gap-1.5 rounded-lg bg-blue-500 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-blue-600"
            >
              <Play className="h-3.5 w-3.5" />
              {t('aiExecute')}
            </button>

            <button
              type="button"
              onClick={() => setAgentPickerFor('assign')}
              className="flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium text-zinc-600 transition hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
            >
              <Bot className="h-3.5 w-3.5" />
              {t('assignAgent')}
            </button>

            {statusOrder.map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => handleBatchAction('update', { status })}
                className={`rounded-lg px-3.5 py-2 text-sm font-medium transition hover:opacity-80 ${statusTone[status].chip} ${statusTone[status].text}`}
              >
                {t(`filters.${status}`)}
              </button>
            ))}

            {priorityOrder.map((priority) => (
              <button
                key={priority}
                type="button"
                onClick={() => handleBatchAction('update', { priority })}
                className="flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium text-zinc-600 transition hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
              >
                <span className={`h-2.5 w-2.5 rounded-full ${priorityTone[priority].dot}`} />
                {t(`batchPriority${priority.charAt(0).toUpperCase() + priority.slice(1)}` as 'batchPriorityHigh' | 'batchPriorityMedium' | 'batchPriorityLow')}
              </button>
            ))}

            <button
              type="button"
              onClick={() => handleBatchAction('delete')}
              className="rounded-lg px-3.5 py-2 text-sm font-medium text-red-500 transition hover:bg-red-50 dark:hover:bg-red-950/30"
            >
              {t('batchDelete')}
            </button>

            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="rounded-lg px-3.5 py-2 text-sm font-medium text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
            >
              {t('clearSelection')}
            </button>
          </div>
        </div>
      )}

      {agentPickerFor && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30" onClick={() => setAgentPickerFor(null)}>
          <div className="w-80 rounded-2xl border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-700 dark:bg-zinc-900" onClick={(event) => event.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{t('selectAgent')}</h3>
              <button type="button" onClick={() => setAgentPickerFor(null)} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-1">
              {agents.map((agent) => (
                <button
                  key={agent.id}
                  type="button"
                  onClick={() => handleAgentPick(agent.id)}
                  className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm transition hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <Bot className="h-4 w-4 shrink-0 text-zinc-400" />
                  <div className="min-w-0">
                    <div className="truncate font-medium text-zinc-900 dark:text-zinc-100">{agent.name}</div>
                    {agent.description && <div className="truncate text-xs text-zinc-400">{agent.description}</div>}
                  </div>
                </button>
              ))}
              {agents.length === 0 && (
                <p className="py-4 text-center text-sm text-zinc-400">{t('noAgent')}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {launchedSessionId && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30" onClick={() => setLaunchedSessionId(null)}>
          <div className="w-72 rounded-2xl border border-zinc-200 bg-white p-5 shadow-xl dark:border-zinc-700 dark:bg-zinc-900" onClick={(event) => event.stopPropagation()}>
            <div className="mb-4 text-center">
              <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-green-500" />
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{t('startedChat')}</p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setLaunchedSessionId(null)}
                className="flex-1 rounded-xl border border-zinc-200 px-3 py-2 text-sm font-medium text-zinc-600 transition hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                {t('stayHere')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setLaunchedSessionId(null);
                  router.push('/flows/agents');
                }}
                className="flex-1 rounded-xl bg-blue-500 px-3 py-2 text-sm font-medium text-white transition hover:bg-blue-600"
              >
                {t('goToChat')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
