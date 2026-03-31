'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bot,
  Clock,
  History,
  Loader2,
  Pencil,
  Play,
  Plus,
  Power,
  PowerOff,
  Trash2,
} from 'lucide-react';
import type { Agent, AgentSchedule, ScheduleRunRecord, TodoItem } from '@/types';
import { useProject, type ProjectEntry } from '@/components/project-context';

const CRON_PRESETS = [
  { label: '每天 09:00', value: '0 9 * * *' },
  { label: '每天 18:00', value: '0 18 * * *' },
  { label: '每周一 09:00', value: '0 9 * * 1' },
  { label: '每小时', value: '0 * * * *' },
  { label: '每 30 分钟', value: '*/30 * * * *' },
  { label: '自定义', value: 'custom' },
];

type ScheduleTargetType = 'agent_message' | 'todo';

interface ScheduleFormValue {
  targetType: ScheduleTargetType;
  agentId?: string;
  todoId?: string;
  cron: string;
  message?: string;
  label?: string;
  projectKey?: string;
}

interface AgentSchedulesPanelProps {
  fixedTargetType?: ScheduleTargetType;
  title?: string;
  description?: string;
  createLabel?: string;
  emptyLabel?: string;
}

/** 与后端一致：仅 `todo` 为待办模式；`agent_message` / 旧版 `message` / 缺省均为 Agent 消息模式。 */
function normalizeTargetType(targetType?: string): ScheduleTargetType {
  if (targetType === 'todo') return 'todo';
  return 'agent_message';
}

function formatTime(iso?: string): string {
  if (!iso) return '从未';
  try {
    return new Date(iso).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function formatTimeWithSeconds(iso?: string): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return iso;
  }
}

function findCronPreset(cronValue: string): string {
  const preset = CRON_PRESETS.find((item) => item.value === cronValue);
  return preset ? preset.value : 'custom';
}

function targetLabel(targetType?: string): string {
  return normalizeTargetType(targetType) === 'todo' ? 'Todo' : 'Agent';
}

