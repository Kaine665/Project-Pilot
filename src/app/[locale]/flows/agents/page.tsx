'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Bot, Plus, Trash2, X, ChevronRight, Terminal, FileText, Globe, Users, ShieldOff, Maximize2, Minimize2,
  Database, Brain, Code, Zap, Search, Shield, Wrench, BookOpen, Settings, MessageSquare, Check, Copy, Eye, type LucideIcon,
} from 'lucide-react';
import type { Agent, AgentCapabilities, ContextEntry } from '@/types';
import { AgentChatPanel, type SessionListItem } from '@/components/agent-chat-panel';

// ── Icon picker presets ──

const AGENT_ICON_OPTIONS: Array<{ key: string; icon: LucideIcon; label: string }> = [
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

const ICON_MAP: Record<string, LucideIcon> = Object.fromEntries(
  AGENT_ICON_OPTIONS.map(o => [o.key, o.icon])
);

// Also map legacy names (e.g. "sparkles" used by built-in agent)
ICON_MAP['sparkles'] = Bot;

function AgentIcon({ iconKey, className }: { iconKey?: string; className?: string }) {
  const Icon = (iconKey && ICON_MAP[iconKey]) || Bot;
  return <Icon className={className} />;
}
import { DEFAULT_AGENT_CAPABILITIES } from '@/types';

// ── Capability items config ──

const CAPABILITY_ITEMS: Array<{
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
  { key: 'exposePromptPath', label: '暴露提示词路径', description: '将 prompt 文件路径注入提示词，AI 可自行读写', icon: Eye },
];

// ── Form types ──

type FormData = {
  name: string;
  description: string;
  systemPrompt: string;
  icon: string;
  capabilities: AgentCapabilities;
  requiredParamsText: string;
  contextIds: string[];
};

const emptyForm: FormData = {
  name: '', description: '', systemPrompt: '', icon: '',
  capabilities: { ...DEFAULT_AGENT_CAPABILITIES },
  requiredParamsText: '',
  contextIds: [],
};

function agentToForm(a: Agent): FormData {
  return {
    name: a.name,
    description: a.description ?? '',
    systemPrompt: a.systemPrompt ?? '',
    icon: a.icon ?? '',
    capabilities: a.capabilities ?? { ...DEFAULT_AGENT_CAPABILITIES },
    requiredParamsText: (a.requiredParams ?? []).join('\n'),
    contextIds: a.contextIds ?? [],
  };
}

// ── Toggle Switch component ──

function ToggleSwitch({ checked, onChange, danger }: { checked: boolean; onChange: () => void; danger?: boolean }) {
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

function SettingsForm({
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

// ── Session day-grouping helper ──

function groupSessionsByDay(sessions: SessionListItem[]) {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = todayStart - 86_400_000;

  const groups: Array<{ label: string; items: SessionListItem[] }> = [];
  const map = new Map<string, SessionListItem[]>();

  for (const s of sessions) {
    const d = new Date(s.updatedAt);
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

    let label: string;
    if (dayStart >= todayStart) label = '今天';
    else if (dayStart >= yesterdayStart) label = '昨天';
    else label = `${d.getMonth() + 1}月${d.getDate()}日`;

    if (!map.has(label)) map.set(label, []);
    map.get(label)!.push(s);
  }

  for (const [label, items] of map) {
    groups.push({ label, items });
  }

  return groups;
}

// ── URL param sync helper ──

function syncUrlParams(params: Record<string, string | null | undefined>) {
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(params)) {
    if (value) {
      url.searchParams.set(key, value);
    } else {
      url.searchParams.delete(key);
    }
  }
  window.history.replaceState({}, '', url.toString());
}

// ── Main page ──

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FormData>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [expandedPrompt, setExpandedPrompt] = useState(false);
  const [viewMode, setViewMode] = useState<'chat' | 'settings'>('chat');
  const [agentSessions, setAgentSessions] = useState<SessionListItem[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null | undefined>(undefined);
  const [chatKey, setChatKey] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');

  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch('/api/agents');
      const data = await res.json();
      setAgents(data.agents ?? []);
    } catch {
      setAgents([]);
    }
  }, []);

  useEffect(() => { fetchAgents(); }, [fetchAgents]);

  // Restore selection from URL params after agents load
  useEffect(() => {
    if (agents.length === 0) return;
    const url = new URL(window.location.href);
    const agentParam = url.searchParams.get('agent');
    const sessionParam = url.searchParams.get('session');
    if (agentParam) {
      const agent = agents.find(a => a.id === agentParam);
      if (agent) {
        setSelectedId(agent.id);
        setForm(agentToForm(agent));
        if (sessionParam) {
          setActiveSessionId(sessionParam);
        }
      } else {
        // Agent from URL no longer exists — clear
        syncUrlParams({ agent: null, session: null });
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agents.length]); // Only run when agents list first loads

  // Refresh agent list when window regains focus
  useEffect(() => {
    const handleFocus = () => fetchAgents();
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [fetchAgents]);

  // Fetch sessions for the selected agent (merge with local-only items)
  const fetchAgentSessions = useCallback(async (agentId: string) => {
    try {
      const res = await fetch(`/api/agent-chat/sessions?agentId=${agentId}`, { cache: 'no-store' });
      const data = await res.json();
      const remote: SessionListItem[] = data.sessions ?? [];
      setAgentSessions(prev => {
        const remoteIds = new Set(remote.map(s => s.id));
        const localOnly = prev.filter(s => !remoteIds.has(s.id));
        return [...localOnly, ...remote];
      });
    } catch {
      // don't clear — keep optimistic items
    }
  }, []);

  useEffect(() => {
    if (selectedId && !creating) {
      fetchAgentSessions(selectedId);
    } else {
      setAgentSessions([]);
    }
  }, [selectedId, creating, fetchAgentSessions]);

  const selectedAgent = agents.find(a => a.id === selectedId) ?? null;
  const groupedSessions = useMemo(() => groupSessionsByDay(agentSessions), [agentSessions]);

  // B2: Filter agents by search query (fuzzy match on name + description)
  // B3: Sort agents — built-in first, then by updatedAt descending (most recent first)
  const displayAgents = useMemo(() => {
    let list = agents;
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter(a =>
        a.name.toLowerCase().includes(q) ||
        (a.description ?? '').toLowerCase().includes(q),
      );
    }
    return [...list].sort((a, b) => {
      // Built-in agents always on top
      if (a.builtIn && !b.builtIn) return -1;
      if (!a.builtIn && b.builtIn) return 1;
      // Then by updatedAt descending
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
  }, [agents, searchQuery]);

  const handleSelect = (agent: Agent) => {
    setCreating(false);
    setSelectedId(agent.id);
    setForm(agentToForm(agent));
    setExpandedPrompt(false);
    setViewMode('chat');
    setActiveSessionId(undefined);
    setChatKey(k => k + 1);
    syncUrlParams({ agent: agent.id, session: null });
  };

  const handleStartCreate = () => {
    setSelectedId(null);
    setCreating(true);
    setForm(emptyForm);
    setExpandedPrompt(false);
  };

  // B1: Clone an agent — copy all config with "(副本)" suffix
  const handleClone = async (source: Agent) => {
    try {
      const res = await fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${source.name} (副本)`,
          description: source.description,
          systemPrompt: source.systemPrompt,
          icon: source.icon,
          capabilities: source.capabilities,
          requiredParams: source.requiredParams,
          contextIds: source.contextIds,
          defaultResources: source.defaultResources,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        await fetchAgents();
        handleSelect(data.agent);
      }
    } catch { /* ignore */ }
  };

  const handleClose = () => {
    setSelectedId(null);
    setCreating(false);
    setForm(emptyForm);
    setExpandedPrompt(false);
    setViewMode('chat');
    setActiveSessionId(undefined);
    syncUrlParams({ agent: null, session: null });
  };

  const handleSessionClick = (sessionId: string) => {
    setActiveSessionId(sessionId);
    setChatKey(k => k + 1);
    setViewMode('chat');
    syncUrlParams({ session: sessionId });
  };

  const handleNewChat = () => {
    setActiveSessionId(null);
    setChatKey(k => k + 1);
    setViewMode('chat');
    syncUrlParams({ session: null });
  };

  const handleSave = async () => {
    const name = form.name.trim();
    if (!name) return;
    setSaving(true);
    const parsedParams = form.requiredParamsText
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean);
    try {
      if (creating) {
        const res = await fetch('/api/agents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            description: form.description.trim() || undefined,
            systemPrompt: form.systemPrompt.trim() || undefined,
            icon: form.icon.trim() || undefined,
            capabilities: form.capabilities,
            requiredParams: parsedParams.length > 0 ? parsedParams : undefined,
            contextIds: form.contextIds.length > 0 ? form.contextIds : undefined,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          await fetchAgents();
          setCreating(false);
          setSelectedId(data.agent.id);
          setForm(agentToForm(data.agent));
          syncUrlParams({ agent: data.agent.id, session: null });
        }
      } else if (selectedId) {
        const res = await fetch('/api/agents', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: selectedId,
            name,
            description: form.description.trim() || undefined,
            systemPrompt: form.systemPrompt.trim() || undefined,
            icon: form.icon.trim() || undefined,
            capabilities: form.capabilities,
            requiredParams: parsedParams.length > 0 ? parsedParams : [],
            contextIds: form.contextIds,
          }),
        });
        if (res.ok) await fetchAgents();
      }
    } catch { /* ignore */ }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    const agent = agents.find(a => a.id === id);
    if (!confirm(`确定要将 Agent「${agent?.name ?? id}」移到回收站吗？`)) return;
    try {
      const res = await fetch('/api/agents', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (res.ok) {
        await fetchAgents();
        if (selectedId === id) {
          setSelectedId(null);
          setForm(emptyForm);
          syncUrlParams({ agent: null, session: null });
        }
      }
    } catch { /* ignore */ }
  };

  const hasChanges = creating
    ? form.name.trim().length > 0
    : selectedAgent
      ? form.name !== selectedAgent.name
        || form.description !== (selectedAgent.description ?? '')
        || form.systemPrompt !== (selectedAgent.systemPrompt ?? '')
        || form.icon !== (selectedAgent.icon ?? '')
        || JSON.stringify(form.capabilities) !== JSON.stringify(selectedAgent.capabilities ?? DEFAULT_AGENT_CAPABILITIES)
        || form.requiredParamsText !== (selectedAgent.requiredParams ?? []).join('\n')
        || JSON.stringify([...form.contextIds].sort()) !== JSON.stringify([...(selectedAgent.contextIds ?? [])].sort())
      : false;

  return (
    <div className="flex h-full">
      {/* Left sidebar */}
      <div className="flex w-72 shrink-0 flex-col border-r border-zinc-200 dark:border-zinc-800">
        {/* ── Top half: Agents ── */}
        <div className="flex h-1/2 flex-col">
          <div className="flex items-center justify-between border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
            <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-900 dark:text-zinc-100">
              <Bot className="h-3.5 w-3.5" />
              Agents
            </div>
            <button
              onClick={handleStartCreate}
              className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 transition-colors dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
              title="新建 Agent"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
          {/* B2: Search input */}
          <div className="border-b border-zinc-100 px-3 py-1.5 dark:border-zinc-800/50">
            <div className="flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900">
              <Search className="h-3 w-3 shrink-0 text-zinc-400" />
              <input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="搜索 Agent..."
                className="flex-1 bg-transparent text-xs outline-none placeholder:text-zinc-400 text-zinc-900 dark:text-zinc-100"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {displayAgents.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-zinc-400">
                {searchQuery ? '没有匹配的 Agent' : '暂无 Agent'}
              </div>
            ) : (
              displayAgents.map(a => (
                <div
                  key={a.id}
                  onClick={() => handleSelect(a)}
                  className={`group flex cursor-pointer items-center gap-3 border-b border-zinc-100 px-4 py-3 transition-colors dark:border-zinc-800/50 ${
                    selectedId === a.id
                      ? 'bg-zinc-100 dark:bg-zinc-800'
                      : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                  }`}
                >
                  <AgentIcon iconKey={a.icon} className="h-4 w-4 shrink-0 text-zinc-400" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      <span className="truncate">{a.name}</span>
                      {a.builtIn && (
                        <span className="shrink-0 rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
                          内置
                        </span>
                      )}
                    </div>
                    {a.description && (
                      <div className="truncate text-xs text-zinc-400 dark:text-zinc-500">
                        {a.description}
                      </div>
                    )}
                  </div>
                  {/* B1: Clone button */}
                  <button
                    onClick={(e) => { e.stopPropagation(); handleClone(a); }}
                    className="shrink-0 rounded-md p-1 text-zinc-300 opacity-0 transition-all hover:bg-zinc-200 hover:text-zinc-600 group-hover:opacity-100 dark:text-zinc-600 dark:hover:bg-zinc-700 dark:hover:text-zinc-300"
                    title="克隆"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-zinc-300 dark:text-zinc-600" />
                </div>
              ))
            )}
          </div>
        </div>

        {/* ── Bottom half: Sessions ── */}
        <div className="flex h-1/2 flex-col border-t border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center justify-between border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
            <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-900 dark:text-zinc-100">
              <MessageSquare className="h-3.5 w-3.5" />
              会话
            </div>
            {selectedId && !creating && (
              <button
                onClick={handleNewChat}
                className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 transition-colors dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
                title="新建会话"
              >
                <Plus className="h-4 w-4" />
              </button>
            )}
          </div>
          <div className="flex-1 overflow-y-auto">
            {!selectedId || creating ? (
              <div className="px-4 py-8 text-center text-xs text-zinc-400">
                选择一个 Agent 查看会话
              </div>
            ) : agentSessions.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-zinc-400">
                暂无会话记录
              </div>
            ) : (
              groupedSessions.map(group => (
                <div key={group.label}>
                  <div className="sticky top-0 bg-zinc-50 px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-zinc-400 dark:bg-zinc-900 dark:text-zinc-500">
                    {group.label}
                  </div>
                  {group.items.map(s => (
                    <div
                      key={s.id}
                      onClick={() => handleSessionClick(s.id)}
                      className={`flex cursor-pointer items-center gap-2.5 px-4 py-2.5 transition-colors ${
                        activeSessionId === s.id
                          ? 'bg-zinc-100 dark:bg-zinc-800'
                          : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                      }`}
                    >
                      <MessageSquare className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
                      <span className="flex-1 truncate text-xs text-zinc-700 dark:text-zinc-300">
                        {s.title}
                      </span>
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Right: Detail / Chat / Edit panel */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {creating ? (
          /* ── Creating new agent: always show settings form ── */
          expandedPrompt ? (
            <div className="flex flex-1 flex-col p-4 gap-3 overflow-hidden">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  系统提示词 — {form.name || '未命名'}
                </label>
                <button
                  onClick={() => setExpandedPrompt(false)}
                  className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 transition-colors dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
                  title="收起"
                >
                  <Minimize2 className="h-4 w-4" />
                </button>
              </div>
              <textarea
                autoFocus
                value={form.systemPrompt}
                onChange={e => setForm(f => ({ ...f, systemPrompt: e.target.value }))}
                placeholder="定义 Agent 的行为和能力，例如：你是一个专注于代码审查的助手..."
                className="flex-1 w-full resize-none rounded-md border border-zinc-300 px-4 py-3 text-sm leading-relaxed outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500 dark:border-zinc-600 dark:bg-zinc-800 dark:focus:border-zinc-400 dark:focus:ring-zinc-400"
              />
            </div>
          ) : (
            <SettingsForm
              creating
              form={form}
              setForm={setForm}
              selectedAgent={null}
              hasChanges={hasChanges}
              saving={saving}
              onSave={handleSave}
              onClose={handleClose}
              onDelete={handleDelete}
              selectedId={selectedId}
              onExpandPrompt={() => setExpandedPrompt(true)}
            />
          )
        ) : selectedAgent ? (
          /* ── Existing agent selected ── */
          expandedPrompt && viewMode === 'settings' ? (
            <div className="flex flex-1 flex-col p-4 gap-3 overflow-hidden">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  系统提示词 — {form.name || '未命名'}
                </label>
                <button
                  onClick={() => setExpandedPrompt(false)}
                  className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 transition-colors dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
                  title="收起"
                >
                  <Minimize2 className="h-4 w-4" />
                </button>
              </div>
              <textarea
                autoFocus
                value={form.systemPrompt}
                onChange={e => setForm(f => ({ ...f, systemPrompt: e.target.value }))}
                placeholder="定义 Agent 的行为和能力，例如：你是一个专注于代码审查的助手..."
                className="flex-1 w-full resize-none rounded-md border border-zinc-300 px-4 py-3 text-sm leading-relaxed outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500 dark:border-zinc-600 dark:bg-zinc-800 dark:focus:border-zinc-400 dark:focus:ring-zinc-400"
              />
            </div>
          ) : (
            <>
              {/* Panel header with view toggle */}
              <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
                <div className="flex items-center gap-2 min-w-0">
                  <AgentIcon iconKey={selectedAgent.icon} className="h-4 w-4 shrink-0 text-zinc-500" />
                  <span className="text-sm font-medium text-zinc-900 truncate dark:text-zinc-100">{selectedAgent.name}</span>
                  {selectedAgent.builtIn && (
                    <span className="shrink-0 rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
                      内置
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => { setViewMode(v => v === 'chat' ? 'settings' : 'chat'); setExpandedPrompt(false); }}
                    className={`rounded-md p-1.5 transition-colors ${
                      viewMode === 'settings'
                        ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
                        : 'text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300'
                    }`}
                    title={viewMode === 'chat' ? '设置' : '聊天'}
                  >
                    {viewMode === 'chat' ? <Settings className="h-4 w-4" /> : <MessageSquare className="h-4 w-4" />}
                  </button>
                  {!selectedAgent.builtIn && (
                    <button
                      onClick={() => handleDelete(selectedId!)}
                      className="rounded-md p-1.5 text-zinc-400 hover:bg-red-50 hover:text-red-500 transition-colors dark:hover:bg-red-900/20"
                      title="删除"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                  <button
                    onClick={handleClose}
                    className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 transition-colors dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
                    title="关闭"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* View content */}
              {viewMode === 'chat' ? (
                <div className="flex-1 overflow-hidden">
                  <AgentChatPanel
                    key={`${selectedAgent.id}-${chatKey}`}
                    agent={selectedAgent}
                    initialSessionId={activeSessionId}
                    onSessionChange={(newSession) => {
                      if (newSession) {
                        // Optimistically insert new session at top of sidebar list
                        setAgentSessions(prev =>
                          prev.some(s => s.id === newSession.id) ? prev : [newSession, ...prev],
                        );
                        setActiveSessionId(newSession.id);
                        syncUrlParams({ session: newSession.id });
                      }
                      if (selectedId) fetchAgentSessions(selectedId);
                    }}
                  />
                </div>
              ) : (
                <SettingsForm
                  creating={false}
                  form={form}
                  setForm={setForm}
                  selectedAgent={selectedAgent}
                  hasChanges={hasChanges}
                  saving={saving}
                  onSave={handleSave}
                  onClose={handleClose}
                  onDelete={handleDelete}
                  selectedId={selectedId}
                  onExpandPrompt={() => setExpandedPrompt(true)}
                />
              )}
            </>
          )
        ) : (
          /* Empty state */
          <div className="flex h-full flex-col items-center justify-center text-zinc-400">
            <Bot className="mb-3 h-10 w-10" />
            <p className="text-sm">选择一个 Agent 查看详情，或创建新的 Agent</p>
            <button
              onClick={handleStartCreate}
              className="mt-4 flex items-center gap-1.5 rounded-md bg-zinc-900 px-4 py-2 text-sm text-white hover:bg-zinc-700 transition-colors dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              <Plus className="h-4 w-4" />
              新建 Agent
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
