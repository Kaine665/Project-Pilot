'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Bot,
  Clock3,
  Github,
  History,
  Loader2,
  Pencil,
  Play,
  Plus,
  Power,
  PowerOff,
  Sparkles,
  Trash2,
  Zap,
} from 'lucide-react';
import { useProject } from '@/components/project-context';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { Agent, ProjectEntry } from '@/types';
import type { EventTrigger, EventTriggerEvent, EventTriggerRunRecord } from '@/types/event-trigger';

type TriggerFormValue = {
  name: string;
  projectKey: string;
  owner: string;
  repo: string;
  tokenEnvVar: string;
  event: EventTriggerEvent;
  pollIntervalSec: string;
  baseBranch: string;
  headBranch: string;
  author: string;
  label: string;
  agentId: string;
  prompt: string;
  enabled: boolean;
};

const DEFAULT_FORM: TriggerFormValue = {
  name: '',
  projectKey: '',
  owner: '',
  repo: '',
  tokenEnvVar: '',
  event: 'pull_request.opened',
  pollIntervalSec: '60',
  baseBranch: '',
  headBranch: '',
  author: '',
  label: '',
  agentId: '',
  prompt: '',
  enabled: true,
};

function parseGitHubRepository(url?: string): { owner: string; repo: string } | null {
  if (!url) return null;
  const match = url.match(/github\.com[:/](.+?)\/(.+?)(?:\.git)?$/i);
  if (!match) return null;
  return {
    owner: match[1],
    repo: match[2],
  };
}

function toFormValue(trigger?: EventTrigger): TriggerFormValue {
  if (!trigger) return DEFAULT_FORM;
  return {
    name: trigger.name,
    projectKey: trigger.projectKey ?? '',
    owner: trigger.sourceConfig.owner,
    repo: trigger.sourceConfig.repo,
    tokenEnvVar: trigger.sourceConfig.tokenEnvVar ?? '',
    event: trigger.event,
    pollIntervalSec: String(trigger.sourceConfig.pollIntervalSec),
    baseBranch: trigger.filters?.baseBranch ?? '',
    headBranch: trigger.filters?.headBranch ?? '',
    author: trigger.filters?.author ?? '',
    label: trigger.filters?.label ?? '',
    agentId: trigger.action.type === 'start_agent' ? trigger.action.agentId : '',
    prompt: trigger.action.type === 'start_agent' ? trigger.action.prompt ?? '' : '',
    enabled: trigger.enabled,
  };
}

function buildPayload(value: TriggerFormValue): Omit<EventTrigger, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    name: value.name.trim(),
    enabled: value.enabled,
    projectKey: value.projectKey || undefined,
    source: 'github_polling',
    event: value.event,
    sourceConfig: {
      owner: value.owner.trim(),
      repo: value.repo.trim(),
      tokenEnvVar: value.tokenEnvVar.trim() || undefined,
      pollIntervalSec: Number(value.pollIntervalSec),
    },
    filters: {
      baseBranch: value.baseBranch.trim() || undefined,
      headBranch: value.headBranch.trim() || undefined,
      author: value.author.trim() || undefined,
      label: value.label.trim() || undefined,
    },
    action: {
      type: 'start_agent',
      agentId: value.agentId,
      prompt: value.prompt.trim() || undefined,
    },
  };
}

function formatEventLabel(event: EventTriggerEvent): string {
  return event === 'pull_request.opened' ? 'PR 新建' : 'PR 推送新提交';
}

function getProjectDefaults(projects: ProjectEntry[], projectKey: string): Partial<TriggerFormValue> {
  const project = projects.find((item) => item.key === projectKey);
  if (!project) return {};

  const repo = parseGitHubRepository(project.repository?.url);
  return {
    owner: repo?.owner ?? '',
    repo: repo?.repo ?? '',
    tokenEnvVar: project.access?.tokenEnvVar ?? '',
  };
}