function ScheduleForm({
  agents,
  projects,
  todos,
  initial,
  fixedTargetType,
  onSave,
  onCancel,
  saveLabel,
}: {
  agents: Agent[];
  projects: ProjectEntry[];
  todos: TodoItem[];
  initial?: AgentSchedule;
  fixedTargetType?: ScheduleTargetType;
  onSave: (value: ScheduleFormValue) => Promise<void>;
  onCancel: () => void;
  saveLabel: string;
}) {
  const initialTargetType = fixedTargetType ?? normalizeTargetType(initial?.targetType);
  const [targetType, setTargetType] = useState<ScheduleTargetType>(initialTargetType);
  const [agentId, setAgentId] = useState(initial?.agentId ?? agents[0]?.id ?? '');
  const [todoId, setTodoId] = useState(initial?.todoId ?? '');
  const [cronPreset, setCronPreset] = useState(initial ? findCronPreset(initial.cron) : '0 9 * * *');
  const [customCron, setCustomCron] = useState(initial && findCronPreset(initial.cron) === 'custom' ? initial.cron : '');
  const [message, setMessage] = useState(initial?.message ?? '');
  const [label, setLabel] = useState(initial?.label ?? '');
  const [projectKey, setProjectKey] = useState(initial?.projectKey ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const availableTodos = useMemo(
    () => todos.filter((todo) => !!todo.agentId),
    [todos],
  );
  const selectedTodo = useMemo(
    () => availableTodos.find((todo) => todo.id === todoId),
    [availableTodos, todoId],
  );
  const cronValue = cronPreset === 'custom' ? customCron : cronPreset;

  useEffect(() => {
    if (targetType === 'todo' && selectedTodo?.projectKey && !projectKey) {
      setProjectKey(selectedTodo.projectKey);
    }
  }, [projectKey, selectedTodo, targetType]);

  async function handleSubmit() {
    if (!cronValue.trim()) {
      setError('cron 表达式不能为空');
      return;
    }

    if (targetType === 'agent_message') {
      if (!agentId) {
        setError('请选择 Agent');
        return;
      }
      if (!message.trim()) {
        setError('消息不能为空');
        return;
      }
    }

    if (targetType === 'todo' && !todoId) {
      setError('请选择 Todo');
      return;
    }

    setSaving(true);
    setError('');
    try {
      await onSave({
        targetType,
        agentId: targetType === 'agent_message' ? agentId : undefined,
        todoId: targetType === 'todo' ? todoId : undefined,
        cron: cronValue.trim(),
        message: targetType === 'agent_message' ? message.trim() : undefined,
        label: label.trim() || undefined,
        projectKey: projectKey || undefined,
      });
    } catch (err) {
      setError((err as Error).message || '保存失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="mb-1 block text-xs text-zinc-500">触发目标</label>
        <select
          value={targetType}
          onChange={(event) => setTargetType(event.target.value as ScheduleTargetType)}
          className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
        >
          <option value="agent_message">Agent 消息</option>
          <option value="todo">Todo</option>
        </select>
      </div>

      {targetType === 'agent_message' ? (
        <div>
          <label className="mb-1 block text-xs text-zinc-500">Agent</label>
          <select
            value={agentId}
            onChange={(event) => setAgentId(event.target.value)}
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
          >
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>{agent.name}</option>
            ))}
          </select>
        </div>
      ) : (
        <div>
          <label className="mb-1 block text-xs text-zinc-500">Todo</label>
          <select
            value={todoId}
            onChange={(event) => setTodoId(event.target.value)}
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="">请选择 Todo</option>
            {availableTodos.map((todo) => (
              <option key={todo.id} value={todo.id}>
                {todo.title}
              </option>
            ))}
          </select>
          {selectedTodo && (
            <p className="mt-1 text-[11px] text-zinc-400">
              关联 Agent: {selectedTodo.agentId} {selectedTodo.projectKey ? `· 项目: ${selectedTodo.projectKey}` : ''}
            </p>
          )}
        </div>
      )}

      <div>
        <label className="mb-1 block text-xs text-zinc-500">备注名称</label>
        <input
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="例如：晨报生成"
          maxLength={100}
          className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
        />
      </div>

      <div>
        <label className="mb-1 block text-xs text-zinc-500">cron</label>
        <select
          value={cronPreset}
          onChange={(event) => setCronPreset(event.target.value)}
          className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
        >
          {CRON_PRESETS.map((preset) => (
            <option key={preset.value} value={preset.value}>{preset.label}</option>
          ))}
        </select>
        {cronPreset === 'custom' ? (
          <input
            value={customCron}
            onChange={(event) => setCustomCron(event.target.value)}
            placeholder="例如：0 9 * * 1"
            className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-mono outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
          />
        ) : (
          <p className="mt-1 text-[11px] font-mono text-zinc-400">{cronPreset}</p>
        )}
      </div>

      {targetType === 'agent_message' && (
        <div>
          <label className="mb-1 block text-xs text-zinc-500">消息</label>
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            rows={4}
            maxLength={10000}
            placeholder="触发时发送给 Agent 的消息"
            className="w-full resize-none rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </div>
      )}

      {projects.length > 0 && (
        <div>
          <label className="mb-1 block text-xs text-zinc-500">绑定项目</label>
          <select
            value={projectKey}
            onChange={(event) => setProjectKey(event.target.value)}
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="">不绑定项目</option>
            {projects.map((project) => (
              <option key={project.key} value={project.key}>{project.name}</option>
            ))}
          </select>
        </div>
      )}

      {error && <p className="text-xs text-red-500">{error}</p>}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={saving}
          className="flex items-center gap-1.5 rounded-md bg-zinc-900 px-4 py-2 text-sm text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {saveLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-3 py-2 text-sm text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          取消
        </button>
      </div>
    </div>
  );
}

