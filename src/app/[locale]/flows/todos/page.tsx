'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { ListTodo, Plus, Trash2, ChevronDown, Circle, CheckCircle2, Bot, Play, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import type { TodoItem, TodoStatus, TodoPriority, Agent } from '@/types';

const statusConfig: Record<TodoStatus, { label: string; color: string; bg: string }> = {
  pending:     { label: '待办',   color: 'text-zinc-500',  bg: 'bg-zinc-100 dark:bg-zinc-800' },
  in_progress: { label: '进行中', color: 'text-blue-600',  bg: 'bg-blue-50 dark:bg-blue-950/40' },
  done:        { label: '已完成', color: 'text-green-600', bg: 'bg-green-50 dark:bg-green-950/40' },
};

const priorityConfig: Record<TodoPriority, { label: string; dot: string }> = {
  high:   { label: '高', dot: 'bg-red-500' },
  medium: { label: '中', dot: 'bg-amber-400' },
  low:    { label: '低', dot: 'bg-blue-400' },
};

const statusOrder: TodoStatus[] = ['pending', 'in_progress', 'done'];
const priorityOrder: TodoPriority[] = ['high', 'medium', 'low'];

function formatDate(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function TodosPage() {
  const t = useTranslations('todos');
  const router = useRouter();
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | TodoStatus>('all');
  const [creatingTitle, setCreatingTitle] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingCell, setEditingCell] = useState<{ id: string; field: 'title' | 'description' } | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const createInputRef = useRef<HTMLInputElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const hasSelection = selectedIds.size > 0;

  // Agent picker modal state
  const [agentPickerFor, setAgentPickerFor] = useState<'assign' | 'execute' | null>(null);
  // After-launch dialog state
  const [launchedSessionId, setLaunchedSessionId] = useState<string | null>(null);

  const fetchTodos = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/todos');
      if (res.ok) {
        const data = await res.json();
        setTodos(data.todos ?? []);
      }
    } catch (err) {
      console.error('Failed to fetch todos:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch('/api/agents');
      if (res.ok) {
        const data = await res.json();
        setAgents(data.agents ?? []);
      }
    } catch (err) {
      console.error('Failed to fetch agents:', err);
    }
  }, []);

  useEffect(() => { fetchTodos(); fetchAgents(); }, [fetchTodos, fetchAgents]);

  useEffect(() => {
    if (isCreating) createInputRef.current?.focus();
  }, [isCreating]);

  useEffect(() => {
    if (editingCell) {
      if (editingCell.field === 'title') editInputRef.current?.focus();
      else editTextareaRef.current?.focus();
    }
  }, [editingCell]);

  // Escape clears selection or closes modals
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (agentPickerFor) { setAgentPickerFor(null); return; }
        if (launchedSessionId) { setLaunchedSessionId(null); return; }
        if (hasSelection) setSelectedIds(new Set());
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [hasSelection, agentPickerFor, launchedSessionId]);

  const visibleTodos = todos
    .filter(todo => filter === 'all' || todo.status === filter)
    .sort((a, b) => {
      const statusDiff = statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status);
      if (statusDiff !== 0) return statusDiff;
      const priDiff = priorityOrder.indexOf(a.priority) - priorityOrder.indexOf(b.priority);
      if (priDiff !== 0) return priDiff;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

  const handleCreate = async () => {
    const title = creatingTitle.trim();
    if (!title) return;
    try {
      const res = await fetch('/api/todos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      });
      if (res.ok) {
        setCreatingTitle('');
        fetchTodos();
      }
    } catch (err) {
      console.error('Failed to create todo:', err);
    }
  };

  const handleUpdate = async (id: string, updates: Partial<Pick<TodoItem, 'title' | 'description' | 'status' | 'priority' | 'agentId'>>) => {
    try {
      const res = await fetch(`/api/todos/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (res.ok) fetchTodos();
    } catch (err) {
      console.error('Failed to update todo:', err);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t('confirmDelete'))) return;
    try {
      const res = await fetch(`/api/todos/${id}`, { method: 'DELETE' });
      if (res.ok) {
        fetchTodos();
        if (expandedId === id) setExpandedId(null);
      }
    } catch (err) {
      console.error('Failed to delete todo:', err);
    }
  };

  // --- Batch operations ---
  const handleBatchAction = async (action: 'delete' | 'update', updates?: { status?: TodoStatus; priority?: TodoPriority; agentId?: string | null }) => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;

    if (action === 'delete') {
      if (!confirm(t('confirmBatchDelete', { count: ids.length }))) return;
    }

    try {
      const res = await fetch('/api/todos/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, action, updates }),
      });
      if (res.ok) {
        setSelectedIds(new Set());
        fetchTodos();
      }
    } catch (err) {
      console.error('Failed batch action:', err);
    }
  };

  // --- AI Execute ---
  const handleAIExecute = (agentId?: string) => {
    const selectedTodos = todos.filter(t => selectedIds.has(t.id));
    if (selectedTodos.length === 0) return;

    // Check if all selected have the same agent bound
    const boundAgentIds = [...new Set(selectedTodos.map(t => t.agentId).filter(Boolean))];

    let targetAgentId = agentId;
    if (!targetAgentId) {
      if (boundAgentIds.length === 1) {
        targetAgentId = boundAgentIds[0];
      } else {
        // Need to pick an agent
        setAgentPickerFor('execute');
        return;
      }
    }

    launchAgentChat(targetAgentId!, selectedTodos);
  };

  const launchAgentChat = async (agentId: string, todoItems: TodoItem[]) => {
    // Build message from selected todos
    const message = todoItems.map(t => {
      let line = `- ${t.title}`;
      if (t.description) line += `\n  ${t.description}`;
      return line;
    }).join('\n');

    try {
      const res = await fetch('/api/agent-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId,
          message,
          initialTitle: todoItems.length === 1 ? todoItems[0].title : `${todoItems.length} todos`,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setLaunchedSessionId(data.sessionId);
        // Mark selected as in_progress
        await fetch('/api/todos/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ids: todoItems.map(t => t.id),
            action: 'update',
            updates: { status: 'in_progress' },
          }),
        });
        setSelectedIds(new Set());
        fetchTodos();
      }
    } catch (err) {
      console.error('Failed to launch agent chat:', err);
    }
  };

  const handleAgentPick = (agentId: string) => {
    if (agentPickerFor === 'assign') {
      handleBatchAction('update', { agentId });
    } else if (agentPickerFor === 'execute') {
      const selectedTodos = todos.filter(t => selectedIds.has(t.id));
      launchAgentChat(agentId, selectedTodos);
    }
    setAgentPickerFor(null);
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    const vIds = visibleTodos.map(t => t.id);
    const allSel = vIds.length > 0 && vIds.every(id => selectedIds.has(id));
    if (allSel) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(vIds));
    }
  };

  const cycleStatus = (current: TodoStatus): TodoStatus => {
    const i = statusOrder.indexOf(current);
    return statusOrder[(i + 1) % statusOrder.length];
  };

  const cyclePriority = (current: TodoPriority): TodoPriority => {
    const i = priorityOrder.indexOf(current);
    return priorityOrder[(i + 1) % priorityOrder.length];
  };

  const startEditTitle = (todo: TodoItem) => {
    setEditingCell({ id: todo.id, field: 'title' });
    setEditingValue(todo.title);
  };

  const startEditDescription = (todo: TodoItem) => {
    setEditingCell({ id: todo.id, field: 'description' });
    setEditingValue(todo.description ?? '');
  };

  const commitEdit = () => {
    if (!editingCell) return;
    const value = editingValue.trim();
    if (editingCell.field === 'title' && value) {
      handleUpdate(editingCell.id, { title: value });
    } else if (editingCell.field === 'description') {
      handleUpdate(editingCell.id, { description: value });
    }
    setEditingCell(null);
    setEditingValue('');
  };

  const cancelEdit = () => {
    setEditingCell(null);
    setEditingValue('');
  };

  const getAgentName = (agentId?: string) => {
    if (!agentId) return null;
    return agents.find(a => a.id === agentId)?.name ?? null;
  };

  const pendingCount = todos.filter(t => t.status === 'pending').length;
  const inProgressCount = todos.filter(t => t.status === 'in_progress').length;
  const doneCount = todos.filter(t => t.status === 'done').length;

  const visibleIds = visibleTodos.map(t => t.id);
  const allSelected = visibleIds.length > 0 && visibleIds.every(id => selectedIds.has(id));
  const someSelected = visibleIds.some(id => selectedIds.has(id));

  const gridCols = 'grid-cols-[28px_1fr_100px_90px_90px_120px_40px]';

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1100px] px-6 py-10">
        {/* Header */}
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <ListTodo className="h-5 w-5 text-zinc-400" />
            <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{t('title')}</h1>
            <span className="text-sm text-zinc-400">({todos.length})</span>
          </div>
          <button
            onClick={() => setIsCreating(true)}
            className="flex items-center gap-1.5 rounded-md bg-zinc-900 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 transition-colors dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            <Plus className="h-3.5 w-3.5" />
            {t('newTodo')}
          </button>
        </div>

        {/* Filter tabs */}
        <div className="mb-4 flex items-center gap-1">
          {([
            { key: 'all', label: t('filters.all'), count: todos.length },
            { key: 'pending', label: t('filters.pending'), count: pendingCount },
            { key: 'in_progress', label: t('filters.in_progress'), count: inProgressCount },
            { key: 'done', label: t('filters.done'), count: doneCount },
          ] as const).map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                filter === f.key
                  ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                  : 'text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800'
              }`}
            >
              {f.label}
              {f.count > 0 && <span className="ml-1.5 opacity-60">{f.count}</span>}
            </button>
          ))}
        </div>

        {/* Table */}
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
          {/* Table header */}
          <div className={`grid ${gridCols} border-b border-zinc-200 bg-zinc-50 px-4 py-2.5 text-xs font-medium text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-400`}>
            <button
              onClick={toggleSelectAll}
              className="flex items-center justify-center text-zinc-300 hover:text-zinc-500 dark:text-zinc-600 dark:hover:text-zinc-400"
            >
              {allSelected ? (
                <CheckCircle2 className="h-4 w-4 text-blue-500" />
              ) : someSelected ? (
                <div className="relative flex items-center justify-center">
                  <Circle className="h-4 w-4" />
                  <div className="absolute h-1.5 w-1.5 rounded-full bg-blue-500" />
                </div>
              ) : (
                <Circle className="h-4 w-4" />
              )}
            </button>
            <span>{t('columns.title')}</span>
            <span>{t('agent')}</span>
            <span>{t('columns.priority')}</span>
            <span>{t('columns.status')}</span>
            <span>{t('columns.createdAt')}</span>
            <span></span>
          </div>

          {/* Table body */}
          {loading ? (
            <div className="py-12 text-center text-sm text-zinc-400">{t('loading')}</div>
          ) : visibleTodos.length === 0 && !isCreating ? (
            <div className="flex flex-col items-center py-16 text-zinc-400">
              <ListTodo className="mb-3 h-10 w-10" />
              <p className="text-sm">{t('noTodos')}</p>
            </div>
          ) : (
            <div>
              {visibleTodos.map(todo => {
                const isSelected = selectedIds.has(todo.id);
                const agentName = getAgentName(todo.agentId);
                return (
                  <div key={todo.id} className="group">
                    <div
                      className={`grid ${gridCols} items-center px-4 py-2.5 border-b border-zinc-100 transition-colors hover:bg-zinc-50 dark:border-zinc-800/50 dark:hover:bg-zinc-900/40 ${
                        todo.status === 'done' ? 'opacity-50' : ''
                      } ${isSelected ? 'bg-blue-50/50 dark:bg-blue-950/20' : ''}`}
                    >
                      {/* Circle checkbox */}
                      <button
                        onClick={() => toggleSelect(todo.id)}
                        className="flex items-center justify-center"
                      >
                        {isSelected ? (
                          <CheckCircle2 className="h-4 w-4 text-blue-500" />
                        ) : (
                          <Circle className="h-4 w-4 text-zinc-300 hover:text-zinc-400 dark:text-zinc-600 dark:hover:text-zinc-500" />
                        )}
                      </button>

                      {/* Title */}
                      <div className="flex items-center gap-2 min-w-0 pr-2">
                        <button
                          onClick={() => setExpandedId(expandedId === todo.id ? null : todo.id)}
                          className="shrink-0 rounded p-0.5 text-zinc-300 hover:text-zinc-500 dark:text-zinc-600 dark:hover:text-zinc-400"
                        >
                          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expandedId === todo.id ? '' : '-rotate-90'}`} />
                        </button>
                        {editingCell?.id === todo.id && editingCell.field === 'title' ? (
                          <input
                            ref={editInputRef}
                            value={editingValue}
                            onChange={e => setEditingValue(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') commitEdit();
                              if (e.key === 'Escape') cancelEdit();
                            }}
                            onBlur={commitEdit}
                            className="flex-1 rounded border border-zinc-300 px-2 py-0.5 text-sm outline-none focus:border-zinc-500 dark:border-zinc-600 dark:bg-zinc-900 dark:focus:border-zinc-400"
                          />
                        ) : (
                          <span
                            className={`flex-1 truncate text-sm cursor-text ${todo.status === 'done' ? 'line-through text-zinc-400' : 'text-zinc-900 dark:text-zinc-100'}`}
                            onClick={() => startEditTitle(todo)}
                          >
                            {todo.title}
                          </span>
                        )}
                      </div>

                      {/* Agent column */}
                      <div>
                        <select
                          value={todo.agentId ?? ''}
                          onChange={e => handleUpdate(todo.id, { agentId: e.target.value || null as unknown as string })}
                          className="w-full truncate rounded border border-transparent px-1.5 py-0.5 text-xs text-zinc-500 bg-transparent transition-colors hover:border-zinc-200 hover:bg-zinc-50 focus:border-zinc-300 focus:bg-white focus:outline-none dark:text-zinc-400 dark:hover:border-zinc-700 dark:hover:bg-zinc-800 dark:focus:border-zinc-600 dark:focus:bg-zinc-900"
                        >
                          <option value="">{t('noAgent')}</option>
                          {agents.map(a => (
                            <option key={a.id} value={a.id}>{a.name}</option>
                          ))}
                        </select>
                      </div>

                      {/* Priority badge */}
                      <div>
                        <button
                          onClick={() => handleUpdate(todo.id, { priority: cyclePriority(todo.priority) })}
                          className="flex items-center gap-1.5 rounded-full border border-zinc-200 px-2 py-0.5 text-xs transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                        >
                          <span className={`h-2 w-2 rounded-full ${priorityConfig[todo.priority].dot}`} />
                          <span className="text-zinc-600 dark:text-zinc-400">{priorityConfig[todo.priority].label}</span>
                        </button>
                      </div>

                      {/* Status badge */}
                      <div>
                        <button
                          onClick={() => handleUpdate(todo.id, { status: cycleStatus(todo.status) })}
                          className={`rounded-md px-2 py-0.5 text-xs font-medium transition-colors ${statusConfig[todo.status].bg} ${statusConfig[todo.status].color}`}
                        >
                          {statusConfig[todo.status].label}
                        </button>
                      </div>

                      {/* Created at */}
                      <span className="text-xs text-zinc-400">{formatDate(todo.createdAt)}</span>

                      {/* Delete */}
                      <button
                        onClick={() => handleDelete(todo.id)}
                        className="rounded p-1 text-zinc-300 opacity-0 transition-opacity hover:bg-red-50 hover:text-red-500 group-hover:opacity-100 dark:text-zinc-600 dark:hover:bg-red-950/30 dark:hover:text-red-400"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    {/* Expanded description row */}
                    {expandedId === todo.id && (
                      <div className="border-b border-zinc-100 bg-zinc-50/50 px-4 py-3 pl-14 dark:border-zinc-800/50 dark:bg-zinc-900/20">
                        {editingCell?.id === todo.id && editingCell.field === 'description' ? (
                          <textarea
                            ref={editTextareaRef}
                            value={editingValue}
                            onChange={e => setEditingValue(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Escape') cancelEdit();
                              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) commitEdit();
                            }}
                            onBlur={commitEdit}
                            rows={3}
                            placeholder={t('descriptionPlaceholder')}
                            className="w-full resize-y rounded border border-zinc-300 px-3 py-2 text-sm outline-none placeholder:text-zinc-400 focus:border-zinc-500 dark:border-zinc-600 dark:bg-zinc-900 dark:placeholder:text-zinc-500 dark:focus:border-zinc-400"
                          />
                        ) : (
                          <div
                            onClick={() => startEditDescription(todo)}
                            className="min-h-[2rem] cursor-text text-sm leading-relaxed text-zinc-600 dark:text-zinc-400"
                          >
                            {todo.description || (
                              <span className="text-zinc-300 dark:text-zinc-600">{t('descriptionPlaceholder')}</span>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Create new row */}
              {isCreating && (
                <div className="flex items-center gap-2 border-b border-zinc-100 px-4 py-2.5 dark:border-zinc-800/50">
                  <div className="w-7" />
                  <input
                    ref={createInputRef}
                    value={creatingTitle}
                    onChange={e => setCreatingTitle(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') { handleCreate(); }
                      if (e.key === 'Escape') { setIsCreating(false); setCreatingTitle(''); }
                    }}
                    onBlur={() => {
                      if (!creatingTitle.trim()) { setIsCreating(false); setCreatingTitle(''); }
                    }}
                    placeholder={t('placeholder')}
                    className="flex-1 rounded border border-zinc-300 px-2 py-1 text-sm outline-none placeholder:text-zinc-400 focus:border-zinc-500 dark:border-zinc-600 dark:bg-zinc-900 dark:placeholder:text-zinc-500 dark:focus:border-zinc-400"
                  />
                </div>
              )}
            </div>
          )}

          {/* Bottom add button */}
          {!isCreating && !loading && (
            <button
              onClick={() => setIsCreating(true)}
              className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-zinc-400 transition-colors hover:bg-zinc-50 hover:text-zinc-600 dark:hover:bg-zinc-900/40 dark:hover:text-zinc-300"
            >
              <Plus className="h-3.5 w-3.5" />
              {t('newTodo')}
            </button>
          )}
        </div>

        {/* Batch action bar */}
        {hasSelection && (
          <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
            <div className="pointer-events-auto flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white px-5 py-4 shadow-2xl dark:border-zinc-700 dark:bg-zinc-900">
              <span className="mr-3 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
                {t('selectedCount', { count: selectedIds.size })}
              </span>

              <div className="mx-1 h-7 w-px bg-zinc-200 dark:bg-zinc-700" />

              {/* AI Execute */}
              <button
                onClick={() => handleAIExecute()}
                className="flex items-center gap-1.5 rounded-lg bg-blue-500 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-600"
              >
                <Play className="h-3.5 w-3.5" />
                {t('aiExecute')}
              </button>

              <div className="mx-1 h-7 w-px bg-zinc-200 dark:bg-zinc-700" />

              {/* Assign Agent */}
              <button
                onClick={() => setAgentPickerFor('assign')}
                className="flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
              >
                <Bot className="h-3.5 w-3.5" />
                {t('assignAgent')}
              </button>

              <div className="mx-1 h-7 w-px bg-zinc-200 dark:bg-zinc-700" />

              {/* Status actions */}
              <button
                onClick={() => handleBatchAction('update', { status: 'pending' })}
                className={`rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ${statusConfig.pending.bg} ${statusConfig.pending.color} hover:opacity-80`}
              >
                {t('batchMarkPending')}
              </button>
              <button
                onClick={() => handleBatchAction('update', { status: 'in_progress' })}
                className={`rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ${statusConfig.in_progress.bg} ${statusConfig.in_progress.color} hover:opacity-80`}
              >
                {t('batchMarkInProgress')}
              </button>
              <button
                onClick={() => handleBatchAction('update', { status: 'done' })}
                className={`rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ${statusConfig.done.bg} ${statusConfig.done.color} hover:opacity-80`}
              >
                {t('batchMarkDone')}
              </button>

              <div className="mx-1 h-7 w-px bg-zinc-200 dark:bg-zinc-700" />

              {/* Priority actions */}
              {(['high', 'medium', 'low'] as const).map(p => (
                <button
                  key={p}
                  onClick={() => handleBatchAction('update', { priority: p })}
                  className="flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                >
                  <span className={`h-2.5 w-2.5 rounded-full ${priorityConfig[p].dot}`} />
                  {t(`batchPriority${p.charAt(0).toUpperCase() + p.slice(1)}` as 'batchPriorityHigh' | 'batchPriorityMedium' | 'batchPriorityLow')}
                </button>
              ))}

              <div className="mx-1 h-7 w-px bg-zinc-200 dark:bg-zinc-700" />

              {/* Delete */}
              <button
                onClick={() => handleBatchAction('delete')}
                className="rounded-lg px-3.5 py-2 text-sm font-medium text-red-500 transition-colors hover:bg-red-50 dark:hover:bg-red-950/30"
              >
                {t('batchDelete')}
              </button>

              <div className="mx-1 h-7 w-px bg-zinc-200 dark:bg-zinc-700" />

              {/* Clear selection */}
              <button
                onClick={() => setSelectedIds(new Set())}
                className="rounded-lg px-3.5 py-2 text-sm font-medium text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
              >
                {t('clearSelection')}
              </button>
            </div>
          </div>
        )}

        {/* Agent Picker Modal */}
        {agentPickerFor && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30" onClick={() => setAgentPickerFor(null)}>
            <div className="w-80 rounded-xl border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-700 dark:bg-zinc-900" onClick={e => e.stopPropagation()}>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{t('selectAgent')}</h3>
                <button onClick={() => setAgentPickerFor(null)} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="space-y-1">
                {agents.map(a => (
                  <button
                    key={a.id}
                    onClick={() => handleAgentPick(a.id)}
                    className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  >
                    <Bot className="h-4 w-4 shrink-0 text-zinc-400" />
                    <div className="min-w-0">
                      <div className="truncate font-medium text-zinc-900 dark:text-zinc-100">{a.name}</div>
                      {a.description && <div className="truncate text-xs text-zinc-400">{a.description}</div>}
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

        {/* After-launch dialog */}
        {launchedSessionId && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30" onClick={() => setLaunchedSessionId(null)}>
            <div className="w-72 rounded-xl border border-zinc-200 bg-white p-5 shadow-xl dark:border-zinc-700 dark:bg-zinc-900" onClick={e => e.stopPropagation()}>
              <div className="mb-4 text-center">
                <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-green-500" />
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{t('startedChat')}</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setLaunchedSessionId(null)}
                  className="flex-1 rounded-lg border border-zinc-200 px-3 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  {t('stayHere')}
                </button>
                <button
                  onClick={() => {
                    setLaunchedSessionId(null);
                    router.push('/flows/agents');
                  }}
                  className="flex-1 rounded-lg bg-blue-500 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-600"
                >
                  {t('goToChat')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
