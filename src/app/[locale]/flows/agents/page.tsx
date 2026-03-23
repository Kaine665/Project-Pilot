'use client';

import { useState, useEffect, useCallback, useMemo, useRef, memo } from 'react';
import {
  Bell,
  Bot, Plus, Trash2, X, ChevronRight, Minimize2,
  Settings, MessageSquare, Archive, ArchiveRestore,
  Download, Upload, FileDown, FolderOpen, Search,
  Command, Share2, MoreVertical, Terminal, Globe,
  Files, GitBranch, Eye, Database, ListTodo, HardDrive,
  FileText, FileJson,
} from 'lucide-react';
import dynamic from 'next/dynamic';
import type { Agent, ProviderId, OpenAIReasoningEffort } from '@/types';
import { DEFAULT_AGENT_CAPABILITIES } from '@/types';
import { FolderExplorerPanel } from '@/components/folder-explorer-panel';
import { AgentSessionPromptStack } from '@/components/agent-session-prompt-stack';

const AgentChatPanel = dynamic(
  () => import('@/components/agent-chat-panel').then(m => ({ default: m.AgentChatPanel })),
  {
    ssr: false,
    loading: () => (
      <div className="flex-1 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-muted-foreground/30 border-t-primary" />
      </div>
    ),
  }
);
import { AgentIcon, SettingsForm, type FormData, emptyForm, agentToForm } from '@/components/agent-form';
import { AgentPickerDropdown } from '@/components/agent-picker-dropdown';
import { AgentPickerModal } from '@/components/agent-picker-modal';
import { type AllSessionItem, type OpenedSession, groupSessionsByDay, syncUrlParams } from '@/components/agent-session-utils';
import { useProject } from '@/components/project-context';
import { getProviderPreset } from '@/lib/provider-registry';


// ── Helpers ──

function formatSessionElapsed(startedAt: string | undefined, nowTs: number): string {
  if (!startedAt) return '0s';
  const diffSeconds = Math.max(0, Math.floor((nowTs - new Date(startedAt).getTime()) / 1000));
  if (diffSeconds < 60) return `${diffSeconds}s`;
  if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)}m`;
  return `${Math.floor(diffSeconds / 3600)}h`;
}

function formatSessionTimestamp(timestamp: string | undefined, nowTs: number): string {
  if (!timestamp) return '--';
  const diffSeconds = Math.max(0, Math.floor((nowTs - new Date(timestamp).getTime()) / 1000));
  if (diffSeconds < 60) return `${diffSeconds}s`;
  if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)}m`;
  if (diffSeconds < 86400) return `${Math.floor(diffSeconds / 3600)}h`;
  if (diffSeconds < 172800) return 'Yesterday';
  return `${Math.floor(diffSeconds / 86400)}d`;
}

function estimateTokenCount(content: string | undefined): number {
  const normalized = content?.trim() ?? '';
  if (!normalized) return 0;
  return Math.max(1, Math.round(normalized.length / 4));
}

function formatTokenCount(tokens: number | null | undefined): string {
  if (!tokens) return '--';
  if (tokens >= 1000) return `~${(tokens / 1000).toFixed(1)}k`;
  return `~${tokens}`;
}

function getBaseName(pathValue: string | undefined): string {
  if (!pathValue) return 'develop-static';
  const normalized = pathValue.replace(/\\/g, '/').replace(/\/+$/, '');
  const segments = normalized.split('/').filter(Boolean);
  return segments[segments.length - 1] ?? 'develop-static';
}

// ── Session card (memo-ized to avoid re-render on listClockNow ticks) ──

interface SessionCardProps {
  session: AllSessionItem;
  isActive: boolean;
  listClockNow: number | undefined; // only passed when session.isRunning
  onClick: (session: AllSessionItem) => void;
  onArchiveToggle: (session: AllSessionItem, e: React.MouseEvent) => void;
}

