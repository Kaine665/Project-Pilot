'use client';

import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, Clock, Power, PowerOff, Loader2 } from 'lucide-react';
import type { AgentSchedule } from '@/types';
import type { ProjectEntry } from '@/components/project-context';

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

function formatLastRunAt(iso?: string): string {
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

// ── ScheduleRow ──

function ScheduleRow({
  schedule,
  onToggle,
  onDelete,
}: {
  schedule: AgentSchedule;
  onToggle: (id: string, enabled: boolean) => void;
  onDelete: (id: string) => void;
}) {
  const [deleting, setDeleting] = useState(false);

  return (
    <div className="flex items-start gap-3 rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-900">
      <Clock className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
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
        <p className="text-xs text-zinc-500 truncate dark:text-zinc-400">
          消息：{schedule.message}
        </p>
        <p className="mt-0.5 text-[11px] text-zinc-400">
          上次运行：{formatLastRunAt(schedule.lastRunAt)}
        </p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
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
  );
}

// ── CreateScheduleForm ──

function CreateScheduleForm({
  agentId,
  projects,
  onCreated,
  onCancel,
}: {
  agentId: string;
  projects?: ProjectEntry[];
  onCreated: (s: AgentSchedule) => void;
  onCancel: () => void;
}) {
  const [cronPreset, setCronPreset] = useState('0 9 * * *');
  const [customCron, setCustomCron] = useState('');
  const [message, setMessage] = useState('');
  const [label, setLabel] = useState('');
  const [projectKey, setProjectKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const cronValue = cronPreset === 'custom' ? customCron : cronPreset;

  const handleSubmit = async () => {
    if (!message.trim()) { setError('消息不能为空'); return; }
    if (!cronValue.trim()) { setError('cron 表达式不能为空'); return; }

    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId,
          cron: cronValue.trim(),
          message: message.trim(),
          label: label.trim() || undefined,
          projectKey: projectKey || undefined,
          enabled: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || '创建失败'); return; }
      onCreated(data.schedule);
    } catch {
      setError('网络错误');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-800/50">
      <h4 className="mb-3 text-sm font-medium text-zinc-900 dark:text-zinc-100">新建调度规则</h4>
      <div className="space-y-3">

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
        {projects && projects.length > 0 && (
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
        {error && (
          <p className="text-xs text-red-500">{error}</p>
        )}

        {/* 操作按钮 */}
        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-md bg-zinc-900 px-4 py-1.5 text-sm text-white hover:bg-zinc-700 disabled:opacity-40 transition-colors dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            创建
          </button>
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-600 transition-colors"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main component ──

export function AgentSchedulesPanel({
  agentId,
  projects,
}: {
  agentId: string;
  projects?: ProjectEntry[];
}) {
  const [schedules, setSchedules] = useState<AgentSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const fetchSchedules = useCallback(async () => {
    try {
      const res = await fetch('/api/schedules');
      const data = await res.json();
      const all: AgentSchedule[] = data.schedules ?? [];
      setSchedules(all.filter(s => s.agentId === agentId));
    } catch {
      setSchedules([]);
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    fetchSchedules();
  }, [fetchSchedules]);

  const handleToggle = async (id: string, enabled: boolean) => {
    setSchedules(prev => prev.map(s => s.id === id ? { ...s, enabled } : s));
    try {
      await fetch(`/api/schedules/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
    } catch {
      // 乐观更新失败，刷新列表
      fetchSchedules();
    }
  };

  const handleDelete = async (id: string) => {
    setSchedules(prev => prev.filter(s => s.id !== id));
    try {
      await fetch(`/api/schedules/${id}`, { method: 'DELETE' });
    } catch {
      fetchSchedules();
    }
  };

  const handleCreated = (schedule: AgentSchedule) => {
    setSchedules(prev => [...prev, schedule]);
    setShowCreate(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-zinc-400">
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4 overflow-y-auto">
      {/* 说明 */}
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        定时运行会在指定时间自动创建新会话并发送初始消息，适合周期性任务（如晨报、数据汇总）。
      </p>

      {/* 现有调度列表 */}
      {schedules.length > 0 ? (
        <div className="flex flex-col gap-2">
          {schedules.map(s => (
            <ScheduleRow
              key={s.id}
              schedule={s}
              onToggle={handleToggle}
              onDelete={handleDelete}
            />
          ))}
        </div>
      ) : (
        !showCreate && (
          <div className="rounded-lg border border-dashed border-zinc-300 py-8 text-center text-sm text-zinc-400 dark:border-zinc-700">
            暂无调度规则
          </div>
        )
      )}

      {/* 创建表单 */}
      {showCreate ? (
        <CreateScheduleForm
          agentId={agentId}
          projects={projects}
          onCreated={handleCreated}
          onCancel={() => setShowCreate(false)}
        />
      ) : (
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 self-start rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:border-zinc-400 hover:text-zinc-900 transition-colors dark:border-zinc-600 dark:text-zinc-400 dark:hover:border-zinc-500 dark:hover:text-zinc-200"
        >
          <Plus className="h-3.5 w-3.5" />
          添加调度
        </button>
      )}
    </div>
  );
}
