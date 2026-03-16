'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Plus, Trash2, Clock, Power, PowerOff, Loader2, Bot,
  Play, Pencil, History,
} from 'lucide-react';
import type { Agent, AgentSchedule, ScheduleRunRecord } from '@/types';
import { useProject, type ProjectEntry } from '@/components/project-context';

// ── cron 预设 ──

const CRON_PRESETS = [
  { label: '每天早上 9 点', value: '0 9 * * *' },
  { label: '每天下午 6 点', value: '0 18 * * *' },
  { label: '每周一早上 9 点', value: '0 9 * * 1' },
  { label: '每小时', value: '0 * * * *' },
  { label: '每 30 分钟', value: '*/30 * * * *' },
  { label: '自定义', value: 'custom' },
];

// ── 工具函数 ──

function formatTime(iso?: string): string {
  if (!iso) return '从未';
  try {
    return new Date(iso).toLocaleString('zh-CN', {
      month: 'numeric', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function formatTimeWithSeconds(iso?: string): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString('zh-CN', {
      month: 'numeric', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  } catch {
    return iso;
  }
}

/** 找到 cron 值对应的预设，如果不在预设里返回 'custom' */
function findCronPreset(cronValue: string): string {
  const preset = CRON_PRESETS.find(p => p.value === cronValue);
  return preset ? preset.value : 'custom';
}

// ── ScheduleForm（创建 / 编辑共用） ──

function ScheduleForm({
  agents,
  projects,
  initial,
  onSave,
  onCancel,
  saveLabel,
}: {
  agents: Agent[];
  projects: ProjectEntry[];
  initial?: AgentSchedule;
  onSave: (data: {
    agentId: string;
    cron: string;
    message: string;
    label: string;
    projectKey: string;
  }) => Promise<void>;
  onCancel: () => void;
  saveLabel: string;
}) {
  const [agentId, setAgentId] = useState(initial?.agentId ?? agents[0]?.id ?? '');
  const [cronPreset, setCronPreset] = useState(initial ? findCronPreset(initial.cron) : '0 9 * * *');
  const [customCron, setCustomCron] = useState(initial && findCronPreset(initial.cron) === 'custom' ? initial.cron : '');
  const [message, setMessage] = useState(initial?.message ?? '');
  const [label, setLabel] = useState(initial?.label ?? '');
  const [projectKey, setProjectKey] = useState(initial?.projectKey ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const cronValue = cronPreset === 'custom' ? customCron : cronPreset;

  const handleSubmit = async () => {
    if (!agentId) { setError('请选择一个 Agent'); return; }
    if (!message.trim()) { setError('消息不能为空'); return; }
    if (!cronValue.trim()) { setError('cron 表达式不能为空'); return; }

    setSaving(true);
    setError('');
    try {
      await onSave({
        agentId,
        cron: cronValue.trim(),
        message: message.trim(),
        label: label.trim(),
        projectKey,
      });
    } catch (err) {
      setError((err as Error).message || '操作失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      {/* 选择 Agent */}
      <div>
        <label className="mb-1 block text-xs text-zinc-500">Agent <span className="text-red-400">*</span></label>
        <select
          value={agentId}
          onChange={e => setAgentId(e.target.value)}
          disabled={!!initial}
          className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-800 dark:focus:border-zinc-400"
        >
          {agents.map(a => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
      </div>

      {/* 备注名称 */}
      <div>
        <label className="mb-1 block text-xs text-zinc-500">备注名称（可选）</label>
        <input
          value={label}
          onChange={e => setLabel(e.target.value)}
          placeholder="如：晨报生成"
          maxLength={100}
          className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500 dark:border-zinc-600 dark:bg-zinc-800 dark:focus:border-zinc-400"
        />
      </div>

      {/* 触发时间 */}
      <div>
        <label className="mb-1 block text-xs text-zinc-500">触发时间</label>
        <select
          value={cronPreset}
          onChange={e => setCronPreset(e.target.value)}
          className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500 dark:border-zinc-600 dark:bg-zinc-800 dark:focus:border-zinc-400"
        >
          {CRON_PRESETS.map(p => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
        {cronPreset === 'custom' && (
          <input
            value={customCron}
            onChange={e => setCustomCron(e.target.value)}
            placeholder="分 时 日 月 周，如 0 9 * * 1"
            className="mt-1.5 w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-mono outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500 dark:border-zinc-600 dark:bg-zinc-800"
          />
        )}
        {cronPreset !== 'custom' && (
          <p className="mt-1 text-[11px] text-zinc-400 font-mono">{cronPreset}</p>
        )}
      </div>

      {/* 初始消息 */}
      <div>
        <label className="mb-1 block text-xs text-zinc-500">初始消息 <span className="text-red-400">*</span></label>
        <textarea
          value={message}
          onChange={e => setMessage(e.target.value)}
          placeholder="触发时发送给 Agent 的指令..."
          rows={3}
          maxLength={10000}
          className="w-full resize-none rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500 dark:border-zinc-600 dark:bg-zinc-800 dark:focus:border-zinc-400"
        />
      </div>

      {/* 绑定项目 */}
      {projects.length > 0 && (
        <div>
          <label className="mb-1 block text-xs text-zinc-500">绑定项目（可选）</label>
          <select
            value={projectKey}
            onChange={e => setProjectKey(e.target.value)}
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500 dark:border-zinc-600 dark:bg-zinc-800 dark:focus:border-zinc-400"
          >
            <option value="">不绑定项目</option>
            {projects.map(p => (
              <option key={p.key} value={p.key}>{p.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* 错误提示 */}
      {error && <p className="text-xs text-red-500">{error}</p>}

      {/* 操作按钮 */}
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={handleSubmit}
          disabled={saving}
          className="flex items-center gap-1.5 rounded-md bg-zinc-900 px-4 py-1.5 text-sm text-white hover:bg-zinc-700 disabled:opacity-40 transition-colors dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {saveLabel}
        </button>
        <button
          onClick={onCancel}
          className="px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-600 transition-colors"
        >
          取消
        </button>
      </div>
    </div>
  );
}

// ── RunHistory ──

function RunHistory({ scheduleId }: { scheduleId: string }) {
  const [runs, setRuns] = useState<ScheduleRunRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/schedules/${scheduleId}/runs?limit=20`);
        const data = await res.json();
        if (!cancelled) setRuns(data.runs ?? []);
      } catch { /* ignore */ }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [scheduleId]);

  if (loading) {
    return (
      <div className="flex items-center gap-1.5 py-2 text-xs text-zinc-400">
        <Loader2 className="h-3 w-3 animate-spin" /> 加载中...
      </div>
    );
  }

  if (runs.length === 0) {
    return <p className="py-2 text-xs text-zinc-400">暂无执行记录</p>;
  }

  return (
    <div className="space-y-1">
      {runs.map(run => (
        <div
          key={run.id}
          className="flex items-center gap-2 rounded px-2 py-1 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
        >
          <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
            run.status === 'failed' ? 'bg-red-500' : 'bg-green-500'
          }`} />
          <span className="text-zinc-500 shrink-0">{formatTimeWithSeconds(run.startedAt)}</span>
          <span className={`shrink-0 rounded px-1 py-0.5 text-[10px] ${
            run.trigger === 'manual'
              ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400'
              : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'
          }`}>
            {run.trigger === 'manual' ? '手动' : '定时'}
          </span>
          {run.error && (
            <span className="truncate text-red-500" title={run.error}>{run.error}</span>
          )}
          {run.sessionId && !run.error && (
            <span className="truncate text-zinc-400 font-mono" title={run.sessionId}>
              {run.sessionId.slice(0, 12)}...
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

// ── ScheduleRow ──

function ScheduleRow({
  schedule,
  agentName,
  agents,
  projects,
  onToggle,
  onDelete,
  onUpdate,
}: {
  schedule: AgentSchedule;
  agentName: string;
  agents: Agent[];
  projects: ProjectEntry[];
  onToggle: (id: string, enabled: boolean) => void;
  onDelete: (id: string) => void;
  onUpdate: (updated: AgentSchedule) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [showRuns, setShowRuns] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleTrigger = async () => {
    setTriggering(true);
    try {
      const res = await fetch(`/api/schedules/${schedule.id}/trigger`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || '触发失败');
      }
    } catch {
      alert('网络错误');
    } finally {
      setTriggering(false);
    }
  };

  const handleSaveEdit = async (formData: {
    agentId: string;
    cron: string;
    message: string;
    label: string;
    projectKey: string;
  }) => {
    const res = await fetch(`/api/schedules/${schedule.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cron: formData.cron,
        message: formData.message,
        label: formData.label || undefined,
        projectKey: formData.projectKey || undefined,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '更新失败');
    onUpdate(data.schedule);
    setEditing(false);
  };

  // 消息是否需要展开
  const isLongMessage = schedule.message.length > 80;

  return (
    <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
      {/* 主行 */}
      <div className="flex items-start gap-3 p-3">
        <Clock className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="inline-flex items-center gap-1 shrink-0 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
              <Bot className="h-3 w-3" />
              {agentName}
            </span>
            {schedule.label && (
              <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                {schedule.label}
              </span>
            )}
            <code className="shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
              {schedule.cron}
            </code>
            {!schedule.enabled && (
              <span className="shrink-0 rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-500 dark:bg-zinc-800">
                已禁用
              </span>
            )}
          </div>

          {/* 消息内容 — 点击展开/收起 */}
          <div
            className={isLongMessage && !expanded ? 'cursor-pointer' : undefined}
            onClick={() => isLongMessage && !expanded && setExpanded(true)}
          >
            <p className={`text-xs text-zinc-500 dark:text-zinc-400 ${expanded ? 'whitespace-pre-wrap break-all' : 'truncate'}`}>
              消息：{schedule.message}
            </p>
            {isLongMessage && !expanded && (
              <button className="mt-0.5 text-[11px] text-blue-500 hover:underline">
                展开全文
              </button>
            )}
            {isLongMessage && expanded && (
              <button
                className="mt-0.5 text-[11px] text-blue-500 hover:underline"
                onClick={(e) => { e.stopPropagation(); setExpanded(false); }}
              >
                收起
              </button>
            )}
          </div>

          {schedule.projectKey && (
            <p className="mt-0.5 text-[11px] text-zinc-400">
              项目：{schedule.projectKey}
            </p>
          )}
          <p className="mt-0.5 text-[11px] text-zinc-400">
            上次运行：{formatTime(schedule.lastRunAt)}
          </p>
        </div>

        {/* 操作按钮 */}
        <div className="flex items-center gap-0.5 shrink-0">
          {/* 手动触发 */}
          <button
            onClick={handleTrigger}
            disabled={triggering}
            className="rounded-md p-1.5 text-zinc-400 hover:bg-blue-50 hover:text-blue-500 transition-colors disabled:opacity-40 dark:hover:bg-blue-900/20"
            title="立即运行一次"
          >
            {triggering ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          </button>

          {/* 编辑 */}
          <button
            onClick={() => { setEditing(!editing); setShowRuns(false); }}
            className={`rounded-md p-1.5 transition-colors ${
              editing
                ? 'text-blue-500 bg-blue-50 dark:bg-blue-900/20'
                : 'text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
            }`}
            title="编辑"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>

          {/* 执行历史 */}
          <button
            onClick={() => { setShowRuns(!showRuns); setEditing(false); }}
            className={`rounded-md p-1.5 transition-colors ${
              showRuns
                ? 'text-blue-500 bg-blue-50 dark:bg-blue-900/20'
                : 'text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
            }`}
            title="执行历史"
          >
            <History className="h-3.5 w-3.5" />
          </button>

          {/* 启用/禁用 */}
          <button
            onClick={() => onToggle(schedule.id, !schedule.enabled)}
            className={`rounded-md p-1.5 transition-colors ${
              schedule.enabled
                ? 'text-green-600 hover:bg-green-50 dark:text-green-400 dark:hover:bg-green-900/20'
                : 'text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
            }`}
            title={schedule.enabled ? '点击禁用' : '点击启用'}
          >
            {schedule.enabled ? <Power className="h-3.5 w-3.5" /> : <PowerOff className="h-3.5 w-3.5" />}
          </button>

          {/* 删除 */}
          <button
            onClick={async () => {
              if (!confirm('确认删除此调度规则？')) return;
              setDeleting(true);
              onDelete(schedule.id);
            }}
            disabled={deleting}
            className="rounded-md p-1.5 text-zinc-400 hover:bg-red-50 hover:text-red-500 transition-colors disabled:opacity-40 dark:hover:bg-red-900/20"
            title="删除"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* 编辑面板 */}
      {editing && (
        <div className="border-t border-zinc-100 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-800/50">
          <h4 className="mb-3 text-xs font-medium text-zinc-500">编辑调度规则</h4>
          <ScheduleForm
            agents={agents}
            projects={projects}
            initial={schedule}
            onSave={handleSaveEdit}
            onCancel={() => setEditing(false)}
            saveLabel="保存"
          />
        </div>
      )}

      {/* 执行历史面板 */}
      {showRuns && (
        <div className="border-t border-zinc-100 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-800/50">
          <h4 className="mb-2 text-xs font-medium text-zinc-500 flex items-center gap-1">
            <History className="h-3 w-3" /> 执行历史（最近 20 次）
          </h4>
          <RunHistory scheduleId={schedule.id} />
        </div>
      )}
    </div>
  );
}

// ── Main panel (standalone full page) ──

export function AgentSchedulesPanel() {
  const { projects } = useProject();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [schedules, setSchedules] = useState<AgentSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const agentMap = new Map(agents.map(a => [a.id, a.name]));

  const fetchData = useCallback(async () => {
    try {
      const [schedRes, agentRes] = await Promise.all([
        fetch('/api/schedules'),
        fetch('/api/agents'),
      ]);
      const schedData = await schedRes.json();
      const agentData = await agentRes.json();
      setSchedules(schedData.schedules ?? []);
      setAgents((agentData.agents ?? []).filter((a: Agent) => !a.archived));
    } catch {
      setSchedules([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleToggle = async (id: string, enabled: boolean) => {
    setSchedules(prev => prev.map(s => s.id === id ? { ...s, enabled } : s));
    try {
      await fetch(`/api/schedules/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
    } catch {
      fetchData();
    }
  };

  const handleDelete = async (id: string) => {
    setSchedules(prev => prev.filter(s => s.id !== id));
    try {
      await fetch(`/api/schedules/${id}`, { method: 'DELETE' });
    } catch {
      fetchData();
    }
  };

  const handleUpdate = (updated: AgentSchedule) => {
    setSchedules(prev => prev.map(s => s.id === updated.id ? updated : s));
  };

  const handleCreate = async (formData: {
    agentId: string;
    cron: string;
    message: string;
    label: string;
    projectKey: string;
  }) => {
    const res = await fetch('/api/schedules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: formData.agentId,
        cron: formData.cron,
        message: formData.message,
        label: formData.label || undefined,
        projectKey: formData.projectKey || undefined,
        enabled: true,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '创建失败');
    setSchedules(prev => [...prev, data.schedule]);
    setShowCreate(false);
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-zinc-400">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  const enabledCount = schedules.filter(s => s.enabled).length;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">定时运行</h1>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            在指定时间自动创建会话并发送指令，适合周期性任务（如晨报、数据汇总）。
            {schedules.length > 0 && (
              <span className="ml-2">共 {schedules.length} 条规则，{enabledCount} 条启用中</span>
            )}
          </p>
        </div>
        {!showCreate && (
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 rounded-md bg-zinc-900 px-3 py-1.5 text-sm text-white hover:bg-zinc-700 transition-colors dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            <Plus className="h-3.5 w-3.5" />
            添加调度
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-2xl flex flex-col gap-4">
          {/* 创建表单 */}
          {showCreate && (
            <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-800/50">
              <h4 className="mb-3 text-sm font-medium text-zinc-900 dark:text-zinc-100">新建调度规则</h4>
              <ScheduleForm
                agents={agents}
                projects={projects}
                onSave={handleCreate}
                onCancel={() => setShowCreate(false)}
                saveLabel="创建"
              />
            </div>
          )}

          {/* 调度列表 */}
          {schedules.length > 0 ? (
            <div className="flex flex-col gap-2">
              {schedules.map(s => (
                <ScheduleRow
                  key={s.id}
                  schedule={s}
                  agentName={agentMap.get(s.agentId) ?? s.agentId}
                  agents={agents}
                  projects={projects}
                  onToggle={handleToggle}
                  onDelete={handleDelete}
                  onUpdate={handleUpdate}
                />
              ))}
            </div>
          ) : (
            !showCreate && (
              <div className="rounded-lg border border-dashed border-zinc-300 py-16 text-center dark:border-zinc-700">
                <Clock className="mx-auto h-8 w-8 text-zinc-300 dark:text-zinc-600" />
                <p className="mt-3 text-sm text-zinc-400">暂无调度规则</p>
                <p className="mt-1 text-xs text-zinc-400">点击右上角「添加调度」创建第一条规则</p>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}
