'use client';

import { useEffect, useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  ChevronDown,
  FolderOpen,
  Hand,
  Info,
  Loader2,
  X,
} from 'lucide-react';
import type { Agent } from '@/types';
import type { ProjectEntry } from '@/components/project-context';
import { cn } from '@/lib/utils';

type FrequencyKey = 'daily' | 'hourly' | 'weekly_mon' | 'custom';

function timeToCronMinuteHour(time: string): { m: number; h: number } {
  const [hStr, mStr] = time.split(':');
  const h = Math.min(23, Math.max(0, parseInt(hStr ?? '9', 10) || 9));
  const m = Math.min(59, Math.max(0, parseInt(mStr ?? '0', 10) || 0));
  return { m, h };
}

function buildCron(freq: FrequencyKey, time: string, customCron: string): string {
  if (freq === 'custom') return customCron.trim();
  if (freq === 'hourly') return '0 * * * *';
  if (freq === 'weekly_mon') {
    const { m, h } = timeToCronMinuteHour(time);
    return `${m} ${h} * * 1`;
  }
  const { m, h } = timeToCronMinuteHour(time);
  return `${m} ${h} * * *`;
}

const freqLabels: Record<FrequencyKey, string> = {
  daily: '每天',
  hourly: '每小时',
  weekly_mon: '每周一',
  custom: '自定义',
};

