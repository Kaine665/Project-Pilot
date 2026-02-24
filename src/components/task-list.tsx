'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { useRouter } from '@/i18n/routing';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { Session } from '@/types';
import { Plus, Archive, ArchiveRestore, Pencil, Trash2, Search, X } from 'lucide-react';

type TaskWithAI = Session & { aiStatus?: 'running' | 'waiting' | 'confirm' | null };

const statusColors: Record<string, string> = {
  doing: 'bg-blue-500',
  todo: 'bg-zinc-400',
  done: 'bg-green-500',
};

export function TaskList() {
  const router = useRouter();
  const params = useParams<{ id?: string }>();
  const selectedTaskId = params.id ?? null;
  const t = useTranslations('tasks');
  const [tasks, setTasks] = useState<TaskWithAI[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [filter, setFilter] = useState<'all' | 'active' | 'done' | 'archived'>('active');
  const [searchText, setSearchText] = useState('');
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');

  const fetchTasks = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/tasks');
      if (res.ok) {
        const data = await res.json();
        setTasks(data.tasks ?? []);
      }
    } catch (err) {
      console.error('Failed to fetch tasks:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTasks();
    const onTaskUpdated = () => fetchTasks();
    window.addEventListener('task-updated', onTaskUpdated);
    return () => window.removeEventListener('task-updated', onTaskUpdated);
  }, [fetchTasks]);

  const statusOrder: Record<string, number> = { doing: 0, todo: 1, done: 2 };

  const visibleTasks = tasks
    .filter((t) => {
      if (filter === 'archived') return !!t.archived;
      if (filter === 'all') return true;
      if (filter === 'active') return !t.archived && (t.status === 'todo' || t.status === 'doing');
      return !t.archived && t.status === filter;
    })
    .filter((t) => {
      if (!searchText.trim()) return true;
      const q = searchText.toLowerCase().trim();
      return t.title.toLowerCase().includes(q) ||
        (t.content ?? '').toLowerCase().includes(q);
    })
    .sort((a, b) => (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9));

  const handleCreate = async () => {
    if (!newTitle.trim()) return;
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle.trim() }),
      });
      if (res.ok) {
        const task = await res.json();
        setNewTitle('');
        setShowForm(false);
        fetchTasks();
        router.push(`/tasks/${task.id}`);
      }
    } catch (err) {
      console.error('Failed to create task:', err);
    }
  };

  const handleToggleArchive = async (e: React.MouseEvent, taskId: string, currentlyArchived: boolean) => {
    e.stopPropagation();
    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived: !currentlyArchived }),
      });
      if (res.ok) {
        fetchTasks();
      }
    } catch (err) {
      console.error('Failed to toggle archive:', err);
    }
  };

  const handleStartEdit = (e: React.MouseEvent, taskId: string, currentTitle: string) => {
    e.stopPropagation();
    setEditingTaskId(taskId);
    setEditingTitle(currentTitle);
  };

  const handleSaveEdit = async (taskId: string) => {
    if (!editingTitle.trim()) {
      setEditingTaskId(null);
      return;
    }
    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: editingTitle.trim() }),
      });
      if (res.ok) {
        fetchTasks();
        setEditingTaskId(null);
      }
    } catch (err) {
      console.error('Failed to update task title:', err);
    }
  };

  const handleCancelEdit = () => {
    setEditingTaskId(null);
    setEditingTitle('');
  };

  const handleDelete = async (e: React.MouseEvent, taskId: string) => {
    e.stopPropagation();
    if (!confirm(t('confirmDelete'))) return;
    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        fetchTasks();
        // If the deleted task was currently selected, redirect to tasks list
        if (selectedTaskId === taskId) {
          router.push('/tasks');
        }
      }
    } catch (err) {
      console.error('Failed to delete task:', err);
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* New task button */}
      <div className="p-3">
        <Button
          variant="outline"
          className="w-full justify-start gap-2 text-sm font-normal text-zinc-500 dark:text-zinc-400"
          onClick={() => setShowForm(!showForm)}
        >
          <Plus className="h-4 w-4" />
          {t('newTask')}
        </Button>
      </div>

      {/* New task form */}
      {showForm && (
        <div className="flex flex-col gap-2 border-b border-zinc-200 px-3 pb-3 dark:border-zinc-800">
          <Input
            placeholder={t('placeholder')}
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            autoFocus
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={handleCreate} disabled={!newTitle.trim()}>
              {t('create')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowForm(false)}>
              {t('cancel')}
            </Button>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="px-3 pt-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400 pointer-events-none" />
          <input
            type="text"
            placeholder={t('searchPlaceholder')}
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
            className="w-full text-sm border border-zinc-200 dark:border-zinc-700 rounded-md pl-8 pr-7 py-1.5 outline-none focus:ring-1 focus:ring-ring bg-transparent text-foreground placeholder:text-zinc-400"
          />
          {searchText && (
            <button
              className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-foreground"
              onClick={() => setSearchText('')}
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {/* Section label + filter */}
      <div className="flex items-center gap-2 px-4 pb-1 pt-2">
        <span className="text-sm font-medium text-zinc-400 dark:text-zinc-500">{t('title')}</span>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as typeof filter)}
          className="h-7 rounded border border-zinc-200 bg-transparent px-1.5 text-sm text-zinc-400 outline-none dark:border-zinc-700 dark:text-zinc-500"
        >
          <option value="active">{t('filters.active')}</option>
          <option value="done">{t('filters.done')}</option>
          <option value="archived">{t('filters.archived')}</option>
          <option value="all">{t('filters.all')}</option>
        </select>
      </div>

      {/* Task list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-4 text-center text-sm text-zinc-400">{t('loading')}</div>
        ) : visibleTasks.length === 0 ? (
          <div className="p-4 text-center text-sm text-zinc-400">{t('noTasks')}</div>
        ) : (
          <div className="flex flex-col">
            {visibleTasks.map((task) => {
              const isEditing = editingTaskId === task.id;
              return (
                <div
                  key={task.id}
                  className={cn(
                    'group flex items-center gap-2 px-4 py-2.5 transition-colors',
                    !isEditing && 'cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-900',
                    selectedTaskId === task.id && 'bg-zinc-100 dark:bg-zinc-800/70',
                  )}
                  onClick={() => !isEditing && router.push(`/tasks/${task.id}`)}
                >
                  <span className={cn(
                    'h-2 w-2 shrink-0 rounded-full',
                    task.aiStatus === 'confirm' ? 'animate-blink-confirm'
                      : task.aiStatus === 'waiting' ? 'animate-blink-waiting'
                      : statusColors[task.status],
                  )} />

                  {isEditing ? (
                    <Input
                      autoFocus
                      value={editingTitle}
                      onChange={(e) => setEditingTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveEdit(task.id);
                        if (e.key === 'Escape') handleCancelEdit();
                      }}
                      onBlur={() => handleSaveEdit(task.id)}
                      className="flex-1 h-7 text-sm"
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <span className="flex-1 truncate text-sm">
                      {task.title}
                      {task.aiStatus === 'running' && (
                        <span className="ml-1.5 inline-flex items-center rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium leading-none text-emerald-500">
                          {t('status.running')}
                        </span>
                      )}
                    </span>
                  )}

                  {!isEditing && (
                    <>
                      <span
                        role="button"
                        tabIndex={-1}
                        onClick={(e) => handleStartEdit(e, task.id, task.title)}
                        className="shrink-0 rounded p-1 opacity-0 transition-opacity hover:bg-blue-50 group-hover:opacity-100 dark:hover:bg-blue-950/30"
                        title={t('edit')}
                      >
                        <Pencil className="h-3.5 w-3.5 text-zinc-400 hover:text-blue-500 dark:hover:text-blue-400" />
                      </span>
                      {task.archived && (
                        <span
                          role="button"
                          tabIndex={-1}
                          onClick={(e) => handleDelete(e, task.id)}
                          className="shrink-0 rounded p-1 opacity-0 transition-opacity hover:bg-red-50 group-hover:opacity-100 dark:hover:bg-red-950/30"
                          title={t('delete')}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-zinc-400 hover:text-red-500 dark:hover:text-red-400" />
                        </span>
                      )}
                      <span
                        role="button"
                        tabIndex={-1}
                        onClick={(e) => handleToggleArchive(e, task.id, !!task.archived)}
                        className="shrink-0 rounded p-1 opacity-0 transition-opacity hover:bg-zinc-200 group-hover:opacity-100 dark:hover:bg-zinc-700"
                        title={task.archived ? t('unarchive') : t('archive')}
                      >
                        {task.archived ? (
                          <ArchiveRestore className="h-3.5 w-3.5 text-zinc-400" />
                        ) : (
                          <Archive className="h-3.5 w-3.5 text-zinc-400" />
                        )}
                      </span>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
