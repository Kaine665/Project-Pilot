'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Bot, Plus, Trash2, X, ChevronRight, Terminal, FileText, Globe, Users, ShieldOff, Maximize2, Minimize2,
  Database, Brain, Code, Zap, Search, Shield, Wrench, BookOpen, Settings, MessageSquare, Check, Copy, ListTodo, Eye, ChevronDown, type LucideIcon,
} from 'lucide-react';
import type { Agent, AgentCapabilities, ContextEntry } from '@/types';
import { AgentChatPanel, type SessionListItem } from '@/components/agent-chat-panel';
import { DEFAULT_AGENT_CAPABILITIES } from '@/types';

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
  { key: 'todoRead',        label: '读取待办',       description: '将 pending 待办注入提示词',           icon: ListTodo },
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

// ── Types ──

interface AllSessionItem {
  id: string;
  title: string;
  updatedAt: string;
  agentId: string;
  agentName: string;
  agentIcon?: string;
}

// Opened session instance: tracks a mounted AgentChatPanel
interface OpenedSession {
  sessionId: string | null; // null = new session (not yet created)
  agentId: string;
  key: number; // stable key for React
}

// ── Session day-grouping helper ──

function groupSessionsByDay<T extends { updatedAt: string }>(sessions: T[]) {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = todayStart - 86_400_000;

  const groups: Array<{ label: string; items: T[] }> = [];
  const map = new Map<string, T[]>();

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
  // ── Core data ──
  const [agents, setAgents] = useState<Agent[]>([]);
  const [allSessions, setAllSessions] = useState<AllSessionItem[]>([]);

  // ── Sidebar tab ──
  const [sidebarTab, setSidebarTab] = useState<'conversations' | 'agents'>('conversations');

  // ── Active panel ──
  const [activePanel, setActivePanel] = useState<
    | { type: 'session'; key: number }
    | { type: 'agent'; agentId: string; mode: 'chat' | 'settings' }
    | null
  >(null);

  // ── Multi-instance session panels (切换不销毁) ──
  const [openedSessions, setOpenedSessions] = useState<OpenedSession[]>([]);
  const nextKeyRef = useRef(1);

  // ── Agent create/edit ──
  const [creating, setCreating] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [expandedPrompt, setExpandedPrompt] = useState(false);

  // ── New session agent picker ──
  const [showAgentPicker, setShowAgentPicker] = useState(false);
  const agentPickerRef = useRef<HTMLDivElement>(null);

  // ── Fetch agents ──
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
        setSelectedAgentId(agent.id);
        setForm(agentToForm(agent));
        if (sessionParam) {
          // Open the session panel for this session
          const key = nextKeyRef.current++;
          setOpenedSessions(prev => [...prev, { sessionId: sessionParam, agentId: agent.id, key }]);
          setActivePanel({ type: 'session', key });
        } else {
          setActivePanel({ type: 'agent', agentId: agent.id, mode: 'chat' });
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

  // ── Fetch all sessions (cross-agent) ──
  const fetchAllSessions = useCallback(async () => {
    try {
      const [sessRes, agentsRes] = await Promise.all([
        fetch('/api/agent-chat/sessions', { cache: 'no-store' }),
        fetch('/api/agents'),
      ]);
      const sessData = await sessRes.json();
      const agentsData = await agentsRes.json();
      const agentMap = new Map<string, Agent>();
      for (const a of (agentsData.agents ?? []) as Agent[]) {
        agentMap.set(a.id, a);
      }
      const sessions: AllSessionItem[] = (sessData.sessions ?? []).map((s: { id: string; title: string; updatedAt: string; agentId: string }) => {
        const agent = agentMap.get(s.agentId);
        return {
          id: s.id,
          title: s.title,
          updatedAt: s.updatedAt,
          agentId: s.agentId,
          agentName: agent?.name ?? '未知 Agent',
          agentIcon: agent?.icon,
        };
      });
      setAllSessions(sessions);
      // Also update agents cache
      setAgents(agentsData.agents ?? []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchAllSessions(); }, [fetchAllSessions]);

  // ── Grouped sessions for display ──
  const groupedSessions = useMemo(() => groupSessionsByDay(allSessions), [allSessions]);

  // ── Close agent picker when clicking outside ──
  useEffect(() => {
    if (!showAgentPicker) return;
    const handleClick = (e: MouseEvent) => {
      if (agentPickerRef.current && !agentPickerRef.current.contains(e.target as Node)) {
        setShowAgentPicker(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showAgentPicker]);

  // ── Handlers: Conversations tab ──

  const handleSessionClick = (session: AllSessionItem) => {
    // Check if already opened
    const existing = openedSessions.find(
      o => o.sessionId === session.id && o.agentId === session.agentId,
    );
    if (existing) {
      setActivePanel({ type: 'session', key: existing.key });
      syncUrlParams({ agent: session.agentId, session: session.id });
      return;
    }
    // Open new instance
    const key = nextKeyRef.current++;
    setOpenedSessions(prev => [...prev, { sessionId: session.id, agentId: session.agentId, key }]);
    setActivePanel({ type: 'session', key });
    syncUrlParams({ agent: session.agentId, session: session.id });
  };

  const handleNewSession = (agent: Agent) => {
    const key = nextKeyRef.current++;
    setOpenedSessions(prev => [...prev, { sessionId: null, agentId: agent.id, key }]);
    setActivePanel({ type: 'session', key });
    setShowAgentPicker(false);
    syncUrlParams({ agent: agent.id, session: null });
  };

  // ── Handlers: Agents tab ──

  const handleAgentClick = (agent: Agent) => {
    setCreating(false);
    setSelectedAgentId(agent.id);
    setForm(agentToForm(agent));
    setExpandedPrompt(false);
    setActivePanel({ type: 'agent', agentId: agent.id, mode: 'chat' });
    syncUrlParams({ agent: agent.id, session: null });
  };

  // Alias for handleAgentClick used by handleClone
  const handleSelect = handleAgentClick;

  const handleStartCreate = () => {
    setSelectedAgentId(null);
    setCreating(true);
    setForm(emptyForm);
    setExpandedPrompt(false);
    setActivePanel(null);
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
    setSelectedAgentId(null);
    setCreating(false);
    setForm(emptyForm);
    setExpandedPrompt(false);
    if (activePanel?.type === 'agent') {
      setActivePanel(null);
    }
    syncUrlParams({ agent: null, session: null });
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
          setSelectedAgentId(data.agent.id);
          setForm(agentToForm(data.agent));
          setActivePanel({ type: 'agent', agentId: data.agent.id, mode: 'chat' });
          syncUrlParams({ agent: data.agent.id, session: null });
        }
      } else if (selectedAgentId) {
        const res = await fetch('/api/agents', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: selectedAgentId,
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
        if (selectedAgentId === id) {
          setSelectedAgentId(null);
          setForm(emptyForm);
          setActivePanel(null);
          syncUrlParams({ agent: null, session: null });
        }
      }
    } catch { /* ignore */ }
  };

  // ── Derived state ──
  const selectedAgent = agents.find(a => a.id === selectedAgentId) ?? null;
  const agentViewMode = activePanel?.type === 'agent' ? activePanel.mode : 'chat';

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

  // ── Active session info (for header display) ──
  const activeOpened = activePanel?.type === 'session'
    ? openedSessions.find(o => o.key === activePanel.key)
    : null;
  const activeSessionAgent = activeOpened
    ? agents.find(a => a.id === activeOpened.agentId) ?? null
    : null;
  const activeSessionInfo = activeOpened?.sessionId
    ? allSessions.find(s => s.id === activeOpened.sessionId)
    : null;

  return (
    <div className="flex h-full">
      {/* Left sidebar */}
      <div className="flex w-72 shrink-0 flex-col border-r border-zinc-200 dark:border-zinc-800">
        {/* ── Tab switcher ── */}
        <div className="flex border-b border-zinc-200 dark:border-zinc-800">
          <button
            onClick={() => setSidebarTab('conversations')}
            className={`flex flex-1 items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-medium transition-colors ${
              sidebarTab === 'conversations'
                ? 'border-b-2 border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100'
                : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300'
            }`}
          >
            <MessageSquare className="h-3.5 w-3.5" />
            对话
          </button>
          <button
            onClick={() => setSidebarTab('agents')}
            className={`flex flex-1 items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-medium transition-colors ${
              sidebarTab === 'agents'
                ? 'border-b-2 border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100'
                : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300'
            }`}
          >
            <Bot className="h-3.5 w-3.5" />
            Agents
          </button>
        </div>

        {/* ── Tab content ── */}
        {sidebarTab === 'conversations' ? (
          <div className="flex flex-1 flex-col overflow-hidden">
            {/* New session button */}
            <div className="relative flex items-center justify-between border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
              <div className="text-xs font-medium text-zinc-400">
                {allSessions.length > 0 && `${allSessions.length} 个对话`}
              </div>
              <button
                onClick={() => setShowAgentPicker(v => !v)}
                className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 transition-colors dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
                title="新建对话"
              >
                <Plus className="h-4 w-4" />
              </button>
              {/* Agent picker dropdown */}
              {showAgentPicker && (
                <div
                  ref={agentPickerRef}
                  className="absolute right-2 top-full z-20 mt-1 w-56 rounded-lg border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
                >
                  <div className="px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-zinc-400">
                    选择 Agent 开始对话
                  </div>
                  {agents.map(a => (
                    <button
                      key={a.id}
                      onClick={() => handleNewSession(a)}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-zinc-50 transition-colors dark:hover:bg-zinc-800"
                    >
                      <AgentIcon iconKey={a.icon} className="h-4 w-4 shrink-0 text-zinc-400" />
                      <span className="truncate text-zinc-900 dark:text-zinc-100">{a.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {/* Session list */}
            <div className="flex-1 overflow-y-auto">
              {allSessions.length === 0 ? (
                <div className="px-4 py-12 text-center text-xs text-zinc-400">
                  <MessageSquare className="mx-auto mb-2 h-8 w-8 text-zinc-300 dark:text-zinc-600" />
                  <p>暂无对话</p>
                  <p className="mt-1">点击右上角 + 开始新对话</p>
                </div>
              ) : (
                groupedSessions.map(group => (
                  <div key={group.label}>
                    <div className="sticky top-0 bg-zinc-50 px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-zinc-400 dark:bg-zinc-900 dark:text-zinc-500">
                      {group.label}
                    </div>
                    {group.items.map(s => {
                      const isActive = activePanel?.type === 'session'
                        && openedSessions.find(o => o.key === activePanel.key)?.sessionId === s.id;
                      return (
                        <div
                          key={s.id}
                          onClick={() => handleSessionClick(s)}
                          className={`flex cursor-pointer items-center gap-3 px-4 py-2.5 transition-colors ${
                            isActive
                              ? 'bg-zinc-100 dark:bg-zinc-800'
                              : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                          }`}
                        >
                          <AgentIcon iconKey={s.agentIcon} className="h-4 w-4 shrink-0 text-zinc-400" />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                              {s.title}
                            </div>
                            <div className="truncate text-zinc-400" style={{ fontSize: 13 }}>
                              {s.agentName}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))
              )}
            </div>
          </div>
        ) : (
          /* ── Agents tab ── */
          <div className="flex flex-1 flex-col overflow-hidden">
            <div className="flex items-center justify-between border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
              <div className="text-xs font-medium text-zinc-400">
                {agents.length > 0 && `${agents.length} 个 Agent`}
              </div>
              <button
                onClick={handleStartCreate}
                className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 transition-colors dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
                title="新建 Agent"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {agents.length === 0 ? (
                <div className="px-4 py-8 text-center text-xs text-zinc-400">
                  暂无 Agent
                </div>
              ) : (
                agents.map(a => (
                  <div
                    key={a.id}
                    onClick={() => handleAgentClick(a)}
                    className={`group flex cursor-pointer items-center gap-3 border-b border-zinc-100 px-4 py-3 transition-colors dark:border-zinc-800/50 ${
                      activePanel?.type === 'agent' && activePanel.agentId === a.id
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
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-zinc-300 dark:text-zinc-600" />
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* Right panel */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {creating ? (
          /* ── Creating new agent ── */
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
              selectedId={selectedAgentId}
              onExpandPrompt={() => setExpandedPrompt(true)}
            />
          )
        ) : activePanel?.type === 'agent' && selectedAgent ? (
          /* ── Agent detail (chat / settings) ── */
          expandedPrompt && agentViewMode === 'settings' ? (
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
              {/* Agent panel header */}
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
                    onClick={() => {
                      if (activePanel?.type === 'agent') {
                        const newMode = activePanel.mode === 'chat' ? 'settings' : 'chat';
                        setActivePanel({ ...activePanel, mode: newMode });
                        setExpandedPrompt(false);
                      }
                    }}
                    className={`rounded-md p-1.5 transition-colors ${
                      agentViewMode === 'settings'
                        ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
                        : 'text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300'
                    }`}
                    title={agentViewMode === 'chat' ? '设置' : '聊天'}
                  >
                    {agentViewMode === 'chat' ? <Settings className="h-4 w-4" /> : <MessageSquare className="h-4 w-4" />}
                  </button>
                  {!selectedAgent.builtIn && (
                    <button
                      onClick={() => handleDelete(selectedAgentId!)}
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

              {agentViewMode === 'chat' ? (
                <div className="flex-1 overflow-hidden">
                  <AgentChatPanel
                    key={`agent-${selectedAgent.id}`}
                    agent={selectedAgent}
                    initialSessionId={null}
                    onSessionChange={() => fetchAllSessions()}
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
                  selectedId={selectedAgentId}
                  onExpandPrompt={() => setExpandedPrompt(true)}
                />
              )}
            </>
          )
        ) : activePanel?.type === 'session' ? (
          /* ── Session chat panels (multi-instance, CSS visibility toggle) ── */
          <>
            {/* Session header */}
            {activeSessionAgent && (
              <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
                <div className="flex items-center gap-2 min-w-0">
                  <AgentIcon iconKey={activeSessionAgent.icon} className="h-4 w-4 shrink-0 text-zinc-500" />
                  <span className="text-sm font-medium text-zinc-900 truncate dark:text-zinc-100">
                    {activeSessionInfo?.title ?? '新会话'}
                  </span>
                  <span className="text-xs text-zinc-400 shrink-0">
                    — {activeSessionAgent.name}
                  </span>
                </div>
              </div>
            )}
            {/* Render all opened sessions, toggle visibility */}
            <div className="flex-1 overflow-hidden relative">
              {openedSessions.map(os => {
                const agent = agents.find(a => a.id === os.agentId);
                if (!agent) return null;
                const isVisible = activePanel.key === os.key;
                return (
                  <div
                    key={os.key}
                    className={`absolute inset-0 ${isVisible ? 'flex flex-col' : 'hidden'}`}
                  >
                    <AgentChatPanel
                      agent={agent}
                      initialSessionId={os.sessionId}
                      onSessionChange={(newSession) => {
                        // Update the opened session's sessionId if it was null (new session)
                        if (newSession && os.sessionId === null) {
                          setOpenedSessions(prev =>
                            prev.map(p => p.key === os.key ? { ...p, sessionId: newSession.id } : p),
                          );
                          syncUrlParams({ session: newSession.id });
                        }
                        fetchAllSessions();
                      }}
                    />
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          /* ── Empty state ── */
          <div className="flex h-full flex-col items-center justify-center text-zinc-400">
            <MessageSquare className="mb-3 h-10 w-10" />
            <p className="text-sm">选择一个对话，或开始新的对话</p>
            <button
              onClick={() => { setSidebarTab('conversations'); setShowAgentPicker(true); }}
              className="mt-4 flex items-center gap-1.5 rounded-md bg-zinc-900 px-4 py-2 text-sm text-white hover:bg-zinc-700 transition-colors dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              <Plus className="h-4 w-4" />
              新建对话
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