export function ScheduleCreateModal({
  open,
  onOpenChange,
  agents,
  projects,
  defaultProjectKey,
  onCreate,
  onRequestLegacyForm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  agents: Agent[];
  projects: ProjectEntry[];
  defaultProjectKey?: string | null;
  onCreate: (payload: {
    agentId: string;
    cron: string;
    label: string;
    message: string;
    projectKey?: string;
  }) => Promise<void>;
  /** 需要 Todo / 完整 cron 时打开经典表单 */
  onRequestLegacyForm?: () => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [taskInstruction, setTaskInstruction] = useState('');
  const [agentId, setAgentId] = useState('');
  const [projectKey, setProjectKey] = useState('');
  const [frequency, setFrequency] = useState<FrequencyKey>('daily');
  const [time, setTime] = useState('09:00');
  const [customCron, setCustomCron] = useState('0 9 * * *');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const cron = useMemo(() => buildCron(frequency, time, customCron), [frequency, time, customCron]);

  useEffect(() => {
    if (!open) return;
    setError('');
    setName('');
    setDescription('');
    setTaskInstruction('');
    setFrequency('daily');
    setTime('09:00');
    setCustomCron('0 9 * * *');
    const first = agents[0]?.id ?? '';
    setAgentId(first);
    setProjectKey(defaultProjectKey ?? '');
  }, [open, agents, defaultProjectKey]);

  async function handleSubmit() {
    const n = name.trim();
    const d = description.trim();
    const t = taskInstruction.trim();
    if (!n) {
      setError('请填写名称');
      return;
    }
    if (!d) {
      setError('请填写说明');
      return;
    }
    if (!t) {
      setError('请填写任务指令');
      return;
    }
    if (!agentId) {
      setError('请选择执行 Agent');
      return;
    }
    if (frequency === 'custom' && !customCron.trim()) {
      setError('请填写 cron 表达式');
      return;
    }

    const message = [d, t].join('\n\n');

    setSaving(true);
    setError('');
    try {
      await onCreate({
        agentId,
        cron: cron.trim(),
        label: n,
        message,
        projectKey: projectKey || undefined,
      });
      onOpenChange(false);
    } catch (e) {
      setError((e as Error).message || '创建失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45 data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-50 flex max-h-[min(92vh,820px)] w-[min(100vw-1.5rem,520px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-zinc-200/90 bg-[#f7f7f5] shadow-2xl',
            'dark:border-zinc-700 dark:bg-zinc-900',
          )}
        >
          <div className="flex items-start justify-between gap-3 border-b border-zinc-200/80 px-6 pb-4 pt-6 dark:border-zinc-800">
            <Dialog.Title className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              新建定时任务
            </Dialog.Title>
            <Dialog.Description className="sr-only">
              填写名称、说明与任务指令，选择执行 Agent 与重复周期以创建定时任务。
            </Dialog.Description>
            <Dialog.Close
              type="button"
              className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-200/80 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
              aria-label="关闭"
            >
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            <div className="mb-5 flex gap-2.5 rounded-xl border border-zinc-200/90 bg-white/80 px-3.5 py-3 text-[13px] leading-relaxed text-zinc-600 dark:border-zinc-700 dark:bg-zinc-950/50 dark:text-zinc-400">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" aria-hidden />
              <span>本地定时任务仅在电脑保持唤醒、应用运行时才会按计划触发。</span>
            </div>

            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-[13px] font-medium text-zinc-700 dark:text-zinc-300">
                  名称 <span className="text-red-500">*</span>
                </label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="例如：每日 bug 检查"
                  className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-zinc-400 focus:ring-1 focus:ring-zinc-400 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-[13px] font-medium text-zinc-700 dark:text-zinc-300">
                  说明 <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  placeholder="简要描述这条定时任务的目的"
                  className="w-full resize-none rounded-lg border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-zinc-400 focus:ring-1 focus:ring-zinc-400 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
                />
              </div>

              <div className="rounded-xl border border-zinc-200/90 bg-white p-3 shadow-sm dark:border-zinc-700 dark:bg-zinc-950">
                <label className="mb-1.5 block text-[13px] font-medium text-zinc-700 dark:text-zinc-300">
                  任务指令 <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={taskInstruction}
                  onChange={(e) => setTaskInstruction(e.target.value)}
                  rows={3}
                  placeholder="触发时发给 Agent 的具体指令"
                  className="mb-3 w-full resize-none border-0 bg-transparent p-0 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-100"
                />
                <div className="border-t border-zinc-100 pt-3 dark:border-zinc-800">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled
                      className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-zinc-50/80 px-2.5 py-1.5 text-xs font-medium text-zinc-400 dark:border-zinc-700 dark:bg-zinc-900/50"
                      title="后续版本支持"
                    >
                      <Hand className="h-3.5 w-3.5" />
                      请求权限
                      <ChevronDown className="h-3.5 w-3.5 opacity-50" />
                    </button>
                    <div className="relative min-w-[140px] flex-1">
                      <select
                        value={agentId}
                        onChange={(e) => setAgentId(e.target.value)}
                        className="h-9 w-full appearance-none rounded-lg border border-zinc-200 bg-white py-1.5 pl-3 pr-8 text-xs font-medium text-zinc-800 outline-none focus:border-zinc-400 focus:ring-1 focus:ring-zinc-400 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-200"
                      >
                        {agents.length === 0 ? (
                          <option value="">暂无 Agent</option>
                        ) : (
                          agents.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.name}
                            </option>
                          ))
                        )}
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      disabled
                      className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-zinc-200 px-2.5 py-1.5 text-xs text-zinc-400 dark:border-zinc-700"
                    >
                      <FolderOpen className="h-3.5 w-3.5" />
                      选择文件夹
                    </button>
                    <label className="flex cursor-not-allowed items-center gap-2 text-xs text-zinc-400">
                      <input type="checkbox" checked={false} readOnly disabled className="h-3.5 w-3.5 rounded border-zinc-300" />
                      worktree
                    </label>
                  </div>
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-[13px] font-medium text-zinc-700 dark:text-zinc-300">
                  重复
                </label>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <div className="relative min-w-0 flex-1">
                    <select
                      value={frequency}
                      onChange={(e) => setFrequency(e.target.value as FrequencyKey)}
                      className="h-10 w-full appearance-none rounded-lg border border-zinc-200 bg-white px-3 pr-9 text-sm text-zinc-900 outline-none focus:border-zinc-400 focus:ring-1 focus:ring-zinc-400 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
                    >
                      {(Object.keys(freqLabels) as FrequencyKey[]).map((k) => (
                        <option key={k} value={k}>
                          {freqLabels[k]}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                  </div>
                  {frequency !== 'hourly' && frequency !== 'custom' ? (
                    <input
                      type="time"
                      value={time}
                      onChange={(e) => setTime(e.target.value)}
                      className="h-10 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-400 focus:ring-1 focus:ring-zinc-400 sm:w-[7.5rem] dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
                    />
                  ) : null}
                </div>
                {frequency === 'custom' ? (
                  <input
                    value={customCron}
                    onChange={(e) => setCustomCron(e.target.value)}
                    placeholder="0 9 * * *"
                    className="mt-2 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 font-mono text-xs text-zinc-800 outline-none focus:border-zinc-400 focus:ring-1 focus:ring-zinc-400 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-200"
                  />
                ) : (
                  <p className="mt-1.5 font-mono text-[11px] text-zinc-400">{cron}</p>
                )}
              </div>

              {projects.length > 0 ? (
                <div>
                  <label className="mb-1.5 block text-[13px] font-medium text-zinc-700 dark:text-zinc-300">
                    绑定项目
                  </label>
                  <select
                    value={projectKey}
                    onChange={(e) => setProjectKey(e.target.value)}
                    className="h-10 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-zinc-400 focus:ring-1 focus:ring-zinc-400 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
                  >
                    <option value="">不绑定</option>
                    {projects.map((p) => (
                      <option key={p.key} value={p.key}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}

              <p className="text-[11px] leading-relaxed text-zinc-400 dark:text-zinc-500">
                为降低负载与碰撞概率，实际触发时间可能会在计划时刻基础上略有抖动。
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-3 border-t border-zinc-200/80 px-6 py-4 dark:border-zinc-800">
            {onRequestLegacyForm ? (
              <button
                type="button"
                onClick={() => {
                  onOpenChange(false);
                  onRequestLegacyForm();
                }}
                className="self-start text-xs text-zinc-500 underline-offset-2 hover:text-zinc-700 hover:underline dark:text-zinc-400 dark:hover:text-zinc-300"
              >
                使用经典表单（Todo / 更多 cron 预设）
              </button>
            ) : null}
            <div className="flex justify-end gap-2">
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-800 transition hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900"
                >
                  取消
                </button>
              </Dialog.Close>
              <button
                type="button"
                disabled={saving || agents.length === 0}
                onClick={() => void handleSubmit()}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-zinc-800 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-200 dark:text-zinc-900 dark:hover:bg-zinc-300"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                创建任务
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
