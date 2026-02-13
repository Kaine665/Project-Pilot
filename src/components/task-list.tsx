'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { Task, ProjectConfig } from '@/types';
import { Plus, RefreshCw } from 'lucide-react';

interface TaskListProps {
  selectedTaskId: string | null;
  onSelect: (taskId: string) => void;
}

const statusOrder: Record<string, number> = { doing: 0, todo: 1, done: 2 };

const statusColors: Record<string, string> = {
  doing: 'bg-blue-500',
  todo: 'bg-zinc-400',
  done: 'bg-green-500',
};

const statusLabels: Record<string, string> = {
  doing: '进行中',
  todo: '待办',
  done: '已完成',
};

export function TaskList({ selectedTaskId, onSelect }: TaskListProps) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Record<string, ProjectConfig>>({});
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newProject, setNewProject] = useState('');

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

  const fetchProjects = useCallback(async () => {
    try {
      const res = await fetch('/api/projects');
      if (res.ok) {
        const data = await res.json();
        setProjects(data.projects ?? {});
      }
    } catch (err) {
      console.error('Failed to fetch projects:', err);
    }
  }, []);

  useEffect(() => {
    fetchTasks();
    fetchProjects();
  }, [fetchTasks, fetchProjects]);

  const sortedTasks = [...tasks].sort(
    (a, b) => (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9),
  );

  const handleCreate = async () => {
    if (!newTitle.trim() || !newProject) return;
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle.trim(), projectKey: newProject }),
      });
      if (res.ok) {
        setNewTitle('');
        setNewProject('');
        setShowForm(false);
        fetchTasks();
      }
    } catch (err) {
      console.error('Failed to create task:', err);
    }
  };

  const projectOptions = Object.entries(projects).map(([key, cfg]) => ({
    value: key,
    label: cfg.name,
  }));

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="text-sm font-semibold">任务列表</h2>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={fetchTasks} title="刷新">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setShowForm(!showForm)} title="新建任务">
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* New task form */}
      {showForm && (
        <div className="flex flex-col gap-2 border-b border-zinc-200 p-3 dark:border-zinc-800">
          <Input
            placeholder="任务标题"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
          />
          <Select
            options={projectOptions}
            placeholder="选择项目"
            value={newProject}
            onChange={setNewProject}
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={handleCreate} disabled={!newTitle.trim() || !newProject}>
              创建
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowForm(false)}>
              取消
            </Button>
          </div>
        </div>
      )}

      {/* Task list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-4 text-center text-sm text-zinc-400">加载中...</div>
        ) : sortedTasks.length === 0 ? (
          <div className="p-4 text-center text-sm text-zinc-400">暂无任务</div>
        ) : (
          <div className="flex flex-col">
            {sortedTasks.map((task) => (
              <button
                key={task.id}
                onClick={() => onSelect(task.id)}
                className={cn(
                  'flex flex-col gap-1 border-b border-zinc-100 px-4 py-3 text-left transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900',
                  selectedTaskId === task.id && 'bg-zinc-100 dark:bg-zinc-800/70',
                )}
              >
                <div className="flex items-center gap-2">
                  <span className={cn('h-2 w-2 shrink-0 rounded-full', statusColors[task.status])} />
                  <span className="truncate text-sm font-medium">{task.title}</span>
                </div>
                <div className="flex items-center gap-2 pl-4">
                  <Badge variant="secondary" className="text-[10px]">
                    {projects[task.projectKey]?.name ?? task.projectKey}
                  </Badge>
                  <span className="text-[10px] text-zinc-400">{statusLabels[task.status]}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