const SessionCard = memo(function SessionCard({
  session: s,
  isActive,
  listClockNow,
  onClick,
  onArchiveToggle,
}: SessionCardProps) {
  const nowTs = listClockNow ?? 0;

  return (
    <div
      onClick={() => onClick(s)}
      className={`group/session flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-3 transition-all ${
        isActive
          ? 'border-zinc-200 bg-zinc-50 shadow-sm dark:border-zinc-700 dark:bg-zinc-800'
          : 'border-transparent hover:border-zinc-100 hover:bg-zinc-50 dark:hover:border-zinc-700/50 dark:hover:bg-zinc-800/50'
      } ${s.archived ? 'opacity-45' : ''}`}
    >
      <div className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ${
        isActive ? 'bg-white shadow-sm ring-zinc-200 dark:bg-zinc-700 dark:ring-zinc-600' : 'bg-zinc-100 ring-zinc-100 dark:bg-zinc-800 dark:ring-zinc-700'
      }`}>
        <AgentIcon iconKey={s.agentIcon} className={`h-5 w-5 ${s.archived ? 'text-zinc-300 dark:text-zinc-600' : 'text-zinc-500 dark:text-zinc-400'}`} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 flex items-start justify-between gap-2">
          <div className={`truncate text-[13px] ${s.archived ? 'font-medium text-zinc-400 dark:text-zinc-500' : 'font-semibold text-zinc-900 dark:text-zinc-100'}`}>
            {s.title}
          </div>
          <span className="shrink-0 pt-0.5 text-[10px] font-medium text-zinc-400 dark:text-zinc-500">
            {s.isRunning && listClockNow !== undefined
              ? formatSessionElapsed(s.runningStartedAt, listClockNow)
              : formatSessionTimestamp(s.updatedAt, nowTs)}
          </span>
        </div>
        <div className={`truncate text-[11px] ${s.archived ? 'text-zinc-300 dark:text-zinc-600' : 'text-zinc-500 dark:text-zinc-400'}`}>
          {s.agentName}
        </div>
        {s.archived && (
          <div className="mt-1 text-[10px] uppercase tracking-[0.14em] text-zinc-300 dark:text-zinc-600">
            Archived
          </div>
        )}
      </div>
      {!isActive && !!s.unreadCount && s.unreadCount > 0 && !s.archived && (
        <span className="flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded-full bg-zinc-900 px-1.5 text-[10px] font-bold text-white dark:bg-zinc-100 dark:text-zinc-900">
          {s.unreadCount > 99 ? '99+' : s.unreadCount}
        </span>
      )}
      <button
        onClick={(e) => onArchiveToggle(s, e)}
        className="shrink-0 rounded-lg p-1.5 text-zinc-400 opacity-0 transition-all hover:bg-zinc-100 hover:text-zinc-600 group-hover/session:opacity-100 dark:text-zinc-500 dark:hover:bg-zinc-700 dark:hover:text-zinc-400"
        title={s.archived ? '取消归档' : '归档'}
      >
        {s.archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
      </button>
    </div>
  );
});

// ── Main page ──

export default function AgentsPage() {
  const { projects, activeKey, initialized: projectInitialized } = useProject();

  // ── Core data ──
  const [agents, setAgents] = useState<Agent[]>([]);
  const agentsRef = useRef<Agent[]>(agents);
  agentsRef.current = agents;
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
  const openedSessionsRef = useRef<OpenedSession[]>(openedSessions);
  openedSessionsRef.current = openedSessions;
  const nextKeyRef = useRef(1);

  // ── Agent create/edit ──
  const [creating, setCreating] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [expandedPrompt, setExpandedPrompt] = useState(false);

  // ── Session archive filter ──
  const [sessionFilter, setSessionFilter] = useState<'active' | 'archived' | 'all'>('active');
  const [sessionQuery, setSessionQuery] = useState('');

  // ── New session agent picker (dropdown + modal) ──
  const [showAgentDropdown, setShowAgentDropdown] = useState(false);
  const [showAgentModal, setShowAgentModal] = useState(false);

  // ── Cached settings for child panels (fetched once, shared to all AgentChatPanel instances) ──
  type CachedSettings = { provider: ProviderId; model: string; modelOptions: Array<{ value: string; label: string }>; effort: OpenAIReasoningEffort };
  const [cachedSettings, setCachedSettings] = useState<CachedSettings | undefined>(undefined);
  const [promptMetrics, setPromptMetrics] = useState<{ global: number | null; project: number | null }>({
    global: null,
    project: null,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/settings', { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        const claude = data?.claude ?? {};
        const loadedProvider = (claude.provider as ProviderId) || 'anthropic';
        const providerModelsMap = (claude.providerModels && typeof claude.providerModels === 'object')
          ? claude.providerModels as Partial<Record<ProviderId, string>>
          : {};
        const providerModelLib = (claude.providerModelLibrary && typeof claude.providerModelLibrary === 'object')
          ? claude.providerModelLibrary as Partial<Record<ProviderId, string[]>>
          : {};
        const preset = getProviderPreset(loadedProvider);
        const optionMap = new Map<string, string>();
        for (const m of preset.models) optionMap.set(m.id, m.label || m.id);
        const libModels = Array.isArray(providerModelLib[loadedProvider]) ? providerModelLib[loadedProvider] : [];
        for (const raw of libModels) {
          const id = typeof raw === 'string' ? raw.trim() : '';
          if (id && !optionMap.has(id)) optionMap.set(id, id);
        }
        const fallbackModel = (providerModelsMap[loadedProvider] || claude.model || '').trim();
        if (fallbackModel && !optionMap.has(fallbackModel)) optionMap.set(fallbackModel, fallbackModel);
        const modelOptions = Array.from(optionMap.entries()).map(([value, label]) => ({ value, label }));
        const model = modelOptions.some((o) => o.value === fallbackModel) ? fallbackModel : (modelOptions[0]?.value || '');
        const VALID_EFFORTS: OpenAIReasoningEffort[] = ['low', 'medium', 'high', 'xhigh'];
        const effort: OpenAIReasoningEffort = (typeof claude.openaiReasoningEffort === 'string' && VALID_EFFORTS.includes(claude.openaiReasoningEffort)) ? claude.openaiReasoningEffort : 'xhigh';
        setCachedSettings({ provider: loadedProvider, model, modelOptions, effort });
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, []);

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

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const nextMetrics: { global: number | null; project: number | null } = {
        global: null,
        project: null,
      };

      try {
        const globalRes = await fetch('/api/global-prompt', { cache: 'no-store' });
        if (globalRes.ok) {
          const globalData = await globalRes.json();
          nextMetrics.global = estimateTokenCount(globalData.content);
        }
      } catch {
        // ignore prompt metric failures
      }

      if (activeKey) {
        try {
          const projectRes = await fetch(`/api/project-prompt/${encodeURIComponent(activeKey)}`, {
            cache: 'no-store',
          });
          if (projectRes.ok) {
            const projectData = await projectRes.json();
            nextMetrics.project = estimateTokenCount(projectData.content);
          }
        } catch {
          // ignore prompt metric failures
        }
      }

      if (!cancelled) {
        setPromptMetrics(nextMetrics);
      }
    })();

    return () => { cancelled = true; };
  }, [activeKey]);

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

  // ── Session cache per project (stale-while-revalidate) ──
  const sessionCacheRef = useRef<Map<string, AllSessionItem[]>>(new Map());
  const CACHE_KEY_ALL = '__all__';

  // 解析首次渲染时 URL 上的 projectKey，跳过等待 ProjectProvider 初始化
  const initialProjectKeyRef = useRef<string | null>(
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('project')
      : null,
  );

  // 实际使用的 projectKey：优先用 ProjectProvider 的值，首次渲染时用 URL 直读值
  const effectiveProjectKey = projectInitialized ? activeKey : initialProjectKeyRef.current;

  // ── Fetch all sessions (cross-agent, filtered by active project) ──
  const fetchAllSessions = useCallback(async () => {
    const key = effectiveProjectKey;
    const cacheKey = key ?? CACHE_KEY_ALL;

    // 切换项目时立即展示缓存数据（如有）
    // 使用函数式更新，避免覆盖乐观插入的新会话
    const cached = sessionCacheRef.current.get(cacheKey);
    if (cached) {
      setAllSessions(prev => {
        // 保留 prev 中已有但 cached 中没有的条目（乐观插入的新会话）
        const cachedIds = new Set(cached.map(s => s.id));
        const optimistic = prev.filter(s => !cachedIds.has(s.id));
        // 保留 prev 中的运行时状态（isRunning 不会被持久化到缓存或 API）
        const runtimeMap = new Map<string, Pick<AllSessionItem, 'isRunning' | 'runningStartedAt'>>();
        for (const s of prev) {
          if (s.isRunning) runtimeMap.set(s.id, { isRunning: s.isRunning, runningStartedAt: s.runningStartedAt });
        }
        const restored = runtimeMap.size > 0
          ? cached.map(s => { const rt = runtimeMap.get(s.id); return rt ? { ...s, ...rt } : s; })
          : cached;
        return optimistic.length > 0 ? [...optimistic, ...restored] : restored;
      });
    }

    try {
      const sessUrl = key
        ? `/api/agent-chat/sessions?projectKey=${encodeURIComponent(key)}`
        : '/api/agent-chat/sessions';
      const sessRes = await fetch(sessUrl, { cache: 'no-store' });
      const sessData = await sessRes.json();
      // Reuse already-loaded agents from agentsRef instead of fetching /api/agents again
      const agentMap = new Map<string, Agent>();
      for (const a of agentsRef.current) {
        agentMap.set(a.id, a);
      }
      const sessions: AllSessionItem[] = (sessData.sessions ?? []).map((s: { id: string; title: string; updatedAt: string; agentId: string; unreadCount?: number; archived?: boolean; projectKey?: string }) => {
        const agent = agentMap.get(s.agentId);
        return {
          id: s.id,
          title: s.title,
          updatedAt: s.updatedAt,
          agentId: s.agentId,
          agentName: agent?.name ?? '未知 Agent',
          agentIcon: agent?.icon,
          unreadCount: s.unreadCount,
          archived: s.archived,
          projectKey: s.projectKey,
        };
      });
      // merge 逻辑：保留乐观插入的本地会话（服务端还没来得及落盘的新会话），
      // 同时用服务端数据覆盖已有条目。有项目过滤时额外排除其他项目的残留。
      setAllSessions(prev => {
        const remoteIds = new Set(sessions.map((s: AllSessionItem) => s.id));
        const localOnly = prev.filter(s =>
          !remoteIds.has(s.id)
          && (!key || !s.projectKey || s.projectKey === key),
        );
        // 保留 prev 中的运行时状态（isRunning 不会被 API 返回）
        const runtimeMap = new Map<string, Pick<AllSessionItem, 'isRunning' | 'runningStartedAt'>>();
        for (const s of prev) {
          if (s.isRunning) runtimeMap.set(s.id, { isRunning: s.isRunning, runningStartedAt: s.runningStartedAt });
        }
        const restoredSessions = runtimeMap.size > 0
          ? sessions.map(s => { const rt = runtimeMap.get(s.id); return rt ? { ...s, ...rt } : s; })
          : sessions;
        const merged = [...localOnly, ...restoredSessions];
        // 写入缓存
        sessionCacheRef.current.set(cacheKey, merged);
        return merged;
      });
      // Agents are already kept up-to-date via fetchAgents(); no duplicate fetch needed.
    } catch { /* ignore */ }
  }, [effectiveProjectKey]);

  useEffect(() => { fetchAllSessions(); }, [fetchAllSessions]);

  // ── Clear opened session panels when project changes ──
  const prevProjectKeyRef = useRef(effectiveProjectKey);
  useEffect(() => {
    if (prevProjectKeyRef.current !== effectiveProjectKey) {
      prevProjectKeyRef.current = effectiveProjectKey;
      setOpenedSessions([]);
      setActivePanel(null);
      setSelectedAgentId(null);
      setCreating(false);
      setForm(emptyForm);
      setExpandedPrompt(false);
    }
  }, [effectiveProjectKey]);

  // ── Clock for running-session elapsed display ──
  const hasRunningSession = useMemo(() => allSessions.some(s => s.isRunning), [allSessions]);
  const [listClockNow, setListClockNow] = useState(() => Date.now());
  useEffect(() => {
    if (!hasRunningSession) return;
    const timer = setInterval(() => setListClockNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [hasRunningSession]);

  // ── Filtered sessions by archive status ──
  const filteredSessions = useMemo(() => {
    if (sessionFilter === 'all') return allSessions;
    if (sessionFilter === 'archived') return allSessions.filter(s => s.archived);
    return allSessions.filter(s => !s.archived); // 'active'
  }, [allSessions, sessionFilter]);

  // ── Project-filtered agents（项目专属排前面，全局排后面）──
  const filteredAgents = useMemo(() => {
    if (!activeKey) return agents;
    return agents
      .filter(a => !a.projectKey || a.projectKey === activeKey)
      .sort((a, b) => {
        const aGlobal = a.projectKey ? 0 : 1;
        const bGlobal = b.projectKey ? 0 : 1;
        return aGlobal - bGlobal;
      });
  }, [agents, activeKey]);

  // ── Recent agent IDs (derived from sessions) ──
  const recentAgentIds = useMemo(() => {
    const seen = new Set<string>();
    const result: string[] = [];
    // allSessions are already sorted by most recent first
    for (const s of allSessions) {
      if (!seen.has(s.agentId)) {
        seen.add(s.agentId);
        result.push(s.agentId);
      }
      if (result.length >= 5) break;
    }
    return result;
  }, [allSessions]);

  // ── Handlers: Conversations tab ──

  const handleSessionClick = useCallback((session: AllSessionItem) => {
    // Mark as read (fire-and-forget + clear local state immediately)
    if (session.unreadCount) {
      setAllSessions(prev => prev.map(s => s.id === session.id ? { ...s, unreadCount: 0 } : s));
      fetch(`/api/agent-chat/sessions/${session.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'markAsRead' }),
      }).catch(() => {});
    }

    // Read latest via ref to avoid calling setState/syncUrlParams inside an updater
    const existing = openedSessionsRef.current.find(
      o => o.sessionId === session.id && o.agentId === session.agentId,
    );

    if (existing) {
      setActivePanel({ type: 'session', key: existing.key });
    } else {
      const key = nextKeyRef.current++;
      setOpenedSessions(prev => [...prev, { sessionId: session.id, agentId: session.agentId, key }]);
      setActivePanel({ type: 'session', key });
    }
    syncUrlParams({ agent: session.agentId, session: session.id });
  }, []);

  const handleNewSession = (agent: Agent) => {
    const key = nextKeyRef.current++;
    setOpenedSessions(prev => [...prev, { sessionId: null, agentId: agent.id, key }]);
    setActivePanel({ type: 'session', key });
    setShowAgentDropdown(false);
    syncUrlParams({ agent: agent.id, session: null });
  };

  const handleArchiveToggle = useCallback((session: AllSessionItem, e: React.MouseEvent) => {
    e.stopPropagation();
    const newArchived = !session.archived;
    // Optimistic update
    setAllSessions(prev => prev.map(s => s.id === session.id ? { ...s, archived: newArchived } : s));
    fetch(`/api/agent-chat/sessions/${session.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: newArchived ? 'archive' : 'unarchive' }),
    }).then(res => {
      if (!res.ok) {
        console.error(`Archive toggle failed: ${res.status}`);
        // Rollback on failure
        setAllSessions(prev => prev.map(s => s.id === session.id ? { ...s, archived: !newArchived } : s));
      }
    }).catch(() => {
      // Rollback on network error
      setAllSessions(prev => prev.map(s => s.id === session.id ? { ...s, archived: !newArchived } : s));
    });
  }, []);

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
    setForm({ ...emptyForm, projectKey: activeKey ?? '' });
    setExpandedPrompt(false);
    setActivePanel(null);
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
        const skillRefs = form.skillIds.map(id => ({ type: 'skill' as const, id, priority: 60 }));
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
            defaultResources: skillRefs.length > 0 ? skillRefs : undefined,
            projectKey: form.projectKey || undefined,
            defaultProvider: form.defaultProvider || undefined,
            defaultModel: form.defaultModel || undefined,
            contextStrategy: form.contextStrategy || undefined,
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
        const skillRefs = form.skillIds.map(id => ({ type: 'skill' as const, id, priority: 60 }));
        // Preserve non-skill defaultResources from the existing agent, replace skill refs
        const existingNonSkillRefs = (selectedAgent?.defaultResources ?? []).filter(r => r.type !== 'skill');
        const updatedDefaultResources = [...existingNonSkillRefs, ...skillRefs];
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
            defaultResources: updatedDefaultResources.length > 0 ? updatedDefaultResources : [],
            projectKey: form.projectKey || undefined,
            defaultProvider: form.defaultProvider || undefined,
            defaultModel: form.defaultModel || undefined,
            contextStrategy: form.contextStrategy || undefined,
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

  // ── Export / Import ──

  const handleExport = async (agent: Agent) => {
    try {
      const res = await fetch(`/api/agents/export/${agent.id}`);
      if (!res.ok) return;
      const blob = await res.blob();
      const safeName = agent.name.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '_');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${safeName}.ppagent`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { /* ignore */ }
  };

  const handleImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.ppagent';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const pkg = JSON.parse(text);
        const res = await fetch('/api/agents/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(pkg),
        });
        if (res.ok) {
          const data = await res.json();
          await fetchAgents();
          handleSelect(data.agent);
          const msg = data.contextsImported > 0
            ? `已导入 Agent「${data.agent.name}」及 ${data.contextsImported} 个上下文`
            : `已导入 Agent「${data.agent.name}」`;
          alert(msg);
        } else {
          const err = await res.json();
          alert(`导入失败: ${err.error}`);
        }
      } catch {
        alert('导入失败: 文件格式无效');
      }
    };
    input.click();
  };

  // ── Derived state ──
  const selectedAgent = useMemo(() => agents.find(a => a.id === selectedAgentId) ?? null, [agents, selectedAgentId]);
  const agentViewMode = activePanel?.type === 'agent' ? activePanel.mode : 'chat';

  const hasChanges = useMemo(() => {
    if (creating) return form.name.trim().length > 0;
    if (!selectedAgent) return false;
    return form.name !== selectedAgent.name
      || form.description !== (selectedAgent.description ?? '')
      || form.systemPrompt !== (selectedAgent.systemPrompt ?? '')
      || form.icon !== (selectedAgent.icon ?? '')
      || JSON.stringify(form.capabilities) !== JSON.stringify(selectedAgent.capabilities ?? DEFAULT_AGENT_CAPABILITIES)
      || form.requiredParamsText !== (selectedAgent.requiredParams ?? []).join('\n')
      || JSON.stringify([...form.contextIds].sort()) !== JSON.stringify([...(selectedAgent.contextIds ?? [])].sort())
      || JSON.stringify([...form.skillIds].sort()) !== JSON.stringify(
          [...(selectedAgent.defaultResources ?? []).filter(r => r.type === 'skill').map(r => r.id)].sort()
        )
      || form.projectKey !== (selectedAgent.projectKey ?? '')
      || form.defaultProvider !== (selectedAgent.defaultProvider ?? '')
      || form.defaultModel !== (selectedAgent.defaultModel ?? '')
      || form.contextStrategy !== (selectedAgent.contextStrategy ?? 'additive');
  }, [creating, form, selectedAgent]);

  // ── Pre-computed active session ID for sidebar highlight ──
  const activeSessionId = useMemo(() => {
    if (activePanel?.type !== 'session') return null;
    return openedSessions.find(o => o.key === activePanel.key)?.sessionId ?? null;
  }, [activePanel, openedSessions]);

  // ── Active session info (for header display) ──
  const activeOpened = useMemo(() =>
    activePanel?.type === 'session'
      ? openedSessions.find(o => o.key === activePanel.key) ?? null
      : null,
    [activePanel, openedSessions]);
  const activeSessionAgent = useMemo(() =>
    activeOpened ? agents.find(a => a.id === activeOpened.agentId) ?? null : null,
    [activeOpened, agents]);
  const activeSessionInfo = useMemo(() =>
    activeOpened?.sessionId ? allSessions.find(s => s.id === activeOpened.sessionId) ?? null : null,
    [activeOpened, allSessions]);

  const visibleSessions = useMemo(() => {
    const query = sessionQuery.trim().toLowerCase();
    if (!query) return filteredSessions;
    return filteredSessions.filter((session) => {
      const haystack = `${session.title} ${session.agentName}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [filteredSessions, sessionQuery]);

  const pinnedSession = useMemo(() => {
    if (visibleSessions.length === 0) return null;
    return (
      visibleSessions.find((session) => session.id === activeSessionId)
      ?? visibleSessions.find((session) => session.isRunning)
      ?? visibleSessions[0]
    );
  }, [activeSessionId, visibleSessions]);

  const recentSessions = useMemo(
    () => visibleSessions.filter((session) => session.id !== pinnedSession?.id),
    [pinnedSession?.id, visibleSessions],
  );

  const recentGroups = useMemo(() => groupSessionsByDay(recentSessions), [recentSessions]);

  const activeProject = useMemo(
    () => projects.find((project) => project.key === activeKey) ?? null,
    [projects, activeKey],
  );

  const workspaceAgent = selectedAgent ?? activeSessionAgent;
  const workspaceSessionId = activeSessionInfo?.id ?? activeOpened?.sessionId ?? null;
  const workspaceTitle = activeSessionInfo?.title ?? workspaceAgent?.name ?? 'Agent Workspace';
  const workspaceAgentCapabilities = workspaceAgent?.capabilities ?? DEFAULT_AGENT_CAPABILITIES;
  const projectRootLabel = `${getBaseName(activeProject?.path)}/`;
  const projectPromptLabel = activeKey ? `${activeKey}.md` : 'project-pilot.md';
  const projectPromptPath = activeKey
    ? `~/.project-pilot/data/project-prompts/${activeKey}.md`
    : '~/.project-pilot/data/project-prompts/project-pilot.md';
  const agentPromptLabel = workspaceAgent
    ? `${workspaceAgent.id}.md`
    : 'agent-builtin-self-dev.md';
  const agentPromptPath = workspaceAgent
    ? (workspaceAgent.builtIn
        ? `~/.project-pilot/data/prompts/${workspaceAgent.id}.md`
        : `~/.project-pilot/data/prompts/agents/${workspaceAgent.id}.md`)
    : '~/.project-pilot/data/prompts/agent-builtin-self-dev.md';
  const runtimePromptLabel = workspaceSessionId && workspaceAgent
    ? `${workspaceSessionId}.md`
    : 'session-runtime.md';
  const runtimePromptPath = workspaceSessionId && workspaceAgent
    ? `~/.project-pilot/data/prompts/runtime/${workspaceAgent.id}/${workspaceSessionId}.md`
    : '~/.project-pilot/data/prompts/runtime/<agent>/<session>.md';
  const agentPromptTokens = estimateTokenCount(workspaceAgent?.systemPrompt);
  const combinedPromptTokens = (promptMetrics.global ?? 0) + (promptMetrics.project ?? 0) + agentPromptTokens;
  const promptUsagePercent = Math.min(100, Math.round((combinedPromptTokens / 128000) * 100));

  const promptStackItems = [
    {
      scope: 'Global',
      accent: 'bg-blue-50 text-blue-700 border-blue-100',
      line: 'bg-blue-100',
      label: 'global.md',
      path: '~/.project-pilot/data/prompts/global.md',
      tokens: promptMetrics.global,
      description: '所有 Agent 共用的全局约束、操作规则与安全边界。',
    },
    {
      scope: 'Project',
      accent: 'bg-amber-50 text-amber-700 border-amber-100',
      line: 'bg-amber-100',
      label: projectPromptLabel,
      path: projectPromptPath,
      tokens: promptMetrics.project,
      description: activeKey
        ? `${activeKey} 项目的项目级约束、流程规则与上下文。`
        : '当前项目的项目级约束与工程上下文。',
    },
    {
      scope: 'Agent',
      accent: 'bg-emerald-50 text-emerald-700 border-emerald-100',
      line: 'bg-emerald-100',
      label: agentPromptLabel,
      path: agentPromptPath,
      tokens: agentPromptTokens,
      description: workspaceAgent?.description || '当前 Agent 的系统提示词与默认资源配置。',
    },
    {
      scope: 'Session',
      accent: 'bg-zinc-100 text-zinc-700 border-zinc-200',
      line: 'bg-zinc-200',
      label: runtimePromptLabel,
      path: runtimePromptPath,
      tokens: null,
      description: workspaceSessionId
        ? '当前会话的运行时提示词副本与瞬时记忆状态。'
        : '会话启动后将生成 runtime prompt 副本。',
    },
  ] as const;

  const capabilityCards = [
    { label: 'Terminal', enabled: workspaceAgentCapabilities.bash, icon: Terminal },
    { label: 'Web Browse', enabled: workspaceAgentCapabilities.web, icon: Globe },
    { label: 'File System', enabled: workspaceAgentCapabilities.fileAccess, icon: Files },
    { label: 'Sub Agents', enabled: workspaceAgentCapabilities.subAgent, icon: GitBranch },
    { label: 'Todo Read', enabled: workspaceAgentCapabilities.todoRead, icon: ListTodo },
    { label: 'Data Store', enabled: workspaceAgentCapabilities.dataStore, icon: HardDrive },
    { label: 'Prompt Path', enabled: workspaceAgentCapabilities.exposePromptPath, icon: Eye },
    { label: 'Skip Review', enabled: workspaceAgentCapabilities.skipReview, icon: Database },
  ] as const;

  return (
    <div className="flex h-full overflow-hidden bg-[#fdfdfd] text-zinc-900">
      {/* Left sidebar */}
      <div className="flex w-[320px] shrink-0 flex-col border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        {/* ── Tab switcher ── */}
        <div className="flex gap-1 px-4 pt-4 pb-2">
          <button
            onClick={() => setSidebarTab('conversations')}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-all ${
              sidebarTab === 'conversations'
                ? 'bg-zinc-900 text-white shadow-sm dark:bg-zinc-100 dark:text-zinc-900'
                : 'text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 dark:hover:text-zinc-300'
            }`}
          >
            <MessageSquare className="h-3.5 w-3.5" />
            对话
          </button>
          <button
            onClick={() => setSidebarTab('agents')}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-all ${
              sidebarTab === 'agents'
                ? 'bg-zinc-900 text-white shadow-sm dark:bg-zinc-100 dark:text-zinc-900'
                : 'text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 dark:hover:text-zinc-300'
            }`}
          >
            <Bot className="h-3.5 w-3.5" />
            Agents
          </button>
        </div>

        {/* ── Tab content ── */}
        {sidebarTab === 'conversations' ? (
          <div className="flex flex-1 flex-col overflow-hidden">
            {/* Session filter + new session button */}
            <div className="relative flex items-center justify-between px-5 py-4">
              <div className="flex items-center gap-1 rounded-lg bg-zinc-100 p-0.5 dark:bg-zinc-800">
                {([
                  ['active', '活跃'],
                  ['archived', '归档'],
                  ['all', '全部'],
                ] as const).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setSessionFilter(key)}
                    className={`rounded-md px-2 py-1 text-[11px] font-medium transition-all ${
                      sessionFilter === key
                        ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100'
                        : 'text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <button
                onClick={() => setShowAgentDropdown(v => !v)}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-zinc-50 text-zinc-500 transition-all hover:bg-zinc-900 hover:text-white dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-100 dark:hover:text-zinc-900"
                title="新建对话"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
              {/* Agent picker dropdown (compact, default) */}
              <AgentPickerDropdown
                open={showAgentDropdown}
                onClose={() => setShowAgentDropdown(false)}
                onSelect={handleNewSession}
                onExpand={() => { setShowAgentDropdown(false); setShowAgentModal(true); }}
                agents={filteredAgents}
                activeProjectKey={activeKey ?? undefined}
                recentAgentIds={recentAgentIds}
              />
              {/* Agent picker modal (expanded, triggered from dropdown) */}
              <AgentPickerModal
                open={showAgentModal}
                onClose={() => setShowAgentModal(false)}
                onSelect={handleNewSession}
                agents={filteredAgents}
                activeProjectKey={activeKey ?? undefined}
                recentAgentIds={recentAgentIds}
              />
            </div>
            <div className="px-5 pb-3">
              <div className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
                <Search className="h-4 w-4 shrink-0" />
                <input
                  value={sessionQuery}
                  onChange={(e) => setSessionQuery(e.target.value)}
                  placeholder="搜索会话、Agent 或标题"
                  className="w-full bg-transparent text-[12px] outline-none placeholder:text-zinc-400 dark:placeholder:text-zinc-500"
                />
              </div>
            </div>
            {/* Session list */}
            <div className="flex-1 overflow-y-auto px-3 pb-5">
              {visibleSessions.length === 0 ? (
                <div className="px-4 py-12 text-center text-xs text-zinc-400 dark:text-zinc-500">
                  <MessageSquare className="mx-auto mb-2 h-8 w-8 text-zinc-300 dark:text-zinc-600" />
                  <p>{sessionQuery ? '没有匹配的会话' : sessionFilter === 'archived' ? '暂无归档对话' : sessionFilter === 'all' ? '暂无对话' : '暂无活跃对话'}</p>
                  {!sessionQuery && sessionFilter === 'active' && <p className="mt-1">点击右上角 + 开始新对话</p>}
                </div>
              ) : (
                <div className="space-y-5">
                  {pinnedSession && (
                    <div className="space-y-2">
                      <div className="px-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-400 dark:text-zinc-500">
                        当前焦点
                      </div>
                      <SessionCard
                        key={pinnedSession.id}
                        session={pinnedSession}
                        isActive={activeSessionId === pinnedSession.id}
                        listClockNow={pinnedSession.isRunning ? listClockNow : undefined}
                        onClick={handleSessionClick}
                        onArchiveToggle={handleArchiveToggle}
                      />
                    </div>
                  )}

                  {recentGroups.map(group => (
                    <div key={group.label} className="space-y-2">
                      <div className="px-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-400 dark:text-zinc-500">
                        {group.label}
                      </div>
                      <div className="space-y-1">
                        {group.items.map(s => (
                          <SessionCard
                            key={s.id}
                            session={s}
                            isActive={activeSessionId === s.id}
                            listClockNow={s.isRunning ? listClockNow : undefined}
                            onClick={handleSessionClick}
                            onArchiveToggle={handleArchiveToggle}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          /* ── Agents tab ── */
          <div className="flex flex-1 flex-col overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4">
              <div className="text-[11px] font-bold uppercase tracking-widest text-zinc-400 dark:text-zinc-500">
                {filteredAgents.length > 0 ? `${filteredAgents.length} 个 Agent` : 'Agents'}
              </div>
              <div className="flex items-center gap-0.5">
                <button
                  onClick={handleImport}
                  className="rounded-lg p-1.5 text-zinc-400 transition-all hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
                  title="导入 .ppagent"
                >
                  <Upload className="h-4 w-4" />
                </button>
                <button
                  onClick={handleStartCreate}
                  className="rounded-lg p-1.5 text-zinc-400 transition-all hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
                  title="新建 Agent"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-2 pb-4 space-y-1">
              {filteredAgents.length === 0 ? (
                <div className="px-4 py-8 text-center text-xs text-zinc-400 dark:text-zinc-500">
                  暂无 Agent
                </div>
              ) : (
                filteredAgents.map(a => (
                  <div
                    key={a.id}
                    onClick={() => handleAgentClick(a)}
                    className={`group flex cursor-pointer items-center gap-3.5 rounded-xl border px-3 py-3.5 transition-all ${
                      activePanel?.type === 'agent' && activePanel.agentId === a.id
                        ? 'bg-zinc-50 border-zinc-100 shadow-sm dark:bg-zinc-800 dark:border-zinc-700'
                        : 'border-transparent hover:bg-zinc-50 hover:border-zinc-100 dark:hover:bg-zinc-800/50 dark:hover:border-zinc-700/50'
                    }`}
                  >
                    <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1 ${
                      activePanel?.type === 'agent' && activePanel.agentId === a.id
                        ? 'bg-white shadow-sm ring-zinc-200 dark:bg-zinc-700 dark:ring-zinc-600'
                        : 'bg-zinc-50 ring-zinc-100 dark:bg-zinc-800 dark:ring-zinc-700'
                    }`}>
                      <AgentIcon iconKey={a.icon} className="h-5 w-5 text-zinc-500 dark:text-zinc-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 truncate text-[13px] font-semibold text-zinc-900 dark:text-zinc-100">
                        <span className="truncate">{a.name}</span>
                        {a.builtIn && (
                          <span className="shrink-0 rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
                            内置
                          </span>
                        )}
                        {!a.projectKey && activeKey && (
                          <span className="shrink-0 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:bg-amber-900/30 dark:text-amber-400">
                            全局
                          </span>
                        )}
                      </div>
                      {a.description && (
                        <div className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">
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

      <div className="flex min-w-0 flex-1">
        {/* Center panel */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-white">
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
              projects={projects}
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
                  <button
                    onClick={() => handleExport(selectedAgent)}
                    className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 transition-colors dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
                    title="导出 .ppagent"
                  >
                    <Download className="h-4 w-4" />
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
                    projectKey={activeKey}
                    cachedAgents={agents}
                    cachedSettings={cachedSettings}
                    onSessionChange={(newSession) => {
                      if (newSession && selectedAgent) {
                        setAllSessions(prev => {
                          const existing = prev.find(s => s.id === newSession.id);
                          if (existing) {
                            return prev.map(s => s.id === newSession.id
                              ? {
                                  ...s,
                                  title: newSession.title,
                                  updatedAt: newSession.updatedAt,
                                  ...(newSession.isRunning !== undefined && {
                                    isRunning: newSession.isRunning,
                                    runningStartedAt: newSession.runningStartedAt,
                                  }),
                                  ...(newSession.unreadCount !== undefined && {
                                    unreadCount: newSession.unreadCount,
                                  }),
                                }
                              : s);
                          }
                          return [{
                            id: newSession.id,
                            title: newSession.title,
                            updatedAt: newSession.updatedAt,
                            agentId: selectedAgent.id,
                            agentName: selectedAgent.name,
                            agentIcon: selectedAgent.icon,
                            isRunning: newSession.isRunning,
                            runningStartedAt: newSession.runningStartedAt,
                            unreadCount: newSession.unreadCount,
                          }, ...prev];
                        });
                      }
                      // Don't fetch on every streaming tick – only fetch on real content changes
                      if (!newSession || newSession.isRunning !== true) {
                        fetchAllSessions();
                      }
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
                  selectedId={selectedAgentId}
                  onExpandPrompt={() => setExpandedPrompt(true)}
                  projects={projects}
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
                  <button
                    onClick={() => {
                      window.dispatchEvent(new CustomEvent('toggle-session-compress', { detail: { sessionId: activeOpened?.sessionId } }));
                    }}
                    className="shrink-0 rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-blue-500 transition-colors dark:hover:bg-zinc-800 dark:hover:text-blue-400"
                    title="压缩会话历史"
                  >
                    <FileDown className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => {
                      window.dispatchEvent(new CustomEvent('toggle-session-config'));
                    }}
                    className="shrink-0 rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 transition-colors dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
                    title="会话配置"
                  >
                    <Settings className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => {
                      window.dispatchEvent(new CustomEvent('toggle-folder-explorer'));
                    }}
                    className="shrink-0 rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 transition-colors dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
                    title="打开本地文件夹"
                  >
                    <FolderOpen className="h-3.5 w-3.5" />
                  </button>
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
                      projectKey={activeKey}
                      cachedAgents={agents}
                      cachedSettings={cachedSettings}
                      onSessionChange={(newSession) => {
                        // Update the opened session's sessionId (new session or branch switch)
                        if (newSession && os.sessionId !== newSession.id) {
                          setOpenedSessions(prev =>
                            prev.map(p => p.key === os.key ? { ...p, sessionId: newSession.id } : p),
                          );
                          syncUrlParams({ session: newSession.id });
                        }
                        // Optimistically insert/update session in sidebar list
                        if (newSession) {
                          setAllSessions(prev => {
                            const existing = prev.find(s => s.id === newSession.id);
                            if (existing) {
                              return prev.map(s => s.id === newSession.id
                                ? {
                                    ...s,
                                    title: newSession.title,
                                    updatedAt: newSession.updatedAt,
                                    ...(newSession.isRunning !== undefined && {
                                      isRunning: newSession.isRunning,
                                      runningStartedAt: newSession.runningStartedAt,
                                    }),
                                  }
                                : s);
                            }
                            return [{
                              id: newSession.id,
                              title: newSession.title,
                              updatedAt: newSession.updatedAt,
                              agentId: os.agentId,
                              agentName: agent.name,
                              agentIcon: agent.icon,
                              isRunning: newSession.isRunning,
                              runningStartedAt: newSession.runningStartedAt,
                            }, ...prev];
                          });
                        }
                        // Mark as read if user is actively viewing this session
                        const sid = newSession?.id ?? os.sessionId;
                        if (sid) {
                          fetch(`/api/agent-chat/sessions/${sid}`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ action: 'markAsRead' }),
                          }).catch(() => {});
                        }
                        // Don't fetch on every streaming tick – only fetch on real content changes
                        if (!newSession || newSession.isRunning !== true) {
                          fetchAllSessions();
                        }
                      }}
                    />
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          /* ── Empty state ── */
          <div className="flex flex-1 flex-col overflow-hidden bg-zinc-50/30 dark:bg-zinc-950/50">
            <div className="flex h-full flex-col items-center justify-center p-12 text-center">
              <div className="relative mb-6">
                <div className="absolute -inset-4 rounded-full bg-zinc-100/50 blur-xl dark:bg-zinc-800/30" />
                <MessageSquare className="relative h-16 w-16 text-zinc-200 dark:text-zinc-600" />
              </div>
              <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-2">ProjectPilot Agents</h3>
              <p className="text-sm text-zinc-400 dark:text-zinc-500 max-w-xs leading-relaxed">
                选择左侧的一个对话继续，或者通过新建对话来让 AI 协助你完成项目任务。
              </p>
              <button
                onClick={() => { setSidebarTab('conversations'); setShowAgentDropdown(true); }}
                className="mt-8 flex items-center gap-2 rounded-xl bg-zinc-900 px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-zinc-200 transition-all hover:-translate-y-0.5 hover:shadow-zinc-300 dark:bg-zinc-100 dark:text-zinc-900 dark:shadow-zinc-800 dark:hover:bg-zinc-200"
              >
                <Plus className="h-4 w-4" />
                开启新对话
              </button>
            </div>
          </div>
        )}
        </div>

        {false && (
        <aside className="hidden w-[360px] shrink-0 border-l border-zinc-200 bg-[#fbfbfb] xl:flex xl:flex-col">
          <div className="flex items-start justify-between border-b border-zinc-200 px-5 py-4">
            <div className="min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-zinc-400">
                Inspector
              </div>
              <div className="mt-2 truncate text-[15px] font-semibold text-zinc-950">
                {workspaceAgent?.name ?? 'Agent Workspace'}
              </div>
              <div className="mt-1 flex items-center gap-2 text-[11px] text-zinc-500">
                <Command className="h-3.5 w-3.5" />
                <span className="truncate">{workspaceSessionId ?? 'session-runtime'}</span>
              </div>
            </div>
            <div className="flex items-center gap-1 text-zinc-400">
              <button className="rounded-lg p-2 transition-colors hover:bg-white hover:text-zinc-700" title="分享视图">
                <Share2 className="h-4 w-4" />
              </button>
              <button className="rounded-lg p-2 transition-colors hover:bg-white hover:text-zinc-700" title="通知">
                <Bell className="h-4 w-4" />
              </button>
              <button className="rounded-lg p-2 transition-colors hover:bg-white hover:text-zinc-700" title="更多操作">
                <MoreVertical className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
            <section className="space-y-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-zinc-400">
                Agent Workspace
              </div>
              <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
                <div className="flex items-start gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-600">
                    <AgentIcon iconKey={workspaceAgent?.icon} className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-zinc-950">{workspaceTitle}</div>
                    <div className="mt-1 text-[12px] text-zinc-500">
                      {workspaceAgent?.id ?? 'agent-builtin-self-dev'}
                    </div>
                    <div className="mt-3 inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
                      <Command className="h-3 w-3" />
                      {activeProject?.key ?? 'project-pilot'}
                    </div>
                  </div>
                </div>

                <div className="mt-4 space-y-3">
                  <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5">
                    <div className="flex items-center gap-2 text-[11px] font-medium text-zinc-600">
                      <FileJson className="h-3.5 w-3.5" />
                      Project Root
                    </div>
                    <div className="mt-1 text-[12px] text-zinc-900">{projectRootLabel}</div>
                    <div className="truncate text-[11px] text-zinc-500">{activeProject?.path ?? 'D:/Desktop/ProgrammingProjects/'}</div>
                  </div>
                  <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5">
                    <div className="flex items-center gap-2 text-[11px] font-medium text-zinc-600">
                      <FileText className="h-3.5 w-3.5" />
                      Runtime Context
                    </div>
                    <div className="mt-1 text-[12px] text-zinc-900">{runtimePromptLabel}</div>
                    <div className="truncate text-[11px] text-zinc-500">{runtimePromptPath}</div>
                  </div>
                </div>
              </div>
            </section>

            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-zinc-400">
                  Prompt Injection Stack
                </div>
                <div className="text-[11px] font-medium text-zinc-500">{formatTokenCount(combinedPromptTokens)}</div>
              </div>
              <div className="space-y-3">
                {promptStackItems.map((item) => (
                  <div key={item.scope} className="overflow-hidden rounded-2xl border border-zinc-200 bg-white">
                    <div className={`h-1 w-full ${item.line}`} />
                    <div className="space-y-3 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${item.accent}`}>
                            {item.scope}
                          </div>
                          <div className="mt-2 truncate text-[13px] font-semibold text-zinc-950">{item.label}</div>
                          <div className="mt-1 truncate text-[11px] text-zinc-500">{item.path}</div>
                        </div>
                        <div className="shrink-0 text-[11px] font-medium text-zinc-500">{formatTokenCount(item.tokens)}</div>
                      </div>
                      <div className="text-[12px] leading-5 text-zinc-600">
                        {item.description}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="space-y-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-zinc-400">
                System Capabilities
              </div>
              <div className="grid grid-cols-2 gap-3">
                {capabilityCards.map((item) => {
                  const Icon = item.icon;
                  return (
                    <div key={item.label} className="rounded-2xl border border-zinc-200 bg-white px-3 py-3">
                      <div className="flex items-center justify-between">
                        <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${item.enabled ? 'bg-zinc-100 text-zinc-700' : 'bg-zinc-50 text-zinc-300'}`}>
                          <Icon className="h-4 w-4" />
                        </div>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${item.enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-zinc-100 text-zinc-400'}`}>
                          {item.enabled ? 'On' : 'Off'}
                        </span>
                      </div>
                      <div className="mt-3 text-[12px] font-medium text-zinc-800">{item.label}</div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="rounded-2xl border border-zinc-200 bg-white p-4">
              <div className="flex items-center justify-between text-[11px] font-medium text-zinc-500">
                <span>Prompt Budget</span>
                <span>{promptUsagePercent}% of 128k</span>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-100">
                <div className="h-full rounded-full bg-zinc-900" style={{ width: `${promptUsagePercent}%` }} />
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-[11px] text-zinc-500">
                <div>
                  <div className="text-zinc-400">Global</div>
                  <div className="mt-1 font-medium text-zinc-800">{formatTokenCount(promptMetrics.global)}</div>
                </div>
                <div>
                  <div className="text-zinc-400">Project</div>
                  <div className="mt-1 font-medium text-zinc-800">{formatTokenCount(promptMetrics.project)}</div>
                </div>
                <div>
                  <div className="text-zinc-400">Agent</div>
                  <div className="mt-1 font-medium text-zinc-800">{formatTokenCount(agentPromptTokens)}</div>
                </div>
              </div>
            </section>
          </div>
        </aside>
        )}

        <aside className="hidden w-[320px] shrink-0 border-l border-[#e7dfd0] bg-[#fcfaf5] shadow-[0_18px_48px_rgba(15,23,42,0.08)] xl:flex xl:flex-col dark:border-zinc-800 dark:bg-zinc-950">
          <div className="flex h-full flex-col">
            <section className="flex h-[52%] min-h-0 flex-col border-b border-[#e7dfd0] bg-[#f8f3e8] dark:border-zinc-800 dark:bg-zinc-900">
              <div className="flex h-11 items-center justify-between border-b border-[#e7dfd0] px-4 dark:border-zinc-800">
                <div className="flex items-center gap-2">
                  <FolderOpen className="h-4 w-4 text-[#5f5a4f] dark:text-zinc-300" />
                  <h2 className="text-[13px] font-bold tracking-tight text-zinc-900 dark:text-zinc-100">项目工作区</h2>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (!workspaceAgent) return;
                    setCreating(false);
                    setSelectedAgentId(workspaceAgent.id);
                    setForm(agentToForm(workspaceAgent));
                    setExpandedPrompt(false);
                    setActivePanel({ type: 'agent', agentId: workspaceAgent.id, mode: 'settings' });
                    syncUrlParams({ agent: workspaceAgent.id, session: workspaceSessionId });
                  }}
                  className="flex items-center gap-1.5 text-[#7f7461] transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                  title="打开 Agent 设置"
                >
                  <Settings className="h-4 w-4" />
                  <span className="text-[12px] font-medium">设置</span>
                </button>
              </div>

              <div className="min-h-0 flex-1">
                {activeProject?.path ? (
                  <FolderExplorerPanel
                    embedded
                    onClose={() => {}}
                    initialPath={activeProject.path}
                  />
                ) : (
                  <div className="flex h-full items-center justify-center px-6 text-center text-[12px] text-zinc-500 dark:text-zinc-400">
                    选择项目后，这里会显示当前项目的文件结构。
                  </div>
                )}
              </div>
            </section>

            <section className="flex h-[48%] min-h-0 flex-col bg-[#fcfbf8] dark:bg-zinc-950">
              <AgentSessionPromptStack
                key={promptStackItems.map((item) => `${item.scope}:${item.label}:${item.path}`).join('|')}
                items={promptStackItems}
              />
            </section>
          </div>
        </aside>
      </div>
    </div>
  );
}
