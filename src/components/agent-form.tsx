'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  Bot, X, Maximize2,
  Terminal, FileText, Globe, Users, ShieldOff, ListTodo, Eye, Check,
  Database, Brain, Code, Zap, Search, Shield, Wrench, BookOpen,
  type LucideIcon,
} from 'lucide-react';
import type { Agent, AgentCapabilities, ContextEntry } from '@/types';
import type { ProjectEntry } from '@/components/project-context';
import { DEFAULT_AGENT_CAPABILITIES } from '@/types';

// ── Icon picker presets ──

export const AGENT_ICON_OPTIONS: Array<{ key: string; icon: LucideIcon; label: string }> = [
  { key: 'bot',       icon: Bot,       label: '机器人' },
  { key: 'brain',     icon: Brain,     label: '大脑' },
  { key: 'database',  icon: Database,  label: '数据库' },
  { key: 'code',      icon: Code,      label: '代码' },
  { key: 'terminal',  icon: Terminal,  label: '终端' },
  { key: 'zap',       icon: Zap,       label: '闪电' },
  { key: 'search',    icon: Search,    label: '搜索' },
  { key: 'shield',    icon: Shield,    label: '盾牌' },
  { key: 'wrench',    icon: Wrench,    label: '工具' },
  { key: 'book-open', icon: BookOpen,  label: '书本' },
];

export const ICON_MAP: Record<string, LucideIcon> = Object.fromEntries(
  AGENT_ICON_OPTIONS.map(o => [o.key, o.icon])
);

// Also map legacy names (e.g. "sparkles" used by built-in agent)
ICON_MAP['sparkles'] = Bot;

export function AgentIcon({ iconKey, className }: { iconKey?: string; className?: string }) {
  const Icon = (iconKey && ICON_MAP[iconKey]) || Bot;
  return <Icon className={className} />;
}

// ── Capability items config ──

export const CAPABILITY_ITEMS: Array<{
  key: keyof AgentCapabilities;
  label: string;
  description: string;
  icon: typeof Terminal;
  danger?: boolean;
}> = [
  { key: 'bash',       label: 'Bash 执行',     description: '命令行执行（含 Git 操作）',    icon: Terminal },
  { key: 'fileAccess', label: '文件读写',       description: 'Read、Write、Edit、Glob、Grep', icon: FileText },
  { key: 'web',        label: 'Web 搜索/抓取',  description: 'WebFetch、WebSearch',          icon: Globe },
  { key: 'subAgent',   label: '子 Agent',       description: 'Task 工具（创建子代理）',       icon: Users },
  { key: 'skipReview',      label: '无需审核',       description: '自动批准所有工具调用',                icon: ShieldOff, danger: true },
  { key: 'todoRead',        label: '读取待办',       description: '将 pending 待办注入提示词',           icon: ListTodo },
  { key: 'exposePromptPath', label: '暴露提示词路径', description: '将 prompt 文件路径注入提示词，AI 可自行读写', icon: Eye },
];

// ── Form types ──

export type FormData = {
  name: string;
  description: string;
  systemPrompt: string;
  icon: string;
  capabilities: AgentCapabilities;
  requiredParamsText: string;
  contextIds: string[];
  projectKey: string; // '' = 全局
};

export const emptyForm: FormData = {
  name: '', description: '', systemPrompt: '', icon: '',
  capabilities: { ...DEFAULT_AGENT_CAPABILITIES },
  requiredParamsText: '',
  contextIds: [],
  projectKey: '',
};

export function agentToForm(a: Agent): FormData {
  return {
    name: a.name,
    description: a.description ?? '',
    systemPrompt: a.systemPrompt ?? '',
    icon: a.icon ?? '',
    capabilities: a.capabilities ?? { ...DEFAULT_AGENT_CAPABILITIES },
    requiredParamsText: (a.requiredParams ?? []).join('\n'),
    contextIds: a.contextIds ?? [],
    projectKey: a.projectKey ?? '',
  };
}

// ── Toggle Switch component ──