function TriggerForm({
  value,
  projects,
  agents,
  saving,
  submitLabel,
  onChange,
  onSubmit,
  onCancel,
}: {
  value: TriggerFormValue;
  projects: ProjectEntry[];
  agents: Agent[];
  saving: boolean;
  submitLabel: string;
  onChange: (patch: Partial<TriggerFormValue>) => void;
  onSubmit: () => Promise<void>;
  onCancel?: () => void;
}) {
  return (
    <Card className="border-zinc-200/80 shadow-none dark:border-zinc-800">
      <CardHeader className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-lg">事件触发规则</CardTitle>
            <p className="mt-1 text-sm leading-6 text-zinc-500 dark:text-zinc-400">
              先支持 GitHub PR 轮询。轮询发现事件后，立即拉起指定 Agent。
            </p>
          </div>
          <div className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
            Polling Beta
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <section className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-zinc-900 dark:text-zinc-100">
            <Github className="h-4 w-4" />
            触发源
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-zinc-200 bg-zinc-50/70 p-4 dark:border-zinc-800 dark:bg-zinc-900/50">
              <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">GitHub Polling</div>
              <div className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                无需 webhook。ProjectPilot 自己轮询 GitHub PR 列表，发现变化就触发。
              </div>
            </div>
            <div className="grid gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">规则名称</label>
                <Input value={value.name} onChange={(event) => onChange({ name: event.target.value })} placeholder="例如：新 PR 自动审阅" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">绑定项目</label>
                <select
                  value={value.projectKey}
                  onChange={(event) => onChange({ projectKey: event.target.value })}
                  className="h-9 w-full rounded-md border border-zinc-200 bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 dark:border-zinc-700"
                >
                  <option value="">不绑定项目</option>
                  {projects.map((project) => (
                    <option key={project.key} value={project.key}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">仓库 Owner</label>
              <Input value={value.owner} onChange={(event) => onChange({ owner: event.target.value })} placeholder="openai" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">仓库 Repo</label>
              <Input value={value.repo} onChange={(event) => onChange({ repo: event.target.value })} placeholder="project-pilot" />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">轮询间隔（秒）</label>
              <Input value={value.pollIntervalSec} onChange={(event) => onChange({ pollIntervalSec: event.target.value })} placeholder="60" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">GitHub Token 环境变量</label>
              <Input value={value.tokenEnvVar} onChange={(event) => onChange({ tokenEnvVar: event.target.value })} placeholder="GITHUB_TOKEN" />
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                公共仓库可留空，但会受 GitHub 未鉴权限流影响。
              </p>
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-zinc-900 dark:text-zinc-100">
            <Sparkles className="h-4 w-4" />
            事件类型
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <button
              type="button"
              onClick={() => onChange({ event: 'pull_request.opened' })}
              className={`rounded-xl border p-4 text-left transition-colors ${
                value.event === 'pull_request.opened'
                  ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-950'
                  : 'border-zinc-200 bg-white text-zinc-900 hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100'
              }`}
            >
              <div className="font-medium">PR 新建</div>
              <div className="mt-1 text-xs leading-5 opacity-80">
                轮询发现新的打开 PR，就立刻触发。
              </div>
            </button>
            <button
              type="button"
              onClick={() => onChange({ event: 'pull_request.synchronized' })}
              className={`rounded-xl border p-4 text-left transition-colors ${
                value.event === 'pull_request.synchronized'
                  ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-950'
                  : 'border-zinc-200 bg-white text-zinc-900 hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100'
              }`}
            >
              <div className="font-medium">PR 推送新提交</div>
              <div className="mt-1 text-xs leading-5 opacity-80">
                现有 PR 的 head SHA 变化时触发，适合增量审查。
              </div>
            </button>
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-zinc-900 dark:text-zinc-100">
            <Clock3 className="h-4 w-4" />
            过滤条件
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Base Branch</label>
              <Input value={value.baseBranch} onChange={(event) => onChange({ baseBranch: event.target.value })} placeholder="main" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Head Branch</label>
              <Input value={value.headBranch} onChange={(event) => onChange({ headBranch: event.target.value })} placeholder="feature/my-branch" />
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">作者</label>
              <Input value={value.author} onChange={(event) => onChange({ author: event.target.value })} placeholder="octocat" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Label</label>
              <Input value={value.label} onChange={(event) => onChange({ label: event.target.value })} placeholder="needs-review" />
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-zinc-900 dark:text-zinc-100">
            <Bot className="h-4 w-4" />
            触发动作
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">执行 Agent</label>
              <select
                value={value.agentId}
                onChange={(event) => onChange({ agentId: event.target.value })}
                className="h-9 w-full rounded-md border border-zinc-200 bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 dark:border-zinc-700"
              >
                <option value="">选择 Agent</option>
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-700 dark:border-zinc-800 dark:text-zinc-300">
                <input
                  type="checkbox"
                  checked={value.enabled}
                  onChange={(event) => onChange({ enabled: event.target.checked })}
                  className="h-4 w-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-400 dark:border-zinc-700"
                />
                创建后立即启用
              </label>
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">附加指令</label>
            <Textarea
              rows={5}
              value={value.prompt}
              onChange={(event) => onChange({ prompt: event.target.value })}
              placeholder="例如：请先总结 PR 目标，再检查风险点，最后给出是否建议合并。"
              className="resize-none"
            />
          </div>
        </section>

        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
          {onCancel && (
            <Button variant="outline" onClick={onCancel}>
              取消
            </Button>
          )}
          <Button onClick={() => void onSubmit()} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {submitLabel}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function TriggerRuns({ triggerId }: { triggerId: string }) {
  const [runs, setRuns] = useState<EventTriggerRunRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const loadRuns = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/event-triggers/${triggerId}/runs?limit=20`);
      const data = await res.json() as { runs?: EventTriggerRunRecord[] };
      setRuns(data.runs ?? []);
    } finally {
      setLoading(false);
    }
  }, [triggerId]);

  useEffect(() => {
    if (open) {
      void loadRuns();
    }
  }, [loadRuns, open]);

  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-50/70 dark:border-zinc-800 dark:bg-zinc-900/40">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <div className="flex items-center gap-2 text-sm font-medium text-zinc-900 dark:text-zinc-100">
          <History className="h-4 w-4" />
          最近触发记录
        </div>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">{open ? '收起' : '展开'}</span>
      </button>

      {open && (
        <div className="border-t border-zinc-200 px-4 py-3 dark:border-zinc-800">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              加载中...
            </div>
          ) : runs.length === 0 ? (
            <div className="text-sm text-zinc-500 dark:text-zinc-400">还没有命中过事件。</div>
          ) : (
            <div className="space-y-3">
              {runs.map((run) => (
                <div key={run.id} className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-950">
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-medium text-zinc-900 dark:text-zinc-100">{run.summary}</div>
                    <div className={`rounded px-2 py-0.5 text-xs ${
                      run.status === 'matched'
                        ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300'
                        : 'bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300'
                    }`}>
                      {run.status === 'matched' ? '已触发' : '失败'}
                    </div>
                  </div>
                  <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                    {new Date(run.startedAt).toLocaleString()}
                  </div>
                  {run.sessionId && (
                    <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                      Session: {run.sessionId}
                    </div>
                  )}
                  {run.error && (
                    <div className="mt-1 text-xs text-red-600 dark:text-red-400">
                      {run.error}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TriggerRow({
  trigger,
  agents,
  projects,
  onUpdated,
  onDeleted,
}: {
  trigger: EventTrigger;
  agents: Agent[];
  projects: ProjectEntry[];
  onUpdated: (trigger: EventTrigger) => void;
  onDeleted: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState<TriggerFormValue>(() => toFormValue(trigger));
  const [saving, setSaving] = useState(false);
  const [polling, setPolling] = useState(false);

  useEffect(() => {
    setValue(toFormValue(trigger));
  }, [trigger]);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`/api/event-triggers/${trigger.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayload(value)),
      });
      const data = await res.json() as { trigger?: EventTrigger; error?: string };
      if (!res.ok || !data.trigger) {
        throw new Error(data.error ?? '保存失败');
      }
      onUpdated(data.trigger);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle() {
    const res = await fetch(`/api/event-triggers/${trigger.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !trigger.enabled }),
    });
    const data = await res.json() as { trigger?: EventTrigger };
    if (data.trigger) {
      onUpdated(data.trigger);
    }
  }

  async function handlePoll() {
    setPolling(true);
    try {
      await fetch(`/api/event-triggers/${trigger.id}/poll`, { method: 'POST' });
    } finally {
      setPolling(false);
    }
  }

  async function handleDelete() {
    await fetch(`/api/event-triggers/${trigger.id}`, { method: 'DELETE' });
    onDeleted(trigger.id);
  }

  if (editing) {
    return (
      <TriggerForm
        value={value}
        projects={projects}
        agents={agents}
        saving={saving}
        submitLabel="保存规则"
        onChange={(patch) => setValue((current) => ({ ...current, ...patch }))}
        onSubmit={handleSave}
        onCancel={() => {
          setValue(toFormValue(trigger));
          setEditing(false);
        }}
      />
    );
  }

  return (
    <Card className="border-zinc-200/80 shadow-none dark:border-zinc-800">
      <CardHeader className="gap-4 md:flex-row md:items-start md:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="text-lg">{trigger.name}</CardTitle>
            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${
              trigger.enabled
                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300'
                : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'
            }`}>
              {trigger.enabled ? '启用中' : '已暂停'}
            </span>
            <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 dark:bg-blue-950/30 dark:text-blue-300">
              {formatEventLabel(trigger.event)}
            </span>
          </div>
          <div className="text-sm leading-6 text-zinc-500 dark:text-zinc-400">
            {trigger.sourceConfig.owner}/{trigger.sourceConfig.repo}
            {' · '}
            每 {trigger.sourceConfig.pollIntervalSec} 秒轮询
            {trigger.projectKey ? ` · 项目 ${trigger.projectKey}` : ''}
          </div>
          <div className="flex flex-wrap gap-2 text-xs text-zinc-500 dark:text-zinc-400">
            {trigger.filters?.baseBranch && <span className="rounded-full bg-zinc-100 px-2 py-1 dark:bg-zinc-800">base:{trigger.filters.baseBranch}</span>}
            {trigger.filters?.headBranch && <span className="rounded-full bg-zinc-100 px-2 py-1 dark:bg-zinc-800">head:{trigger.filters.headBranch}</span>}
            {trigger.filters?.author && <span className="rounded-full bg-zinc-100 px-2 py-1 dark:bg-zinc-800">author:{trigger.filters.author}</span>}
            {trigger.filters?.label && <span className="rounded-full bg-zinc-100 px-2 py-1 dark:bg-zinc-800">label:{trigger.filters.label}</span>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={handlePoll} disabled={polling}>
            {polling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            立即检查
          </Button>
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            <Pencil className="h-3.5 w-3.5" />
            编辑
          </Button>
          <Button variant="outline" size="sm" onClick={handleToggle}>
            {trigger.enabled ? <PowerOff className="h-3.5 w-3.5" /> : <Power className="h-3.5 w-3.5" />}
            {trigger.enabled ? '暂停' : '启用'}
          </Button>
          <Button variant="outline" size="sm" onClick={handleDelete}>
            <Trash2 className="h-3.5 w-3.5" />
            删除
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-xl border border-zinc-200 bg-zinc-50/70 p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
          <div className="flex items-center gap-2 text-sm font-medium text-zinc-900 dark:text-zinc-100">
            <Zap className="h-4 w-4" />
            触发动作
          </div>
          <div className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
            命中后启动 Agent：
            <span className="ml-1 font-medium">
              {agents.find((agent) => agent.id === trigger.action.agentId)?.name ?? trigger.action.agentId}
            </span>
          </div>
          {trigger.action.prompt && (
            <div className="mt-3 whitespace-pre-wrap rounded-lg bg-white px-3 py-2 text-sm text-zinc-600 dark:bg-zinc-950 dark:text-zinc-300">
              {trigger.action.prompt}
            </div>
          )}
        </div>

        <TriggerRuns triggerId={trigger.id} />
      </CardContent>
    </Card>
  );
}

export function TaskTriggersPanel({ tasksHub = false }: { tasksHub?: boolean } = {}) {
  const { projects, activeKey } = useProject();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [triggers, setTriggers] = useState<EventTrigger[]>([]);
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<TriggerFormValue>(DEFAULT_FORM);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [triggerRes, agentRes] = await Promise.all([
        fetch('/api/event-triggers'),
        fetch('/api/agents'),
      ]);
      const triggerData = await triggerRes.json() as { triggers?: EventTrigger[] };
      const agentData = await agentRes.json() as { agents?: Agent[] };
      setTriggers(triggerData.triggers ?? []);
      setAgents(agentData.agents ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (!form.projectKey && activeKey) {
      const defaults = getProjectDefaults(projects, activeKey);
      setForm((current) => ({
        ...current,
        projectKey: activeKey,
        owner: current.owner || defaults.owner || '',
        repo: current.repo || defaults.repo || '',
        tokenEnvVar: current.tokenEnvVar || defaults.tokenEnvVar || '',
      }));
    }
  }, [activeKey, form.projectKey, projects]);

  function updateForm(patch: Partial<TriggerFormValue>) {
    setForm((current) => {
      const next = { ...current, ...patch };
      if (patch.projectKey !== undefined) {
        const defaults = getProjectDefaults(projects, patch.projectKey);
        next.owner = defaults.owner || next.owner;
        next.repo = defaults.repo || next.repo;
        next.tokenEnvVar = defaults.tokenEnvVar || next.tokenEnvVar;
      }
      return next;
    });
  }

  async function handleCreate() {
    setCreating(true);
    try {
      const res = await fetch('/api/event-triggers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayload(form)),
      });
      const data = await res.json() as { trigger?: EventTrigger; error?: string };
      if (!res.ok || !data.trigger) {
        throw new Error(data.error ?? '创建失败');
      }
      setTriggers((current) => [...current, data.trigger!]);
      setForm((current) => ({
        ...DEFAULT_FORM,
        projectKey: current.projectKey,
        owner: current.owner,
        repo: current.repo,
        tokenEnvVar: current.tokenEnvVar,
        agentId: current.agentId,
      }));
      setShowCreate(false);
    } finally {
      setCreating(false);
    }
  }

  const hubToolbar = (
    <div className="shrink-0 border-b border-zinc-200/80 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-3 px-6 py-3.5">
        <p className="min-w-0 text-[13px] leading-relaxed text-zinc-500 dark:text-zinc-400">
          事件命中后启动 Agent。当前为 GitHub PR 轮询 Beta。
        </p>
        <Button type="button" size="sm" onClick={() => setShowCreate((value) => !value)}>
          <Plus className="h-3.5 w-3.5" />
          {showCreate ? '收起表单' : '新建触发规则'}
        </Button>
      </div>
    </div>
  );

  const sharedBody = (
    <>
      {showCreate && (
        <TriggerForm
          value={form}
          projects={projects}
          agents={agents}
          saving={creating}
          submitLabel="创建规则"
          onChange={updateForm}
          onSubmit={handleCreate}
          onCancel={() => setShowCreate(false)}
        />
      )}

      <div className="rounded-xl border border-zinc-200/80 bg-zinc-50/70 p-4 text-sm leading-6 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-300">
        <div className="font-medium text-zinc-900 dark:text-zinc-100">当前版本边界</div>
        <div className="mt-2">
          只支持 GitHub PR 轮询事件和“启动 Agent”动作。第一次创建规则时会先建立基线，不会把历史 PR 一次性全部触发。
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 rounded-xl border border-zinc-200/80 bg-white px-4 py-6 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          加载中...
        </div>
      ) : triggers.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 bg-white px-6 py-12 text-center dark:border-zinc-700 dark:bg-zinc-950">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
            <Zap className="h-5 w-5" />
          </div>
          <div className="mt-4 text-lg font-medium text-zinc-900 dark:text-zinc-100">还没有事件触发规则</div>
          <div className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
            新建一条规则后，ProjectPilot 会按配置轮询 GitHub，并在事件命中时立刻启动 Agent。
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {triggers.map((trigger) => (
            <TriggerRow
              key={trigger.id}
              trigger={trigger}
              agents={agents}
              projects={projects}
              onUpdated={(next) => setTriggers((current) => current.map((item) => (item.id === next.id ? next : item)))}
              onDeleted={(id) => setTriggers((current) => current.filter((item) => item.id !== id))}
            />
          ))}
        </div>
      )}
    </>
  );

  if (tasksHub) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        {hubToolbar}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-6 py-6">{sharedBody}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-xs font-medium text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
            <Zap className="h-3.5 w-3.5" />
            Event-Driven Trigger
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">任务触发</h1>
          <p className="max-w-2xl text-sm leading-6 text-zinc-500 dark:text-zinc-400">
            这页只管事件触发，不管定时任务。当前先支持 GitHub PR 轮询，后续可以平滑扩展 webhook、GitLab、Slack 等事件源。
          </p>
        </div>
        <Button type="button" onClick={() => setShowCreate((value) => !value)}>
          <Plus className="h-4 w-4" />
          {showCreate ? '收起表单' : '新建触发规则'}
        </Button>
      </div>

      {sharedBody}
    </div>
  );
}
