'use client';

import { useState, useEffect, useCallback } from 'react';
import { Satellite, Loader2, Cpu, Zap } from 'lucide-react';

interface SatelliteTaskItem {
  id: string;
  description: string;
  priority: number;
  requiresAI: boolean;
  enabled: boolean;
}

export default function SatelliteTasksPage() {
  const [tasks, setTasks] = useState<SatelliteTaskItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);

  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch('/api/satellite-tasks');
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      setTasks(data.tasks ?? []);
    } catch (err) {
      console.error('Failed to load satellite tasks:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const handleToggle = async (taskId: string, currentEnabled: boolean) => {
    setToggling(taskId);
    try {
      const res = await fetch('/api/satellite-tasks', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: taskId, enabled: !currentEnabled }),
      });
      if (res.ok) {
        setTasks(prev =>
          prev.map(t => (t.id === taskId ? { ...t, enabled: !currentEnabled } : t)),
        );
      }
    } catch (err) {
      console.error('Failed to toggle task:', err);
    } finally {
      setToggling(null);
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-zinc-200 bg-white px-6 py-4 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-50 dark:bg-indigo-950/50">
            <Satellite className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              卫星任务
            </h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              每轮对话结束后自动执行的辅助任务
            </p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
          </div>
        ) : tasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-zinc-400">
            <Satellite className="mb-3 h-10 w-10" />
            <p>暂无已注册的卫星任务</p>
          </div>
        ) : (
          <div className="mx-auto max-w-2xl space-y-3">
            {tasks.map(task => (
              <div
                key={task.id}
                className={`flex items-center justify-between rounded-lg border p-4 transition-colors ${
                  task.enabled
                    ? 'border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900'
                    : 'border-zinc-100 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  {/* Icon */}
                  <div
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${
                      task.requiresAI
                        ? 'bg-amber-50 dark:bg-amber-950/40'
                        : 'bg-emerald-50 dark:bg-emerald-950/40'
                    }`}
                  >
                    {task.requiresAI ? (
                      <Cpu className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                    ) : (
                      <Zap className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                    )}
                  </div>

                  {/* Info */}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-sm font-medium ${
                          task.enabled
                            ? 'text-zinc-900 dark:text-zinc-100'
                            : 'text-zinc-400 dark:text-zinc-500'
                        }`}
                      >
                        {task.description}
                      </span>
                      <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-mono text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                        {task.id}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-3 text-xs text-zinc-400">
                      <span>优先级: {task.priority}</span>
                      <span>{task.requiresAI ? '需要 AI 调用' : '本地执行'}</span>
                    </div>
                  </div>
                </div>

                {/* Toggle switch */}
                <button
                  onClick={() => handleToggle(task.id, task.enabled)}
                  disabled={toggling === task.id}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-wait disabled:opacity-60 ${
                    task.enabled
                      ? 'bg-indigo-600'
                      : 'bg-zinc-200 dark:bg-zinc-700'
                  }`}
                  role="switch"
                  aria-checked={task.enabled}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-200 ${
                      task.enabled ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