function RunHistory({ scheduleId }: { scheduleId: string }) {
  const [runs, setRuns] = useState<ScheduleRunRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/schedules/${scheduleId}/runs?limit=20`);
        const data = await res.json();
        if (!cancelled) {
          setRuns(data.runs ?? []);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [scheduleId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-2 text-xs text-zinc-400">
        <Loader2 className="h-3 w-3 animate-spin" />
        加载中
      </div>
    );
  }

  if (runs.length === 0) {
    return <p className="py-2 text-xs text-zinc-400">暂无执行记录</p>;
  }

  return (
    <div className="space-y-1">
      {runs.map((run) => (
        <div key={run.id} className="flex items-center gap-2 rounded px-2 py-1 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800">
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${run.status === 'failed' ? 'bg-red-500' : 'bg-green-500'}`} />
          <span className="text-zinc-500">{formatTimeWithSeconds(run.startedAt)}</span>
          <span className={`rounded px-1.5 py-0.5 ${run.trigger === 'manual' ? 'bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-300' : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'}`}>
            {run.trigger === 'manual' ? '手动' : '定时'}
          </span>
          {run.error ? (
            <span className="truncate text-red-500" title={run.error}>{run.error}</span>
          ) : (
            <span className="truncate font-mono text-zinc-400" title={run.sessionId}>
              {run.sessionId}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function ScheduleRow({
  schedule,
  agentName,
  todoTitle,
  agents,
  projects,
  todos,
  onToggle,
  onDelete,
  onUpdate,
}: {
  schedule: AgentSchedule;
  agentName: string;
  todoTitle?: string;
  agents: Agent[];
  projects: ProjectEntry[];
  todos: TodoItem[];
  onToggle: (id: string, enabled: boolean) => void;
  onDelete: (id: string) => void;
  onUpdate: (schedule: AgentSchedule) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [showRuns, setShowRuns] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const resolvedTargetType = normalizeTargetType(schedule.targetType);
  const summary = resolvedTargetType === 'todo'
    ? `Todo: ${todoTitle ?? schedule.todoId ?? '未找到'}`
    : (schedule.message ?? '');

  async function handleTrigger() {
    setTriggering(true);
    try {
      const res = await fetch(`/api/schedules/${schedule.id}/trigger`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || '触发失败');
      }
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setTriggering(false);
    }
  }

  async function handleSaveEdit(value: ScheduleFormValue) {
    const res = await fetch(`/api/schedules/${schedule.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetType: value.targetType,
        agentId: value.agentId,
        todoId: value.todoId,
        cron: value.cron,
        message: value.message,
        label: value.label,
        projectKey: value.projectKey,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '更新失败');
    onUpdate(data.schedule);
    setEditing(false);
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-start gap-3 p-4">
        <Clock className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" />
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
              {targetLabel(schedule.targetType)}
            </span>
            {resolvedTargetType === 'agent_message' && (
              <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] text-blue-600 dark:bg-blue-950/30 dark:text-blue-300">
                <Bot className="h-3 w-3" />
                {agentName}
              </span>
            )}
            <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
              {schedule.cron}
            </code>
            {schedule.label && (
              <span className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                {schedule.label}
              </span>
            )}
            {!schedule.enabled && (
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] text-zinc-500 dark:bg-zinc-800">
                已禁用
              </span>
            )}
          </div>
          <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{summary || '无摘要'}</p>
          {schedule.projectKey && (
            <p className="mt-1 text-[11px] text-zinc-400">项目: {schedule.projectKey}</p>
          )}
          <p className="mt-1 text-[11px] text-zinc-400">上次运行: {formatTime(schedule.lastRunAt)}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={handleTrigger}
            disabled={triggering}
            className="rounded-md p-1.5 text-zinc-400 hover:bg-blue-50 hover:text-blue-500 disabled:opacity-50 dark:hover:bg-blue-950/30"
            title="立即触发"
          >
            {triggering ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            onClick={() => { setEditing((value) => !value); setShowRuns(false); }}
            className={`rounded-md p-1.5 ${editing ? 'bg-blue-50 text-blue-500 dark:bg-blue-950/30 dark:text-blue-300' : 'text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}
            title="编辑"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => { setShowRuns((value) => !value); setEditing(false); }}
            className={`rounded-md p-1.5 ${showRuns ? 'bg-blue-50 text-blue-500 dark:bg-blue-950/30 dark:text-blue-300' : 'text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}
            title="执行历史"
          >
            <History className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onToggle(schedule.id, !schedule.enabled)}
            className={`rounded-md p-1.5 ${schedule.enabled ? 'text-green-600 hover:bg-green-50 dark:text-green-400 dark:hover:bg-green-950/30' : 'text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}
            title={schedule.enabled ? '禁用' : '启用'}
          >
            {schedule.enabled ? <Power className="h-3.5 w-3.5" /> : <PowerOff className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            onClick={() => {
              if (!confirm('确认删除这条规则？')) return;
              setDeleting(true);
              onDelete(schedule.id);
            }}
            disabled={deleting}
            className="rounded-md p-1.5 text-zinc-400 hover:bg-red-50 hover:text-red-500 disabled:opacity-50 dark:hover:bg-red-950/30"
            title="删除"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {editing && (
        <div className="border-t border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <ScheduleForm
            agents={agents}
            projects={projects}
            todos={todos}
            initial={schedule}
            onSave={handleSaveEdit}
            onCancel={() => setEditing(false)}
            saveLabel="保存"
          />
        </div>
      )}

      {showRuns && (
        <div className="border-t border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
          <h4 className="mb-2 text-xs font-medium text-zinc-500">最近 20 次执行</h4>
          <RunHistory scheduleId={schedule.id} />
        </div>
      )}
    </div>
  );
}

export function AgentSchedulesPanel() {
  const { projects } = useProject();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [schedules, setSchedules] = useState<AgentSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const agentMap = useMemo(
    () => new Map(agents.map((agent) => [agent.id, agent.name])),
    [agents],
  );
  const todoMap = useMemo(
    () => new Map(todos.map((todo) => [todo.id, todo])),
    [todos],
  );

  const fetchData = useCallback(async () => {
    try {
      const [scheduleRes, agentRes, todoRes] = await Promise.all([
        fetch('/api/schedules'),
        fetch('/api/agents'),
        fetch('/api/todos'),
      ]);
      const scheduleData = await scheduleRes.json();
      const agentData = await agentRes.json();
      const todoData = await todoRes.json();
      setSchedules(scheduleData.schedules ?? []);
      setAgents((agentData.agents ?? []).filter((agent: Agent) => !agent.archived));
      setTodos(todoData.todos ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function handleToggle(id: string, enabled: boolean) {
    setSchedules((current) => current.map((schedule) => (
      schedule.id === id ? { ...schedule, enabled } : schedule
    )));
    try {
      await fetch(`/api/schedules/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
    } catch {
      fetchData();
    }
  }

  async function handleDelete(id: string) {
    setSchedules((current) => current.filter((schedule) => schedule.id !== id));
    try {
      await fetch(`/api/schedules/${id}`, { method: 'DELETE' });
    } catch {
      fetchData();
    }
  }

  function handleUpdate(updated: AgentSchedule) {
    setSchedules((current) => current.map((schedule) => (
      schedule.id === updated.id ? updated : schedule
    )));
  }

  async function handleCreate(value: ScheduleFormValue) {
    const res = await fetch('/api/schedules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetType: value.targetType,
        agentId: value.agentId,
        todoId: value.todoId,
        cron: value.cron,
        message: value.message,
        label: value.label,
        projectKey: value.projectKey,
        enabled: true,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '创建失败');
    setSchedules((current) => [...current, data.schedule]);
    setShowCreate(false);
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-zinc-400">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  const enabledCount = schedules.filter((schedule) => schedule.enabled).length;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">定时运行</h1>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            按 cron 定时执行：可向 Agent 发送初始消息，或定时派发一条待办。
            {schedules.length > 0 && (
              <span className="ml-2">共 {schedules.length} 条任务，{enabledCount} 条启用中</span>
            )}
          </p>
        </div>
        {!showCreate && (
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 rounded-md bg-zinc-900 px-3 py-2 text-sm text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900"
          >
            <Plus className="h-3.5 w-3.5" />
            新建定时任务
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          {showCreate && (
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <h3 className="mb-3 text-sm font-medium text-zinc-900 dark:text-zinc-100">新建定时任务</h3>
              <ScheduleForm
                agents={agents}
                projects={projects}
                todos={todos}
                onSave={handleCreate}
                onCancel={() => setShowCreate(false)}
                saveLabel="创建"
              />
            </div>
          )}

          {schedules.length === 0 && !showCreate ? (
            <div className="rounded-xl border border-dashed border-zinc-300 py-16 text-center dark:border-zinc-800">
              <Clock className="mx-auto h-8 w-8 text-zinc-300 dark:text-zinc-700" />
              <p className="mt-3 text-sm text-zinc-400">暂无定时任务</p>
            </div>
          ) : (
            schedules.map((schedule) => (
              <ScheduleRow
                key={schedule.id}
                schedule={schedule}
                agentName={agentMap.get(schedule.agentId ?? '') ?? schedule.agentId ?? '未指定 Agent'}
                todoTitle={schedule.todoId ? todoMap.get(schedule.todoId)?.title : undefined}
                agents={agents}
                projects={projects}
                todos={todos}
                onToggle={handleToggle}
                onDelete={handleDelete}
                onUpdate={handleUpdate}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
