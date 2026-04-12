'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  Bot,
  Clock,
  History,
  Info,
  Loader2,
  Monitor,
  Pencil,
  Play,
  Plus,
  Power,
  PowerOff,
  Trash2,
} from 'lucide-react';
import type { Agent, AgentSchedule, ScheduleRunRecord, TodoItem } from '@/types';
import { useProject, type ProjectEntry } from '@/components/project-context';
import { ScheduleCreateModal } from '@/components/schedule-create-modal';
import { cn } from '@/lib/utils';
import { cronSummaryHumanZh, formatNextRunLine } from '@/lib/schedule-display';

const CRON_PRESETS = [
  { label: '每天 09:00', value: '0 9 * * *' },
  { label: '每天 18:00', value: '0 18 * * *' },
  { label: '每周一 09:00', value: '0 9 * * 1' },
  { label: '每小时', value: '0 * * * *' },
  { label: '每 30 分钟', value: '*/30 * * * *' },
  { label: '自定义', value: 'custom' },
];

type ScheduleTargetType = 'agent_message' | 'todo';

export interface ScheduleFormValue {
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
  /** false：在「任务」聚合页内嵌时隐藏大标题区，仅保留操作条 */
  showPageHeader?: boolean;
}

/** 与后端一致：仅 `todo` 为待办模式；`agent_message` / 旧版 `message` / 缺省均为 Agent 消息模式。 */
function normalizeTargetType(targetType?: string): ScheduleTargetType {
  if (targetType === 'todo') return 'todo';
  return 'agent_message';
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

/** 列表卡片主标题：优先标签，其次待办标题 / 消息首行 / 兜底文案 */
function scheduleCardTitle(schedule: AgentSchedule, todoTitle?: string, agentName?: string): string {
  const label = schedule.label?.trim();
  if (label) return label;
  const target = normalizeTargetType(schedule.targetType);
  if (target === 'todo' && todoTitle) return todoTitle;
  const first = (schedule.message ?? '').split(/\n/)[0]?.trim();
  if (first) return first.length > 72 ? `${first.slice(0, 72)}…` : first;
  return target === 'todo' ? '待办派发' : (agentName ?? 'Agent 定时消息');
}

export function ScheduleForm({
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

export function RunHistory({ scheduleId }: { scheduleId: string }) {
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
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [showRuns, setShowRuns] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const cardTitle = scheduleCardTitle(schedule, todoTitle, agentName);

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
    <div className="rounded-2xl border border-zinc-200/90 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-start gap-3 p-5">
        <div
          className="min-w-0 flex-1 cursor-pointer rounded-lg outline-none ring-zinc-400 focus-visible:ring-2"
          role="link"
          tabIndex={0}
          onClick={() => navigate(`/workspace/tasks/schedules/${schedule.id}`)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              navigate(`/workspace/tasks/schedules/${schedule.id}`);
            }
          }}
        >
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{cardTitle}</span>
            <span className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[11px] text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400">
              <Monitor className="h-3 w-3 shrink-0" aria-hidden />
              本地
            </span>
            {!schedule.enabled && (
              <span className="rounded-md bg-zinc-100 px-2 py-0.5 text-[10px] text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                已暂停
              </span>
            )}
          </div>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">{cronSummaryHumanZh(schedule.cron)}</p>
          <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">{formatNextRunLine(schedule.nextRunAt)}</p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
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

export function AgentSchedulesPanel({ showPageHeader = true }: AgentSchedulesPanelProps = {}) {
  const { projects, activeKey } = useProject();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [schedules, setSchedules] = useState<AgentSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);

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

  async function handleCreateFromModal(payload: {
    agentId: string;
    cron: string;
    label: string;
    message: string;
    projectKey?: string;
  }) {
    await handleCreate({
      targetType: 'agent_message',
      agentId: payload.agentId,
      cron: payload.cron,
      message: payload.message,
      label: payload.label,
      projectKey: payload.projectKey,
    });
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
    <div
      className={cn(
        'flex h-full flex-col',
        showPageHeader && 'bg-[#f5f4f1] dark:bg-zinc-950',
      )}
    >
      {showPageHeader ? (
        <div className="shrink-0 px-6 pb-6 pt-10 md:px-12">
          <div className="mx-auto max-w-xl">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <h1 className="font-serif text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50 md:text-4xl">
                定时任务
              </h1>
              {!showCreate && (
                <button
                  type="button"
                  onClick={() => setCreateModalOpen(true)}
                  className="flex items-center gap-2 rounded-[10px] bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
                >
                  <Plus className="h-4 w-4" />
                  新建任务
                </button>
              )}
            </div>
            <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-zinc-600 dark:text-zinc-400">
              按计划自动运行，或在需要时手动触发。在任意会话中输入{' '}
              <code className="rounded-md bg-zinc-200/80 px-2 py-0.5 font-mono text-[13px] text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                /schedule
              </code>{' '}
              可快速创建。
            </p>
            {schedules.length > 0 && (
              <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-500">
                共 {schedules.length} 条，{enabledCount} 条启用中
              </p>
            )}
            <div className="mt-5 flex gap-3 rounded-xl border border-zinc-300/80 bg-zinc-200/40 px-4 py-3.5 dark:border-zinc-700 dark:bg-zinc-900/60">
              <Info className="mt-0.5 h-5 w-5 shrink-0 text-zinc-500 dark:text-zinc-400" aria-hidden />
              <p className="text-sm leading-snug text-zinc-700 dark:text-zinc-300">
                本地定时任务仅在电脑唤醒且应用可用时执行。
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="shrink-0 border-b border-zinc-200/80 bg-[#fafaf8] px-6 py-3.5 dark:border-zinc-800 dark:bg-zinc-950">
          <div className="mx-auto flex w-full max-w-xl flex-col gap-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h2 className="font-serif text-lg font-bold text-zinc-900 dark:text-zinc-100">定时任务</h2>
              {!showCreate && (
                <button
                  type="button"
                  onClick={() => setCreateModalOpen(true)}
                  className="flex shrink-0 items-center gap-1.5 rounded-[10px] bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900"
                >
                  <Plus className="h-3.5 w-3.5" />
                  新建任务
                </button>
              )}
            </div>
            <p className="text-[13px] leading-relaxed text-zinc-600 dark:text-zinc-400">
              会话内输入 <code className="rounded bg-zinc-200/80 px-1.5 py-0.5 font-mono text-[12px] dark:bg-zinc-800">/schedule</code>{' '}
              可快速创建。
            </p>
            <div className="flex gap-2 rounded-lg border border-zinc-200 bg-white/80 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900/50">
              <Info className="h-4 w-4 shrink-0 text-zinc-400" aria-hidden />
              <p className="text-xs text-zinc-600 dark:text-zinc-400">本地任务仅在电脑唤醒时运行。</p>
            </div>
          </div>
        </div>
      )}

      <ScheduleCreateModal
        open={createModalOpen}
        onOpenChange={setCreateModalOpen}
        agents={agents}
        projects={projects}
        defaultProjectKey={activeKey}
        onCreate={handleCreateFromModal}
        onRequestLegacyForm={() => setShowCreate(true)}
      />

      <div className={cn('flex-1 overflow-y-auto px-6 pb-10 pt-2', showPageHeader && 'md:px-12')}>
        <div className="mx-auto flex max-w-xl flex-col gap-4">
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
            <div className="rounded-xl border border-dashed border-zinc-200 py-16 text-center dark:border-zinc-800">
              <Clock className="mx-auto h-8 w-8 text-zinc-300 dark:text-zinc-700" />
              <p className="mt-3 text-[13px] text-zinc-400">暂无定时任务</p>
              <button
                type="button"
                onClick={() => setCreateModalOpen(true)}
                className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900"
              >
                <Plus className="h-3.5 w-3.5" />
                新建定时任务
              </button>
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
