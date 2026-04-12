'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useNavigate, useParams } from 'react-router';
import {
  Check,
  ChevronLeft,
  Circle,
  Clock,
  FolderOpen,
  Loader2,
  Pencil,
  Play,
  Trash2,
} from 'lucide-react';
import type { Agent, AgentSchedule, ScheduleRunRecord, TodoItem } from '@/types';
import { useProject, type ProjectEntry } from '@/components/project-context';
import { ScheduleForm, type ScheduleFormValue } from '@/components/agent-schedules-panel';
import { cn } from '@/lib/utils';
import { cronSummaryZh, formatNextRunZh } from '@/lib/schedule-display';

function parseMessageParts(message?: string): { subtitle: string; instructions: string } {
  const raw = (message ?? '').trim();
  if (!raw) return { subtitle: '', instructions: '' };
  const parts = raw.split(/\n\n+/);
  if (parts.length >= 2) {
    return { subtitle: parts[0].trim(), instructions: parts.slice(1).join('\n\n').trim() };
  }
  return { subtitle: '', instructions: raw };
}

function truncatePath(path: string, max = 42): string {
  if (path.length <= max) return path;
  return `${path.slice(0, max)}…`;
}

function formatRunTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('zh-CN', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function ScheduleDetailView() {
  const { scheduleId } = useParams<{ scheduleId: string }>();
  const navigate = useNavigate();
  const { projects } = useProject();

  const [schedule, setSchedule] = useState<AgentSchedule | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [runs, setRuns] = useState<ScheduleRunRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [runsLoading, setRunsLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [toggleBusy, setToggleBusy] = useState(false);

  const loadSchedule = useCallback(async () => {
    if (!scheduleId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/schedules/${scheduleId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '加载失败');
      setSchedule(data.schedule ?? null);
    } catch {
      setSchedule(null);
    } finally {
      setLoading(false);
    }
  }, [scheduleId]);

  const loadRuns = useCallback(async () => {
    if (!scheduleId) return;
    setRunsLoading(true);
    try {
      const res = await fetch(`/api/schedules/${scheduleId}/runs?limit=20`);
      const data = await res.json();
      setRuns(data.runs ?? []);
    } finally {
      setRunsLoading(false);
    }
  }, [scheduleId]);

  useEffect(() => {
    void loadSchedule();
  }, [loadSchedule]);

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  useEffect(() => {
    (async () => {
      const [a, t] = await Promise.all([fetch('/api/agents'), fetch('/api/todos')]);
      const aj = await a.json();
      const tj = await t.json();
      setAgents((aj.agents ?? []).filter((x: Agent) => !x.archived));
      setTodos(tj.todos ?? []);
    })();
  }, []);

  const projectPath = useMemo(() => {
    if (!schedule?.projectKey) return '';
    const p = projects.find((x) => x.key === schedule.projectKey);
    return p?.path ?? '';
  }, [schedule, projects]);

  const agentName = useMemo(() => {
    if (!schedule?.agentId) return '';
    return agents.find((a) => a.id === schedule.agentId)?.name ?? schedule.agentId;
  }, [schedule, agents]);

  const title = schedule?.label || schedule?.message?.split('\n')[0]?.slice(0, 48) || '定时任务';
  const { subtitle, instructions } = useMemo(() => {
    if (!schedule) return { subtitle: '', instructions: '' };
    if (schedule.targetType === 'todo') {
      const todo = todos.find((t) => t.id === schedule.todoId);
      return {
        subtitle: todo?.title ? `定时派发待办：${todo.title}` : 'Todo 定时派发',
        instructions: schedule.message ?? '—',
      };
    }
    const p = parseMessageParts(schedule.message);
    if (p.subtitle) return { subtitle: p.subtitle, instructions: p.instructions || '—' };
    return { subtitle: p.instructions.slice(0, 120) || '—', instructions: p.instructions || '—' };
  }, [schedule, todos]);

  async function handleTrigger() {
    if (!scheduleId) return;
    setTriggering(true);
    try {
      const res = await fetch(`/api/schedules/${scheduleId}/trigger`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '触发失败');
      void loadRuns();
      void loadSchedule();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setTriggering(false);
    }
  }

  async function handleDelete() {
    if (!scheduleId || !confirm('确认删除这条定时任务？')) return;
    const res = await fetch(`/api/schedules/${scheduleId}`, { method: 'DELETE' });
    if (res.ok) navigate('/workspace/tasks/schedules');
  }

  async function handleToggleEnabled(next: boolean) {
    if (!scheduleId || toggleBusy) return;
    setToggleBusy(true);
    try {
      const res = await fetch(`/api/schedules/${scheduleId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      });
      const data = await res.json();
      if (res.ok && data.schedule) setSchedule(data.schedule);
    } finally {
      setToggleBusy(false);
    }
  }

  async function handleSaveEdit(value: ScheduleFormValue) {
    if (!scheduleId) return;
    const res = await fetch(`/api/schedules/${scheduleId}`, {
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
    if (!res.ok) throw new Error(data.error || '保存失败');
    setSchedule(data.schedule);
    setEditOpen(false);
    void loadSchedule();
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-[#f7f7f5] dark:bg-zinc-950">
        <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
      </div>
    );
  }

  if (!schedule) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-[#f7f7f5] px-6 dark:bg-zinc-950">
        <p className="text-sm text-zinc-500">未找到该定时任务</p>
        <button
          type="button"
          onClick={() => navigate('/workspace/tasks/schedules')}
          className="text-sm font-medium text-zinc-900 underline dark:text-zinc-100"
        >
          返回列表
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto bg-[#f7f7f5] dark:bg-zinc-950">
      <div className="mx-auto w-full max-w-4xl px-6 py-10 pb-16 md:px-12">
        <button
          type="button"
          onClick={() => navigate('/workspace/tasks/schedules')}
          className="mb-5 flex items-center gap-1 text-[13px] font-medium text-zinc-500 transition hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
        >
          <ChevronLeft className="h-4 w-4" />
          全部定时任务
        </button>

        <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0 flex-1">
            <h1
              className="font-serif text-[2.35rem] font-semibold leading-tight tracking-tight text-zinc-900 dark:text-zinc-50"
              style={{ fontFamily: "ui-serif, Georgia, 'Times New Roman', serif" }}
            >
              {title}
            </h1>
            {subtitle ? (
              <p className="mt-2.5 max-w-xl text-[15px] leading-relaxed text-zinc-800 dark:text-zinc-200">
                {subtitle}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-2 md:pt-2">
            <button
              type="button"
              onClick={() => setEditOpen(true)}
              className="rounded-lg p-2.5 text-zinc-400 transition hover:bg-zinc-200/80 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
              title="编辑"
            >
              <Pencil className="h-[18px] w-[18px]" />
            </button>
            <button
              type="button"
              onClick={() => void handleDelete()}
              className="rounded-lg p-2.5 text-zinc-400 transition hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/30"
              title="删除"
            >
              <Trash2 className="h-[18px] w-[18px]" />
            </button>
            <button
              type="button"
              disabled={triggering}
              onClick={() => void handleTrigger()}
              className="ml-1 inline-flex items-center gap-2 rounded-[10px] bg-zinc-900 px-[18px] py-2.5 text-[13px] font-semibold text-white transition hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              {triggering ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5 fill-current" />}
              立即运行
            </button>
          </div>
        </div>

        <div className="mb-7 flex flex-wrap items-center gap-4">
          {schedule.enabled ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[12px] font-semibold uppercase tracking-wider text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300">
              <Clock className="h-3.5 w-3.5" />
              启用中
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-zinc-100 px-3 py-1.5 text-[12px] font-semibold uppercase tracking-wider text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
              已暂停
            </span>
          )}
          <span className="text-[13px] text-zinc-500 dark:text-zinc-400">
            下次运行 {formatNextRunZh(schedule.nextRunAt)}
          </span>
        </div>

        <div className="h-px w-full bg-zinc-200/90 dark:bg-zinc-800" />

        <div className="mt-8 flex flex-col gap-10 lg:flex-row lg:gap-14">
          <section className="min-w-0 flex-1">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-400">History</h2>
            <div className="mt-4 border-b border-zinc-200 dark:border-zinc-800">
              {runsLoading ? (
                <div className="flex items-center gap-2 py-4 text-sm text-zinc-400">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  加载中…
                </div>
              ) : runs.length === 0 ? (
                <p className="py-6 text-sm text-zinc-400">暂无执行记录</p>
              ) : (
                <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {runs.map((run) => (
                    <li key={run.id} className="flex items-center justify-between gap-3 py-4">
                      <span className="text-[14px] font-medium text-zinc-700 dark:text-zinc-300">
                        {formatRunTime(run.startedAt)}
                      </span>
                      <span className="flex items-center gap-2 text-[12px] font-medium text-zinc-500">
                        {run.status === 'started' ? (
                          <>
                            <Circle className="h-3.5 w-3.5 animate-pulse text-zinc-400" strokeDasharray="2 2" />
                            运行中
                          </>
                        ) : run.status === 'failed' ? (
                          <span className="text-red-600 dark:text-red-400">失败</span>
                        ) : (
                          <span className="text-emerald-600 dark:text-emerald-400">完成</span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <aside className="w-full shrink-0 space-y-7 lg:w-[340px]">
            <div>
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-400">Instructions</h3>
              <p className="mt-2 text-[14px] leading-relaxed text-zinc-800 dark:text-zinc-200">
                {instructions || '—'}
              </p>
            </div>

            <div>
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-400">Folder</h3>
              <div className="mt-2 flex items-start gap-2">
                <FolderOpen className="mt-0.5 h-4 w-4 shrink-0 text-zinc-600 dark:text-zinc-400" />
                <span className="break-all text-[13px] text-zinc-600 dark:text-zinc-400">
                  {projectPath ? truncatePath(projectPath) : '未绑定本地路径'}
                </span>
              </div>
            </div>

            <div>
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-400">Repeats</h3>
              <div className="mt-2 flex items-center gap-3">
                <button
                  type="button"
                  role="switch"
                  aria-checked={schedule.enabled}
                  disabled={toggleBusy}
                  onClick={() => void handleToggleEnabled(!schedule.enabled)}
                  className={cn(
                    'relative h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors disabled:opacity-50',
                    schedule.enabled ? 'bg-blue-600' : 'bg-zinc-200 dark:bg-zinc-700',
                  )}
                >
                  <span
                    className={cn(
                      'block h-4 w-4 rounded-full bg-white shadow transition-transform',
                      schedule.enabled ? 'translate-x-4' : 'translate-x-0',
                    )}
                  />
                </button>
                <span className="text-[13px] text-zinc-700 dark:text-zinc-300">{cronSummaryZh(schedule.cron)}</span>
              </div>
            </div>

            <div>
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-400">Always allowed</h3>
              <div className="mt-2 flex gap-2.5">
                <div className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border border-zinc-300 dark:border-zinc-600">
                  <Check className="h-3 w-3 text-zinc-900 dark:text-zinc-100" strokeWidth={2.5} />
                </div>
                <div>
                  <p className="text-[13px] font-medium text-zinc-800 dark:text-zinc-200">已允许</p>
                  <p className="mt-1 max-w-[280px] text-[11px] leading-relaxed text-zinc-400">
                    运行过程中授予的权限会显示在这里。（示意：后续版本可对接会话审批记录）
                  </p>
                </div>
              </div>
            </div>

            {schedule.targetType === 'todo' ? null : (
              <p className="text-[11px] text-zinc-400">执行 Agent：{agentName || '—'}</p>
            )}
          </aside>
        </div>
      </div>

      <Dialog.Root open={editOpen} onOpenChange={setEditOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[min(90vh,720px)] w-[min(100vw-1.5rem,520px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-zinc-200 bg-white p-5 shadow-2xl dark:border-zinc-800 dark:bg-zinc-950">
            <Dialog.Title className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              编辑定时任务
            </Dialog.Title>
            <Dialog.Description className="sr-only">修改 cron、消息与绑定项目</Dialog.Description>
            <div className="mt-4">
              <ScheduleForm
                agents={agents}
                projects={projects as ProjectEntry[]}
                todos={todos}
                initial={schedule}
                onSave={handleSaveEdit}
                onCancel={() => setEditOpen(false)}
                saveLabel="保存"
              />
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