export function ToggleSwitch({ checked, onChange, danger }: { checked: boolean; onChange: () => void; danger?: boolean }) {
  const activeColor = danger
    ? 'bg-red-500 dark:bg-red-500'
    : 'bg-zinc-900 dark:bg-zinc-100';
  const inactiveColor = 'bg-zinc-200 dark:bg-zinc-700';

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
        checked ? activeColor : inactiveColor
      }`}
    >
      <span
        className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow ring-0 transition-transform dark:bg-zinc-900 ${
          checked ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

// ── Settings Form component ──

export function SettingsForm({
  creating,
  form,
  setForm,
  selectedAgent,
  hasChanges,
  saving,
  onSave,
  onClose,
  onDelete,
  selectedId,
  onExpandPrompt,
  projects,
}: {
  creating: boolean;
  form: FormData;
  setForm: React.Dispatch<React.SetStateAction<FormData>>;
  selectedAgent: Agent | null;
  hasChanges: boolean;
  saving: boolean;
  onSave: () => void;
  onClose: () => void;
  onDelete: (id: string) => void;
  selectedId: string | null;
  onExpandPrompt: () => void;
  projects?: ProjectEntry[];
}) {
  // Fetch available context entries for the picker
  const [contextEntries, setContextEntries] = useState<ContextEntry[]>([]);
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/context');
        const data = await res.json();
        setContextEntries((data.entries ?? []).filter((e: ContextEntry) => !e.status || e.status === 'active'));
      } catch { setContextEntries([]); }
    })();
  }, []);

  const toggleContext = (id: string) => {
    setForm(f => ({
      ...f,
      contextIds: f.contextIds.includes(id)
        ? f.contextIds.filter(cid => cid !== id)
        : [...f.contextIds, id],
    }));
  };

  // Group context entries
  const contextGroups = useMemo(() => {
    const groups: Array<{ group: string | null; entries: ContextEntry[] }> = [];
    const groupNames = [...new Set(contextEntries.map(e => e.group).filter((g): g is string => !!g))].sort();
    const ungrouped = contextEntries.filter(e => !e.group);
    if (ungrouped.length > 0) groups.push({ group: null, entries: ungrouped });
    for (const g of groupNames) {
      groups.push({ group: g, entries: contextEntries.filter(e => e.group === g) });
    }
    return groups;
  }, [contextEntries]);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-2xl px-8 py-8">
        {/* Panel header (only for creating mode — selected agent header is outside) */}
        {creating && (
          <div className="mb-6 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              新建 Agent
            </h2>
            <button
              onClick={onClose}
              className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 transition-colors dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
              title="关闭"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Form */}
        <div className="space-y-5">
          {/* Name */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              名称 <span className="text-red-400">*</span>
            </label>
            <input
              autoFocus
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="给 Agent 起个名字"
              className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500 dark:border-zinc-600 dark:bg-zinc-800 dark:focus:border-zinc-400 dark:focus:ring-zinc-400"
            />
          </div>

          {/* Slug (read-only for built-in agents) */}
          {selectedAgent?.builtIn && selectedAgent?.slug && (
            <div>
              <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                标识符
              </label>
              <div className="w-full rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-400">
                {selectedAgent.slug}
              </div>
              <p className="mt-1 text-xs text-zinc-400">
                内置 Agent 的标识符不可修改
              </p>
            </div>
          )}

          {/* Description */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              描述
            </label>
            <input
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="简要描述这个 Agent 的用途"
              className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500 dark:border-zinc-600 dark:bg-zinc-800 dark:focus:border-zinc-400 dark:focus:ring-zinc-400"
            />
          </div>

          {/* Project */}
          {projects && projects.length > 0 && (
            <div>
              <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                所属项目
              </label>
              {selectedAgent?.builtIn ? (
                <div className="w-full rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-400">
                  全局（所有项目）
                </div>
              ) : (
                <select
                  value={form.projectKey}
                  onChange={e => setForm(f => ({ ...f, projectKey: e.target.value }))}
                  className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500 dark:border-zinc-600 dark:bg-zinc-800 dark:focus:border-zinc-400 dark:focus:ring-zinc-400"
                >
                  <option value="">全局（所有项目）</option>
                  {projects.map(p => (
                    <option key={p.key} value={p.key}>{p.name}</option>
                  ))}
                </select>
              )}
              <p className="mt-1 text-xs text-zinc-400">
                全局 Agent 在所有项目下可见
              </p>
            </div>
          )}

          {/* Icon */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              图标
            </label>
            <div className="grid grid-cols-5 gap-2">
              {AGENT_ICON_OPTIONS.map(({ key, icon: Icon, label }) => {
                const selected = form.icon === key || (!form.icon && key === 'bot');
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setForm(f => ({ ...f, icon: key }))}
                    title={label}
                    className={`flex flex-col items-center gap-1 rounded-lg border px-2 py-2.5 text-xs transition-colors ${
                      selected
                        ? 'border-zinc-900 bg-zinc-100 text-zinc-900 dark:border-zinc-100 dark:bg-zinc-800 dark:text-zinc-100'
                        : 'border-zinc-200 text-zinc-400 hover:border-zinc-400 hover:text-zinc-600 dark:border-zinc-700 dark:hover:border-zinc-500 dark:hover:text-zinc-300'
                    }`}
                  >
                    <Icon className="h-5 w-5" />
                    <span className="truncate w-full text-center">{label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* System Prompt */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                系统提示词
              </label>
              <button
                onClick={onExpandPrompt}
                className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 transition-colors dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
                title="全屏编辑"
              >
                <Maximize2 className="h-3.5 w-3.5" />
              </button>
            </div>
            <textarea
              value={form.systemPrompt}
              onChange={e => setForm(f => ({ ...f, systemPrompt: e.target.value }))}
              placeholder="定义 Agent 的行为和能力，例如：你是一个专注于代码审查的助手..."
              rows={8}
              className="w-full resize-y rounded-md border border-zinc-300 px-3 py-2 text-sm leading-relaxed outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500 dark:border-zinc-600 dark:bg-zinc-800 dark:focus:border-zinc-400 dark:focus:ring-zinc-400"
            />
          </div>

          {/* Required Params */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              必要参数
            </label>
            <textarea
              value={form.requiredParamsText}
              onChange={e => setForm(f => ({ ...f, requiredParamsText: e.target.value }))}
              placeholder={'该 Agent 执行任务所需的参数，每行一个\n例如：\nSUPABASE_URL\nSUPABASE_SERVICE_ROLE_KEY'}
              rows={3}
              className="w-full resize-y rounded-md border border-zinc-300 px-3 py-2 text-sm leading-relaxed font-mono outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500 dark:border-zinc-600 dark:bg-zinc-800 dark:focus:border-zinc-400 dark:focus:ring-zinc-400"
            />
            <p className="mt-1 text-xs text-zinc-400">
              仅声明参数名，实际值在项目或任务中配置
            </p>
          </div>

          {/* Capabilities */}
          <div>
            <label className="mb-3 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              能力配置
            </label>
            <div className="space-y-1 rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
              {CAPABILITY_ITEMS.map(({ key, label, description, icon: Icon, danger }) => (
                <div
                  key={key}
                  className={`flex items-center justify-between rounded-md px-3 py-2.5 transition-colors ${
                    danger && form.capabilities[key]
                      ? 'bg-red-50/50 dark:bg-red-950/20'
                      : ''
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Icon className={`h-4 w-4 ${
                      danger && form.capabilities[key]
                        ? 'text-red-400'
                        : 'text-zinc-400'
                    }`} />
                    <div>
                      <div className={`text-sm font-medium ${
                        danger && form.capabilities[key]
                          ? 'text-red-600 dark:text-red-400'
                          : 'text-zinc-900 dark:text-zinc-100'
                      }`}>
                        {label}
                      </div>
                      <div className="text-xs text-zinc-400">{description}</div>
                    </div>
                  </div>
                  <ToggleSwitch
                    checked={form.capabilities[key]}
                    onChange={() => setForm(f => ({
                      ...f,
                      capabilities: { ...f.capabilities, [key]: !f.capabilities[key] },
                    }))}
                    danger={danger}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Context Binding */}
          {contextEntries.length > 0 && (
            <div>
              <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                预加载上下文
              </label>
              <p className="mb-2 text-xs text-zinc-400">
                选中的上下文内容将在对话时自动展开注入，Agent 无需手动读取
              </p>
              <div className="space-y-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-700 max-h-60 overflow-y-auto">
                {contextGroups.map(({ group, entries }) => (
                  <div key={group ?? '__ungrouped'}>
                    {group && (
                      <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                        {group}
                      </div>
                    )}
                    <div className="space-y-0.5">
                      {entries.map(entry => {
                        const checked = form.contextIds.includes(entry.id);
                        return (
                          <button
                            key={entry.id}
                            type="button"
                            onClick={() => toggleContext(entry.id)}
                            className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors ${
                              checked
                                ? 'bg-zinc-100 dark:bg-zinc-800'
                                : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                            }`}
                          >
                            <div className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                              checked
                                ? 'border-zinc-900 bg-zinc-900 dark:border-zinc-100 dark:bg-zinc-100'
                                : 'border-zinc-300 dark:border-zinc-600'
                            }`}>
                              {checked && <Check className="h-3 w-3 text-white dark:text-zinc-900" />}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-sm text-zinc-900 dark:text-zinc-100">
                                {entry.label}
                              </div>
                              {entry.description && (
                                <div className="truncate text-xs text-zinc-400">
                                  {entry.description}
                                </div>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
              {form.contextIds.length > 0 && (
                <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                  已选 {form.contextIds.length} 项
                </p>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={onSave}
              disabled={!form.name.trim() || saving || !hasChanges}
              className="rounded-md bg-zinc-900 px-5 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              {saving ? '保存中...' : creating ? '创建' : '保存'}
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-600 transition-colors"
            >
              取消
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
