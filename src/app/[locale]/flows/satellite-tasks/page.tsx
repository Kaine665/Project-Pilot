'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Satellite,
  Loader2,
  Cpu,
  Zap,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  XCircle,
  SkipForward,
  Trash2,
  Clock,
  Activity,
  Settings2,
  Save,
  RotateCcw,
} from 'lucide-react';

// ── Types ──

interface RunStats {
  total: number;
  success: number;
  failed: number;
  skipped: number;
  lastRunAt: number | null;
  avgDurationMs: number | null;
}

interface ConfigFieldSchema {
  type: 'number' | 'string' | 'boolean' | 'array';
  title: string;
  description?: string;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  items?: { type: 'number' | 'string' };
}

type TaskConfigSchema = Record<string, ConfigFieldSchema>;

interface SatelliteTaskItem {
  id: string;
  description: string;
  priority: number;
  requiresAI: boolean;
  enabled: boolean;
  configSchema: TaskConfigSchema | null;
  params: Record<string, unknown>;
  stats: RunStats;
}

interface RunRecord {
  id: string;
  taskId: string;
  sessionId: string;
  agentId: string;
  timestamp: number;
  durationMs: number;
  status: 'success' | 'skipped' | 'failed';
  detail?: string;
}

// ── Helpers ──

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH} 小时前`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) return `${diffD} 天前`;
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

const statusConfig = {
  success: { icon: CheckCircle2, color: 'text-emerald-500', label: '成功' },
  failed: { icon: XCircle, color: 'text-red-500', label: '失败' },
  skipped: { icon: SkipForward, color: 'text-zinc-400', label: '跳过' },
} as const;

/** Get the effective value for a config field (user value or schema default). */
function getFieldValue(params: Record<string, unknown>, fieldKey: string, schema: ConfigFieldSchema): unknown {
  return params[fieldKey] !== undefined ? params[fieldKey] : schema.default;
}

// ── Components ──

function StatsBar({ stats }: { stats: RunStats }) {
  if (stats.total === 0) {
    return <span className="text-xs text-zinc-400">暂无执行记录</span>;
  }

  return (
    <div className="flex items-center gap-3 text-xs text-zinc-500 dark:text-zinc-400">
      <span className="flex items-center gap-1">
        <Activity className="h-3 w-3" />
        {stats.total} 次
      </span>
      {stats.success > 0 && (
        <span className="text-emerald-600 dark:text-emerald-400">✓ {stats.success}</span>
      )}
      {stats.failed > 0 && (
        <span className="text-red-500">✗ {stats.failed}</span>
      )}
      {stats.avgDurationMs !== null && (
        <span className="flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {formatDuration(stats.avgDurationMs)}
        </span>
      )}
      {stats.lastRunAt && <span>最近: {formatTime(stats.lastRunAt)}</span>}
    </div>
  );
}

function RunHistoryPanel({ taskId }: { taskId: string }) {
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);

  const fetchRuns = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/satellite-tasks/runs?taskId=${encodeURIComponent(taskId)}&limit=20`,
      );
      if (!res.ok) throw new Error('Failed to fetch runs');
      const data = await res.json();
      setRuns(data.runs ?? []);
      setTotal(data.total ?? 0);
    } catch (err) {
      console.error('Failed to load runs:', err);
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);

  const handleClear = async () => {
    if (!confirm('确定清空该任务的所有执行记录？')) return;
    setClearing(true);
    try {
      await fetch('/api/satellite-tasks/runs', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId }),
      });
      setRuns([]);
      setTotal(0);
    } catch (err) {
      console.error('Failed to clear runs:', err);
    } finally {
      setClearing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />
      </div>
    );
  }

  return (
    <div className="border-t border-zinc-100 bg-zinc-50/50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950/50">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
          执行记录 ({total} 条)
        </span>
        {total > 0 && (
          <button
            onClick={handleClear}
            disabled={clearing}
            className="flex items-center gap-1 rounded px-2 py-0.5 text-xs text-zinc-400 transition-colors hover:bg-zinc-200 hover:text-red-500 disabled:opacity-50 dark:hover:bg-zinc-800"
          >
            <Trash2 className="h-3 w-3" />
            清空
          </button>
        )}
      </div>

      {runs.length === 0 ? (
        <p className="py-3 text-center text-xs text-zinc-400">暂无记录</p>
      ) : (
        <div className="max-h-64 space-y-1 overflow-y-auto">
          {runs.map((run) => {
            const cfg = statusConfig[run.status];
            const Icon = cfg.icon;
            return (
              <div
                key={run.id}
                className="flex items-center gap-3 rounded-md px-2 py-1.5 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800/50"
              >
                <Icon className={`h-3.5 w-3.5 shrink-0 ${cfg.color}`} />
                <span className={`shrink-0 w-8 ${cfg.color}`}>{cfg.label}</span>
                <span className="shrink-0 text-zinc-400">{formatDuration(run.durationMs)}</span>
                {run.detail && (
                  <span
                    className="min-w-0 truncate text-zinc-500 dark:text-zinc-400"
                    title={run.detail}
                  >
                    {run.detail}
                  </span>
                )}
                <span className="ml-auto shrink-0 text-zinc-400">{formatTime(run.timestamp)}</span>
              </div>
            );
          })}
          {total > runs.length && (
            <p className="py-1 text-center text-[10px] text-zinc-400">
              还有 {total - runs.length} 条更早的记录
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function ConfigPanel({
  taskId,
  configSchema,
  initialParams,
  onSaved,
}: {
  taskId: string;
  configSchema: TaskConfigSchema;
  initialParams: Record<string, unknown>;
  onSaved: (params: Record<string, unknown>) => void;
}) {
  const [draft, setDraft] = useState<Record<string, unknown>>(() => {
    // Initialize draft with current values or defaults
    const init: Record<string, unknown> = {};
    for (const [key, schema] of Object.entries(configSchema)) {
      init[key] = getFieldValue(initialParams, key, schema);
    }
    return init;
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const fields = Object.entries(configSchema);

  const handleChange = (key: string, value: unknown) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const handleReset = () => {
    const defaults: Record<string, unknown> = {};
    for (const [key, schema] of Object.entries(configSchema)) {
      defaults[key] = schema.default;
    }
    setDraft(defaults);
    setSaved(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/satellite-tasks', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: taskId, params: draft }),
      });
      if (res.ok) {
        setSaved(true);
        onSaved(draft);
        setTimeout(() => setSaved(false), 2000);
      }
    } catch (err) {
      console.error('Failed to save params:', err);
    } finally {
      setSaving(false);
    }
  };

  const renderField = (key: string, schema: ConfigFieldSchema) => {
    const value = draft[key];

    if (schema.type === 'number') {
      return (
        <input
          type="number"
          value={typeof value === 'number' ? value : ''}
          min={schema.minimum}
          max={schema.maximum}
          onChange={(e) => handleChange(key, Number(e.target.value))}
          className="w-24 rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
        />
      );
    }

    if (schema.type === 'boolean') {
      return (
        <button
          onClick={() => handleChange(key, !value)}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
            value ? 'bg-indigo-600' : 'bg-zinc-200 dark:bg-zinc-700'
          }`}
          role="switch"
          aria-checked={!!value}
        >
          <span
            className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
              value ? 'translate-x-[18px]' : 'translate-x-0.5'
            }`}
          />
        </button>
      );
    }

    if (schema.type === 'string') {
      return (
        <input
          type="text"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => handleChange(key, e.target.value)}
          className="w-full max-w-xs rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
        />
      );
    }

    if (schema.type === 'array') {
      const arr = Array.isArray(value) ? value : [];
      return (
        <input
          type="text"
          value={arr.join(', ')}
          onChange={(e) => {
            const raw = e.target.value;
            const parsed = raw
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
              .map((s) => (schema.items?.type === 'number' ? Number(s) : s))
              .filter((v) => (schema.items?.type === 'number' ? !isNaN(v as number) : true));
            handleChange(key, parsed);
          }}
          placeholder="逗号分隔"
          className="w-full max-w-xs rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
        />
      );
    }

    return null;
  };

  return (
    <div className="border-t border-zinc-100 bg-zinc-50/50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950/50">
      <div className="mb-3 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">
          <Settings2 className="h-3.5 w-3.5" />
          参数配置
        </span>
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleReset}
            className="flex items-center gap-1 rounded px-2 py-0.5 text-xs text-zinc-400 transition-colors hover:bg-zinc-200 hover:text-zinc-600 dark:hover:bg-zinc-800"
            title="恢复默认值"
          >
            <RotateCcw className="h-3 w-3" />
            默认
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1 rounded bg-indigo-600 px-2.5 py-0.5 text-xs text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : saved ? (
              <CheckCircle2 className="h-3 w-3" />
            ) : (
              <Save className="h-3 w-3" />
            )}
            {saved ? '已保存' : '保存'}
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {fields.map(([key, schema]) => (
          <div key={key} className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                {schema.title}
              </div>
              {schema.description && (
                <div className="mt-0.5 text-[11px] text-zinc-400">{schema.description}</div>
              )}
            </div>
            <div className="shrink-0">{renderField(key, schema)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main Page ──

export default function SatelliteTasksPage() {
  const [tasks, setTasks] = useState<SatelliteTaskItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [configOpenId, setConfigOpenId] = useState<string | null>(null);

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
        setTasks((prev) =>
          prev.map((t) => (t.id === taskId ? { ...t, enabled: !currentEnabled } : t)),
        );
      }
    } catch (err) {
      console.error('Failed to toggle task:', err);
    } finally {
      setToggling(null);
    }
  };

  const toggleExpand = (taskId: string) => {
    setExpandedId((prev) => (prev === taskId ? null : taskId));
  };

  const toggleConfig = (taskId: string) => {
    setConfigOpenId((prev) => (prev === taskId ? null : taskId));
  };

  const handleParamsSaved = (taskId: string, params: Record<string, unknown>) => {
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, params } : t)));
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
            <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">卫星任务</h1>
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
            {tasks.map((task) => {
              const isExpanded = expandedId === task.id;
              const isConfigOpen = configOpenId === task.id;
              const hasConfig = task.configSchema && Object.keys(task.configSchema).length > 0;
              return (
                <div
                  key={task.id}
                  className={`overflow-hidden rounded-lg border transition-colors ${
                    task.enabled
                      ? 'border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900'
                      : 'border-zinc-100 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950'
                  }`}
                >
                  {/* Task card header */}
                  <div className="flex items-center justify-between p-4">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
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
                      <div className="min-w-0 flex-1">
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
                        <div className="mt-1 flex items-center gap-3 text-xs text-zinc-400">
                          <span>优先级: {task.priority}</span>
                          <span>{task.requiresAI ? '需要 AI 调用' : '本地执行'}</span>
                        </div>
                        {/* Stats bar */}
                        <div className="mt-1.5">
                          <StatsBar stats={task.stats} />
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0 ml-3">
                      {/* Config button (only if task has configurable params) */}
                      {hasConfig && (
                        <button
                          onClick={() => toggleConfig(task.id)}
                          className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
                            isConfigOpen
                              ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-400'
                              : 'text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300'
                          }`}
                          title="参数配置"
                        >
                          <Settings2 className="h-4 w-4" />
                        </button>
                      )}

                      {/* Expand button */}
                      <button
                        onClick={() => toggleExpand(task.id)}
                        className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
                        title={isExpanded ? '收起' : '展开执行记录'}
                      >
                        {isExpanded ? (
                          <ChevronUp className="h-4 w-4" />
                        ) : (
                          <ChevronDown className="h-4 w-4" />
                        )}
                      </button>

                      {/* Toggle switch */}
                      <button
                        onClick={() => handleToggle(task.id, task.enabled)}
                        disabled={toggling === task.id}
                        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-wait disabled:opacity-60 ${
                          task.enabled ? 'bg-indigo-600' : 'bg-zinc-200 dark:bg-zinc-700'
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
                  </div>

                  {/* Config panel */}
                  {isConfigOpen && hasConfig && task.configSchema && (
                    <ConfigPanel
                      taskId={task.id}
                      configSchema={task.configSchema}
                      initialParams={task.params}
                      onSaved={(params) => handleParamsSaved(task.id, params)}
                    />
                  )}

                  {/* Expandable run history */}
                  {isExpanded && <RunHistoryPanel taskId={task.id} />}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
