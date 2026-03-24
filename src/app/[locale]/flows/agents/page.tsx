'use client';

import { useState, useEffect, useCallback, useMemo, useRef, memo } from 'react';
import { useTranslations } from 'next-intl';
import {
  Plus, Trash2, X, Minimize2,
  MessageSquare, Archive, ArchiveRestore,
  Settings,
  Download, Upload, Search, Folder, FolderOpen,
  Command, Terminal, Globe,
  Files, GitBranch, Eye, Database, ListTodo, HardDrive,
  FileText, FileJson,
} from 'lucide-react';
import dynamic from 'next/dynamic';
import type { Agent, ProviderId, OpenAIReasoningEffort } from '@/types';
import { DEFAULT_AGENT_CAPABILITIES } from '@/types';
import { FolderExplorerPanel } from '@/components/folder-explorer-panel';
import { AgentSessionPromptStack, type PromptStackSeedItem } from '@/components/agent-session-prompt-stack';

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
import { type AllSessionItem, type OpenedSession, syncUrlParams } from '@/components/agent-session-utils';
import { useProject } from '@/components/project-context';
import { getProviderPreset } from '@/lib/provider-registry';
import { repairTextIfNeeded } from '@/lib/text-repair';


// ── Helpers ──

function formatSessionElapsed(startedAt: string | undefined, nowTs: number): string {
  if (!startedAt) return '0s';
  const diffSeconds = Math.max(0, Math.floor((nowTs - new Date(startedAt).getTime()) / 1000));
  if (diffSeconds < 60) return `${diffSeconds}s`;
  if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)}m`;
  return `${Math.floor(diffSeconds / 3600)}h`;
}

function formatSessionTimestamp(timestamp: string | undefined, nowTs: number, yesterdayLabel = 'Yesterday'): string {
  if (!timestamp) return '--';
  const diffSeconds = Math.max(0, Math.floor((nowTs - new Date(timestamp).getTime()) / 1000));
  if (diffSeconds < 60) return `${diffSeconds}s`;
  if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)}m`;
  if (diffSeconds < 86400) return `${Math.floor(diffSeconds / 3600)}h`;
  if (diffSeconds < 172800) return yesterdayLabel;
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

function displayText(value: string | undefined, fallback = '--'): string {
  return repairTextIfNeeded(value) ?? value ?? fallback;
}

// ── Session card (memo-ized to avoid re-render on listClockNow ticks) ──

interface SessionCardProps {
  session: AllSessionItem;
  isActive: boolean;
  listClockNow: number | undefined; // only passed when session.isRunning
  onClick: (session: AllSessionItem) => void;
  onArchiveToggle: (session: AllSessionItem, e: React.MouseEvent) => void;
  newSessionTitle: string;
  archivedLabel: string;
  archiveTitle: string;
  unarchiveTitle: string;
  yesterdayLabel: string;
}

const SessionCard = memo(function SessionCard({
  session: s,
  isActive,
  listClockNow,
  onClick,
  onArchiveToggle,
  newSessionTitle,
  archivedLabel,
  archiveTitle,
  unarchiveTitle,
  yesterdayLabel,
}: SessionCardProps) {
  const nowTs = listClockNow ?? 0;

  return (
    <div
      onClick={() => onClick(s)}
      className={`group/session relative flex cursor-pointer items-start gap-3 rounded-2xl border px-3.5 py-3 transition-all ${
        isActive
          ? 'border-border bg-card shadow-[0_12px_32px_rgba(15,23,42,0.06)] dark:shadow-none'
          : 'border-transparent bg-transparent hover:border-border/70 hover:bg-card/80'
      } ${s.archived ? 'opacity-45' : ''}`}
    >
      {isActive && (
        <div className="absolute inset-y-3 left-1.5 w-0.5 rounded-full bg-zinc-900 dark:bg-zinc-100" />
      )}
      <div className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ring-1 ${
        isActive ? 'bg-background shadow-sm ring-border' : 'bg-muted/70 ring-border/70'
      }`}>
        <AgentIcon iconKey={s.agentIcon} className={`h-5 w-5 ${s.archived ? 'text-zinc-300 dark:text-zinc-600' : 'text-zinc-500 dark:text-zinc-300'}`} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 flex items-start justify-between gap-3">
          <div className={`truncate text-[13px] ${s.archived ? 'font-medium text-zinc-400 dark:text-zinc-500' : 'font-semibold text-foreground'}`}>
            {displayText(s.title, newSessionTitle)}
          </div>
          <span className="shrink-0 pt-0.5 text-[10px] font-medium text-muted-foreground">
            {s.isRunning && listClockNow !== undefined
              ? formatSessionElapsed(s.runningStartedAt, listClockNow)
              : formatSessionTimestamp(s.updatedAt, nowTs, yesterdayLabel)}
          </span>
        </div>
        <div className={`truncate text-[11px] ${s.archived ? 'text-zinc-300 dark:text-zinc-600' : 'text-muted-foreground'}`}>
          {displayText(s.agentName, s.agentId)}
        </div>
        {s.archived && (
          <div className="mt-1 text-[10px] uppercase tracking-[0.14em] text-zinc-300 dark:text-zinc-600">
            {archivedLabel}
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
        className="shrink-0 rounded-lg p-1.5 text-zinc-400 opacity-0 transition-all hover:bg-muted hover:text-foreground group-hover/session:opacity-100 dark:text-zinc-500"
        title={s.archived ? unarchiveTitle : archiveTitle}
      >
        {s.archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
      </button>
    </div>
  );
});

// ── Main page ──

export default function AgentsPage() {
  const { projects, activeKey } = useProject();
  const t = useTranslations('agentsWorkspace');
  const tActions = useTranslations('actions');

  // ── Core data ──
  const [agents, setAgents] = useState<Agent[]>([]);
  const agentsRef = useRef<Agent[]>(agents);
  agentsRef.current = agents;
  const [allSessions, setAllSessions] = useState<AllSessionItem[]>([]);

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

  const [urlProjectKey, setUrlProjectKey] = useState<string | null>(null);

  useEffect(() => {
    setUrlProjectKey(new URLSearchParams(window.location.search).get('project'));
  }, []);

  // 实际使用的 projectKey：优先用 ProjectProvider 的值，挂载后再同步 URL 参数
  const effectiveProjectKey = activeKey ?? urlProjectKey;

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
          title: repairTextIfNeeded(s.title) ?? s.title,
          updatedAt: s.updatedAt,
          agentId: s.agentId,
          agentName: agent?.name ?? s.agentId ?? '已删除 Agent',
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
  const [listClockNow, setListClockNow] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (!hasRunningSession) return;
    setListClockNow(Date.now());
    const timer = setInterval(() => setListClockNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [hasRunningSession]);

  // ── Project-filtered agents（项目专属排前面，全局排后面）──
  const filteredAgents = useMemo(() => {
    if (!effectiveProjectKey) return agents;
    return agents
      .filter(a => !a.projectKey || a.projectKey === effectiveProjectKey)
      .sort((a, b) => {
        const aGlobal = a.projectKey ? 0 : 1;
        const bGlobal = b.projectKey ? 0 : 1;
        return aGlobal - bGlobal;
      });
  }, [agents, effectiveProjectKey]);

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

  const handleAgentSettingsClick = (agent: Agent) => {
    setCreating(false);
    setSelectedAgentId(agent.id);
    setForm(agentToForm(agent));
    setExpandedPrompt(false);
    setActivePanel({ type: 'agent', agentId: agent.id, mode: 'settings' });
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
    if (!confirm(t('agent.deleteConfirm', { name: agent?.name ?? id }))) return;
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
            ? t('agent.importSuccessWithContexts', { name: data.agent.name, count: data.contextsImported })
            : t('agent.importSuccess', { name: data.agent.name });
          alert(msg);
        } else {
          const err = await res.json();
          alert(t('agent.importErrorWithReason', { reason: err.error }));
        }
      } catch {
        alert(t('agent.importErrorInvalidFile'));
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

  const agentLookup = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents]);

  const resolvedSessions = useMemo(() => allSessions.map((session) => {
    const agent = agentLookup.get(session.agentId);
    if (!agent) return session;
    if (session.agentName === agent.name && session.agentIcon === agent.icon) return session;
    return {
      ...session,
      agentName: agent.name,
      agentIcon: agent.icon,
    };
  }), [allSessions, agentLookup]);

  const projectScopedSessions = useMemo(() => {
    if (!effectiveProjectKey) return resolvedSessions;
    return resolvedSessions.filter((session) => session.projectKey === effectiveProjectKey);
  }, [resolvedSessions, effectiveProjectKey]);

  const visibleSessions = useMemo(() => {
    const query = sessionQuery.trim().toLowerCase();
    if (!query) return projectScopedSessions;
    return projectScopedSessions.filter((session) => {
      const haystack = `${session.title} ${session.agentName}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [projectScopedSessions, sessionQuery]);

  useEffect(() => {
    if (agents.length === 0) return;
    setAllSessions(prev => prev.map((session) => {
      const agent = agentLookup.get(session.agentId);
      if (!agent) return session;
      if (session.agentName === agent.name && session.agentIcon === agent.icon) return session;
      return {
        ...session,
        agentName: agent.name,
        agentIcon: agent.icon,
      };
    }));
  }, [agents, agentLookup]);

  const activeSessionInfo = useMemo(() =>
    activeOpened?.sessionId ? resolvedSessions.find(s => s.id === activeOpened.sessionId) ?? null : null,
    [activeOpened, resolvedSessions]);

  const activeProject = useMemo(
    () => projects.find((project) => project.key === effectiveProjectKey) ?? null,
    [projects, effectiveProjectKey],
  );

  const fallbackWorkspaceAgent = filteredAgents.find((agent) => agent.id === 'agent-builtin-self-dev') ?? filteredAgents[0] ?? null;
  const workspaceAgent = selectedAgent ?? activeSessionAgent ?? fallbackWorkspaceAgent;
  const workspaceSessionId = activeSessionInfo?.id ?? activeOpened?.sessionId ?? null;
  const workspaceTitle = activeSessionInfo?.title ?? t('session.new');
  const workspaceDisplayTitle = repairTextIfNeeded(workspaceTitle) ?? workspaceTitle;
  const workspaceAgentCapabilities = workspaceAgent?.capabilities ?? DEFAULT_AGENT_CAPABILITIES;
  const workspaceAgentName = displayText(workspaceAgent?.name, t('workspace.defaultAgentName'));
  const workspaceAgentId = workspaceAgent?.id ?? 'agent-builtin-self-dev';
  const workspaceAgentDataDirName = workspaceAgent?.slug ?? workspaceAgentId;
  const workspaceAgentDataPath = `agents/data/${workspaceAgentDataDirName}`;
  const workspaceAgentDescription = displayText(
    workspaceAgent?.description,
    t('workspace.defaultAgentDescription', { agentName: workspaceAgentName }),
  );
  const projectRootLabel = `${getBaseName(activeProject?.path)}/`;
  const projectPromptLabel = effectiveProjectKey ? `${effectiveProjectKey}.md` : 'project-pilot.md';
  const projectPromptPath = effectiveProjectKey
    ? `~/.project-pilot/data/project-prompts/${effectiveProjectKey}.md`
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
  const promptStackItems: PromptStackSeedItem[] = [
    {
      scope: 'Global',
      accent: 'bg-blue-50 text-blue-700 border-blue-100',
      label: t('promptStack.items.global.label'),
      path: '~/.project-pilot/data/prompts/global.md',
      tokens: promptMetrics.global,
      description: t('promptStack.items.global.description'),
      target: 'global',
    },
    {
      scope: 'Project',
      accent: 'bg-amber-50 text-amber-700 border-amber-100',
      label: effectiveProjectKey
        ? t('promptStack.items.project.labelWithKey', { key: effectiveProjectKey })
        : t('promptStack.items.project.label'),
      path: projectPromptPath,
      tokens: promptMetrics.project,
      description: effectiveProjectKey
        ? t('promptStack.items.project.descriptionWithKey', { key: effectiveProjectKey })
        : t('promptStack.items.project.description'),
      target: 'project',
      projectKey: effectiveProjectKey ?? 'project-pilot',
    },
    {
      scope: 'Agent',
      accent: 'bg-emerald-50 text-emerald-700 border-emerald-100',
      label: workspaceAgentName,
      path: agentPromptPath,
      tokens: agentPromptTokens,
      description: workspaceAgent?.description || t('promptStack.items.agent.description'),
      target: 'agent',
      agentId: workspaceAgentId,
      content: workspaceAgent?.systemPrompt ?? '',
    },
    {
      scope: 'Session',
      accent: 'bg-zinc-100 text-zinc-700 border-zinc-200',
      label: workspaceSessionId
        ? t('promptStack.items.session.labelWithTitle', { title: workspaceTitle })
        : t('promptStack.items.session.label'),
      path: runtimePromptPath,
      tokens: null,
      description: workspaceSessionId
        ? t('promptStack.items.session.descriptionActive')
        : t('promptStack.items.session.description'),
      target: 'session',
      agentId: workspaceAgentId,
      sessionId: workspaceSessionId,
    },
  ];

  const workspaceTreeNodes = [
    {
      depth: 0,
      kind: 'folder',
      label: projectRootLabel,
      path: activeProject?.path ?? 'D:/Desktop/ProgrammingProjects/',
      detail: t('projectWorkspace.tree.root'),
    },
    {
      depth: 1,
      kind: 'folder',
      label: 'develop-static/',
      path: activeProject?.path ?? 'D:/Desktop/ProgrammingProjects/personal-projects/03-In-Development/project-pilot/develop-static/',
      detail: t('projectWorkspace.tree.worktree'),
    },
    {
      depth: 2,
      kind: 'folder',
      label: '.project-pilot/',
      path: '~/.project-pilot/',
      detail: t('projectWorkspace.tree.ppHome'),
    },
    {
      depth: 3,
      kind: 'folder',
      label: 'data/',
      path: '~/.project-pilot/data/',
      detail: t('projectWorkspace.tree.sharedData'),
    },
    {
      depth: 4,
      kind: 'folder',
      label: 'prompts/',
      path: '~/.project-pilot/data/prompts/',
      detail: t('projectWorkspace.tree.promptRoot'),
    },
    {
      depth: 5,
      kind: 'folder',
      label: 'agents/',
      path: '~/.project-pilot/data/prompts/agents/',
      detail: t('projectWorkspace.tree.agentPrompts'),
    },
    {
      depth: 6,
      kind: 'file',
      label: agentPromptLabel,
      path: agentPromptPath,
      detail: t('projectWorkspace.tree.active'),
    },
    {
      depth: 5,
      kind: 'file',
      label: 'global.md',
      path: '~/.project-pilot/data/prompts/global.md',
      detail: t('projectWorkspace.tree.global'),
    },
    {
      depth: 5,
      kind: 'file',
      label: projectPromptLabel,
      path: projectPromptPath,
      detail: t('projectWorkspace.tree.project'),
    },
    {
      depth: 3,
      kind: 'folder',
      label: 'runtime/',
      path: `~/.project-pilot/data/prompts/runtime/${workspaceAgentId}/`,
      detail: 'runtime',
    },
    {
      depth: 4,
      kind: 'folder',
      label: `${workspaceAgentId}/`,
      path: `~/.project-pilot/data/prompts/runtime/${workspaceAgentId}/`,
      detail: 'agent scope',
    },
    {
      depth: 5,
      kind: 'folder',
      label: workspaceSessionId ? `${workspaceSessionId}/` : '<session>/',
      path: workspaceSessionId
        ? `~/.project-pilot/data/prompts/runtime/${workspaceAgentId}/${workspaceSessionId}/`
        : `~/.project-pilot/data/prompts/runtime/${workspaceAgentId}/<session>/`,
      detail: 'active session',
    },
    {
      depth: 6,
      kind: 'file',
      label: runtimePromptLabel,
      path: runtimePromptPath,
      detail: 'runtime copy',
    },
    {
      depth: 6,
      kind: 'block',
      label: 'memory.snapshot.json',
      path: workspaceSessionId
        ? `~/.project-pilot/data/prompts/runtime/${workspaceAgentId}/${workspaceSessionId}/memory.snapshot.json`
        : '~/.project-pilot/data/prompts/runtime/<agent>/<session>/memory.snapshot.json',
      detail: 'memory',
    },
  ] as const;

  const promptTreeSections = [
    {
      scope: 'Global',
      accent: 'text-blue-700',
      summary: t('promptTree.global.summary'),
      file: {
        label: 'global.md',
        path: '~/.project-pilot/data/prompts/global.md',
        tokens: promptMetrics.global,
      },
      nodes: [
        { kind: 'folder', label: 'prompt-blocks/_global/', path: '~/.project-pilot/data/prompt-blocks/_global/' },
        { kind: 'block', label: 'safety-rules.block.md', path: '~/.project-pilot/data/prompt-blocks/_global/safety-rules.block.md' },
      ],
    },
    {
      scope: 'Project',
      accent: 'text-amber-700',
      summary: t('promptTree.project.summary'),
      file: {
        label: projectPromptLabel,
        path: projectPromptPath,
        tokens: promptMetrics.project,
      },
      nodes: [
        { kind: 'folder', label: `prompt-blocks/_projects/${effectiveProjectKey ?? 'project-pilot'}/`, path: `~/.project-pilot/data/prompt-blocks/_projects/${effectiveProjectKey ?? 'project-pilot'}/` },
        { kind: 'folder', label: `docs/${effectiveProjectKey ?? 'project-pilot'}/`, path: `~/.project-pilot/data/docs/${effectiveProjectKey ?? 'project-pilot'}/` },
        { kind: 'block', label: 'workspace-context.block.md', path: `~/.project-pilot/data/prompt-blocks/_projects/${effectiveProjectKey ?? 'project-pilot'}/workspace-context.block.md` },
      ],
    },
    {
      scope: 'Agent',
      accent: 'text-emerald-700',
      summary: t('promptTree.agent.summary'),
      file: {
        label: agentPromptLabel,
        path: agentPromptPath,
        tokens: agentPromptTokens,
      },
      nodes: [
        { kind: 'folder', label: `skills/_agents/${workspaceAgentId}/`, path: `~/.project-pilot/data/skills/_agents/${workspaceAgentId}/` },
        { kind: 'folder', label: `agent-data/${workspaceAgentId}/`, path: `~/.project-pilot/data/agent-data/${workspaceAgentId}/` },
        { kind: 'block', label: 'agent-capabilities.block.md', path: `~/.project-pilot/data/prompt-blocks/_agents/${workspaceAgentId}/agent-capabilities.block.md` },
        ...(workspaceSessionId
          ? [
            { kind: 'folder', label: `${workspaceSessionId}/`, path: `~/.project-pilot/data/prompts/runtime/${workspaceAgentId}/${workspaceSessionId}/` },
            { kind: 'block', label: 'memory.snapshot.json', path: `~/.project-pilot/data/prompts/runtime/${workspaceAgentId}/${workspaceSessionId}/memory.snapshot.json` },
          ]
          : [
            { kind: 'folder', label: 'runtime/<session>/', path: `~/.project-pilot/data/prompts/runtime/${workspaceAgentId}/<session>/` },
          ]),
      ],
    },
  ] as const;

  const capabilityCards = [
    { label: t('capabilities.terminal.label'), hint: t('capabilities.terminal.hint'), enabled: workspaceAgentCapabilities.bash, icon: Terminal },
    { label: t('capabilities.web.label'), hint: t('capabilities.web.hint'), enabled: workspaceAgentCapabilities.web, icon: Globe },
    { label: t('capabilities.files.label'), hint: t('capabilities.files.hint'), enabled: workspaceAgentCapabilities.fileAccess, icon: Files },
    { label: t('capabilities.subAgent.label'), hint: t('capabilities.subAgent.hint'), enabled: workspaceAgentCapabilities.subAgent, icon: GitBranch },
    { label: t('capabilities.todo.label'), hint: t('capabilities.todo.hint'), enabled: workspaceAgentCapabilities.todoRead, icon: ListTodo },
    { label: t('capabilities.data.label'), hint: t('capabilities.data.hint'), enabled: workspaceAgentCapabilities.dataStore, icon: HardDrive },
    { label: t('capabilities.promptPath.label'), hint: t('capabilities.promptPath.hint'), enabled: workspaceAgentCapabilities.exposePromptPath, icon: Eye },
    { label: t('capabilities.skipReview.label'), hint: t('capabilities.skipReview.hint'), enabled: workspaceAgentCapabilities.skipReview, icon: Database },
  ] as const;

  const inboxSummary = t('workspace.inboxSummary', { count: visibleSessions.length });
  const activeWorkspaceSession = activePanel?.type === 'session' ? activeOpened : null;
  const activeWorkspaceAgent = activeWorkspaceSession
    ? agents.find((agent) => agent.id === activeWorkspaceSession.agentId) ?? workspaceAgent
    : (selectedAgent ?? workspaceAgent);
  const activeWorkspacePanelKey = activeWorkspaceSession?.key ?? null;
  const activeWorkspaceSessionId = activeWorkspaceSession?.sessionId ?? null;

  const handleWorkspacePanelSessionChange = useCallback((
    agent: Agent,
    panelKey: number | null,
    previousSessionId: string | null,
    newSession?: {
      id: string;
      title: string;
      updatedAt: string;
      unreadCount?: number;
      isRunning?: boolean;
      runningStartedAt?: string;
    },
  ) => {
    if (newSession) {
      const repairedTitle = displayText(newSession.title, '新会话');
      setAllSessions(prev => {
        const existing = prev.find((session) => session.id === newSession.id);
        if (existing) {
          return prev.map((session) => session.id === newSession.id
            ? {
                ...session,
                title: repairedTitle,
                updatedAt: newSession.updatedAt,
                agentId: agent.id,
                agentName: displayText(agent.name, agent.id),
                agentIcon: agent.icon,
                ...(newSession.isRunning !== undefined && {
                  isRunning: newSession.isRunning,
                  runningStartedAt: newSession.runningStartedAt,
                }),
                ...(newSession.unreadCount !== undefined && {
                  unreadCount: newSession.unreadCount,
                }),
              }
            : session);
        }
        return [{
          id: newSession.id,
          title: repairedTitle,
          updatedAt: newSession.updatedAt,
          agentId: agent.id,
          agentName: displayText(agent.name, agent.id),
          agentIcon: agent.icon,
          isRunning: newSession.isRunning,
          runningStartedAt: newSession.runningStartedAt,
          unreadCount: newSession.unreadCount,
          projectKey: effectiveProjectKey ?? undefined,
        }, ...prev];
      });

      if (panelKey !== null) {
        if (previousSessionId !== newSession.id) {
          setOpenedSessions(prev =>
            prev.map((panel) => panel.key === panelKey ? { ...panel, sessionId: newSession.id } : panel),
          );
        }
        setActivePanel({ type: 'session', key: panelKey });
      } else {
        const existing = openedSessionsRef.current.find(
          (panel) => panel.sessionId === newSession.id && panel.agentId === agent.id,
        );
        if (existing) {
          setActivePanel({ type: 'session', key: existing.key });
        } else {
          const nextKey = nextKeyRef.current++;
          setOpenedSessions(prev => [...prev, { sessionId: newSession.id, agentId: agent.id, key: nextKey }]);
          setActivePanel({ type: 'session', key: nextKey });
        }
      }

      fetch(`/api/agent-chat/sessions/${newSession.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'markAsRead' }),
      }).catch(() => {});

      syncUrlParams({ agent: agent.id, session: newSession.id });
    }

    if (!newSession || newSession.isRunning !== true) {
      fetchAllSessions();
    }
  }, [effectiveProjectKey, fetchAllSessions]);

  return (
    <div className="flex h-full overflow-hidden bg-background text-foreground">
      <aside className="relative flex w-[356px] shrink-0 flex-col border-r border-border bg-muted/30">
        <div className="border-b border-border px-4 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                {t('workspace.label')}
              </div>
              <div className="mt-2 truncate text-[17px] font-semibold text-foreground">
                {activeProject?.name ?? activeProject?.key ?? t('workspace.defaultProjectName')}
              </div>
              <div className="mt-3 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex max-w-full items-center rounded-full border border-border bg-background px-2.5 py-1 text-[10px] font-medium text-foreground">
                    <span className="truncate">{workspaceAgentName}</span>
                  </span>
                  <span className="inline-flex items-center rounded-full border border-border bg-background px-2.5 py-1 text-[10px] font-medium text-muted-foreground">
                    {inboxSummary}
                  </span>
                </div>
                <div className="grid gap-2 text-[11px] text-muted-foreground sm:grid-cols-2">
                  <div className="rounded-xl border border-border bg-background px-3 py-2">
                    <div className="text-[10px] uppercase tracking-[0.14em] text-zinc-400">
                      {t('workspace.projectKeyLabel')}
                    </div>
                    <div className="mt-1 truncate text-foreground">
                      {activeProject?.key ?? 'project-pilot'}
                    </div>
                  </div>
                  <div className="rounded-xl border border-border bg-background px-3 py-2">
                    <div className="text-[10px] uppercase tracking-[0.14em] text-zinc-400">
                      {t('workspace.agentIdLabel')}
                    </div>
                    <div className="mt-1 truncate text-foreground">
                      {workspaceAgentId}
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <button
              onClick={() => setShowAgentDropdown(v => !v)}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-border bg-background text-foreground transition-colors hover:bg-card"
              title={t('workspace.newSession')}
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-4 flex h-10 items-center gap-2 rounded-2xl border border-border bg-background px-3 text-muted-foreground">
            <Search className="h-4 w-4 shrink-0" />
            <input
              value={sessionQuery}
              onChange={(e) => setSessionQuery(e.target.value)}
              placeholder={t('workspace.searchPlaceholder')}
              className="w-full bg-transparent text-[12px] text-foreground outline-none placeholder:text-muted-foreground"
            />
          </div>

          <AgentPickerDropdown
            open={showAgentDropdown}
            onClose={() => setShowAgentDropdown(false)}
            onSelect={handleNewSession}
            onExpand={() => { setShowAgentDropdown(false); setShowAgentModal(true); }}
            agents={filteredAgents}
            activeProjectKey={effectiveProjectKey ?? undefined}
            recentAgentIds={recentAgentIds}
          />
          <AgentPickerModal
            open={showAgentModal}
            onClose={() => setShowAgentModal(false)}
            onSelect={handleNewSession}
            agents={filteredAgents}
            activeProjectKey={effectiveProjectKey ?? undefined}
            recentAgentIds={recentAgentIds}
          />
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-3">
          {visibleSessions.length === 0 ? (
            <div className="rounded-[22px] border border-dashed border-border bg-card/70 px-5 py-10 text-center text-sm text-muted-foreground">
              <MessageSquare className="mx-auto mb-3 h-8 w-8 text-zinc-300 dark:text-zinc-600" />
              <p>{sessionQuery ? t('session.emptyFiltered') : t('session.emptyWithAgent', { agentName: workspaceAgentName })}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t('session.emptyHint')}</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {visibleSessions.map((session) => (
                <SessionCard
                  key={session.id}
                  session={session}
                  isActive={activeSessionId === session.id}
                  listClockNow={session.isRunning ? listClockNow : undefined}
                  onClick={handleSessionClick}
                  onArchiveToggle={handleArchiveToggle}
                  newSessionTitle={t('session.new')}
                  archivedLabel={t('session.archived')}
                  archiveTitle={tActions('archive')}
                  unarchiveTitle={tActions('unarchive')}
                  yesterdayLabel={t('session.yesterday')}
                />
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-border px-3 py-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => workspaceAgent && handleAgentSettingsClick(workspaceAgent)}
              className="flex-1 rounded-xl border border-border bg-card px-3 py-2 text-[12px] font-medium text-foreground transition-colors hover:bg-background"
            >
              {t('agent.settingsButton')}
            </button>
            <button
              onClick={() => setShowAgentDropdown(v => !v)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
              title={t('workspace.newSession')}
            >
              <Plus className="h-4 w-4" />
            </button>
            <button
              onClick={handleImport}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
              title={t('agent.importButton')}
            >
              <Upload className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1">
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[#fcfbf8] dark:bg-[#0f141b]">
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
        ) : activePanel?.type === 'agent' && selectedAgent && agentViewMode === 'settings' ? (
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
            <>
              <div className="flex items-start justify-between border-b border-zinc-200 px-6 py-4">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-600">
                    <AgentIcon iconKey={selectedAgent.icon} className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[15px] font-semibold text-zinc-950">{selectedAgent.name}</span>
                      {selectedAgent.builtIn && (
                        <span className="shrink-0 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
                          内置
                        </span>
                      )}
                    </div>
                    <div className="mt-1 truncate text-[12px] text-zinc-500">{selectedAgent.id}</div>
                    <div className="mt-2 text-[12px] text-zinc-600">
                      {selectedAgent.description || '当前 agent 的默认工作区入口。'}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
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
            </>
          )
        ) : (
          <div className="flex flex-1 flex-col overflow-hidden bg-[linear-gradient(180deg,#ffffff_0%,#faf8f3_100%)] dark:bg-[linear-gradient(180deg,#0f141b_0%,#111722_100%)]">
            {activeWorkspaceAgent ? (
              <div className="flex-1 overflow-hidden">
                <AgentChatPanel
                  key={`workspace-${activeWorkspaceAgent.id}-${activeWorkspaceSessionId ?? 'draft'}-${activeWorkspacePanelKey ?? 'root'}`}
                  agent={activeWorkspaceAgent}
                  initialSessionId={activeWorkspaceSessionId}
                  variant="full"
                  projectKey={effectiveProjectKey}
                  cachedAgents={agents}
                  cachedSettings={cachedSettings}
                  workspaceMode
                  onSessionChange={(newSession) => handleWorkspacePanelSessionChange(
                    activeWorkspaceAgent,
                    activeWorkspacePanelKey,
                    activeWorkspaceSessionId,
                    newSession,
                  )}
                />
              </div>
            ) : (
              <div className="flex h-full items-center justify-center px-8 text-sm text-zinc-500">
                暂无可用 Agent。
              </div>
            )}
          </div>
        )}
        </main>

        {false && (
        <aside className="hidden w-[360px] shrink-0 border-l border-zinc-200 bg-[#fbfbfb] xl:flex xl:flex-col">
          <div className="flex items-start justify-between border-b border-zinc-200 px-5 py-4">
            <div className="min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-zinc-400">
                Agent Workspace
              </div>
              <div className="mt-2 truncate text-[15px] font-semibold text-zinc-950 dark:text-zinc-100">
                {workspaceAgentName}
              </div>
              <div className="mt-1 flex items-center gap-2 text-[11px] text-zinc-500">
                <Command className="h-3.5 w-3.5" />
                <span className="truncate">{`workspace/${activeProject?.key ?? 'project-pilot'}`}</span>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => workspaceAgent && handleAgentSettingsClick(workspaceAgent)}
                className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-[12px] font-medium text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Agent 设置
              </button>
              <button
                onClick={handleStartCreate}
                className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-[12px] font-medium text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                新建 Agent
              </button>
              <button
                onClick={handleImport}
                className="rounded-md p-2 text-zinc-400 transition-colors hover:bg-white hover:text-zinc-700 dark:hover:bg-zinc-900 dark:hover:text-zinc-200"
                title="导入 Agent"
              >
                <Upload className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
            <section className="space-y-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-zinc-400">
                Agent Workspace
              </div>
              <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-[0_8px_24px_rgba(15,23,42,0.04)] dark:border-zinc-800 dark:bg-zinc-900/90 dark:shadow-none">
                <div className="flex items-start gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-200">
                    <AgentIcon iconKey={workspaceAgent?.icon} className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-zinc-950 dark:text-zinc-100">{workspaceDisplayTitle}</div>
                    <div className="mt-1 text-[12px] text-zinc-500">{workspaceAgentId}</div>
                    <div className="mt-3 inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500 dark:bg-zinc-800 dark:text-zinc-300">
                      <Command className="h-3 w-3" />
                      {activeProject?.key ?? 'project-pilot'}
                    </div>
                  </div>
                </div>

                <div className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50/80 px-3 py-3 dark:border-zinc-800 dark:bg-zinc-950/70">
                  <div className="mb-2 text-[11px] leading-5 text-zinc-500 dark:text-zinc-400">
                    {workspaceAgentDescription}
                  </div>
                  <div className="space-y-0.5 border-t border-zinc-200 pt-3 dark:border-zinc-800">
                    {workspaceTreeNodes.map((node) => (
                      <div
                        key={`${node.depth}-${node.path}`}
                        className="relative"
                        style={{ marginLeft: `${node.depth * 14}px` }}
                      >
                        {node.depth > 0 && (
                          <>
                            <div className="absolute bottom-1/2 left-0 top-[-10px] w-px bg-zinc-200 dark:bg-zinc-800" />
                            <div className="absolute left-0 top-1/2 h-px w-3 bg-zinc-200 dark:bg-zinc-800" />
                          </>
                        )}
                        <div className="rounded-md px-2 py-1.5 transition-colors hover:bg-white/70 dark:hover:bg-zinc-900/70">
                          <div className="flex items-center gap-2 text-[12px] font-medium text-zinc-800 dark:text-zinc-200">
                            {node.kind === 'folder' ? (
                              <FolderOpen className="h-3.5 w-3.5 text-zinc-400 dark:text-zinc-500" />
                            ) : node.kind === 'file' ? (
                              <FileText className="h-3.5 w-3.5 text-zinc-400 dark:text-zinc-500" />
                            ) : (
                              <FileJson className="h-3.5 w-3.5 text-zinc-400 dark:text-zinc-500" />
                            )}
                            <span className="truncate">{node.label}</span>
                            <span className="ml-auto rounded bg-zinc-100 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.12em] text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500">
                              {node.detail}
                            </span>
                          </div>
                          {node.kind !== 'folder' && (
                            <div className="truncate pl-5 text-[10px] text-zinc-500 dark:text-zinc-400">{node.path}</div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-zinc-400">
                  {t('promptStack.title')}
                </div>
                <div className="text-[11px] font-medium text-zinc-500">{formatTokenCount(combinedPromptTokens)}</div>
              </div>
              <div className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900/90">
                {promptTreeSections.map((section) => (
                  <div key={section.scope} className="space-y-2 border-b border-zinc-100 pb-3 last:border-b-0 last:pb-0 dark:border-zinc-800/80">
                    <div className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${section.accent}`}>
                      {t(`promptTree.scope.${section.scope.toLowerCase()}`)}
                    </div>
                    <div className="text-[11px] leading-5 text-zinc-500 dark:text-zinc-400">{section.summary}</div>
                    <div className="space-y-1 pl-4">
                      <div className="relative rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2.5 dark:border-zinc-800 dark:bg-zinc-950/70">
                        <div className="absolute bottom-1/2 left-[-16px] top-[-10px] w-px bg-zinc-200 dark:bg-zinc-800" />
                        <div className="absolute left-[-16px] top-1/2 h-px w-3 bg-zinc-200 dark:bg-zinc-800" />
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 text-[12px] font-semibold text-zinc-900 dark:text-zinc-100">
                              <span className="rounded bg-white px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-zinc-400 dark:bg-zinc-900 dark:text-zinc-500">{t('promptTree.mainBadge')}</span>
                              <span className="truncate">{section.file.label}</span>
                            </div>
                            <div className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">{section.file.path}</div>
                          </div>
                          <div className="shrink-0 text-[11px] font-medium text-zinc-500">{formatTokenCount(section.file.tokens)}</div>
                        </div>
                      </div>
                      {section.nodes.map((node) => (
                        <div key={node.path} className="relative rounded-md px-3 py-1.5 dark:bg-zinc-950/20">
                          <div className="absolute bottom-1/2 left-[-16px] top-[-10px] w-px bg-zinc-200 dark:bg-zinc-800" />
                          <div className="absolute left-[-16px] top-1/2 h-px w-3 bg-zinc-200 dark:bg-zinc-800" />
                          <div className="flex items-center gap-2 text-[12px] font-medium text-zinc-700 dark:text-zinc-200">
                            {node.kind === 'folder' ? (
                              <Folder className="h-3.5 w-3.5 text-zinc-400 dark:text-zinc-500" />
                            ) : node.kind === 'block' ? (
                              <FileJson className="h-3.5 w-3.5 text-zinc-400 dark:text-zinc-500" />
                            ) : (
                              <FileText className="h-3.5 w-3.5 text-zinc-400 dark:text-zinc-500" />
                            )}
                            <span className="truncate">{node.label}</span>
                            <span className="ml-auto rounded bg-zinc-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500">{t(`promptTree.kind.${node.kind}`)}</span>
                          </div>
                          <div className="truncate pl-5 text-[10px] text-zinc-500 dark:text-zinc-400">{node.path}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="space-y-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-zinc-400">
                {t('capabilities.title')}
              </div>
              <div className="rounded-2xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900/90">
                {capabilityCards.map((item) => {
                  const Icon = item.icon;
                  return (
                    <div key={item.label} className="flex items-center justify-between border-b border-zinc-100 px-1 py-2.5 last:border-b-0 dark:border-zinc-800">
                      <div className="flex items-center gap-2.5">
                        <div className={`flex h-7 w-7 items-center justify-center rounded-md ${item.enabled ? 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-100' : 'bg-zinc-50 text-zinc-300 dark:bg-zinc-900 dark:text-zinc-600'}`}>
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-[12px] font-medium text-zinc-800 dark:text-zinc-200">{item.label}</div>
                          <div className="mt-0.5 text-[10px] uppercase tracking-[0.12em] text-zinc-400 dark:text-zinc-500">{item.hint}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 text-[10px] text-zinc-500 dark:text-zinc-400">
                        <span className={`h-1.5 w-1.5 rounded-full ${item.enabled ? 'bg-zinc-700 dark:bg-zinc-200' : 'bg-zinc-300 dark:bg-zinc-600'}`} />
                        <span>{item.enabled ? t('capabilities.enabled') : t('capabilities.disabled')}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900/90">
              <div className="flex items-center justify-between text-[11px] font-medium text-zinc-500">
                <span>{t('budget.title')}</span>
                <span>{t('budget.usage', { percent: promptUsagePercent })}</span>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                <div className="h-full rounded-full bg-zinc-900" style={{ width: `${promptUsagePercent}%` }} />
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-[11px] text-zinc-500">
                <div>
                  <div className="text-zinc-400">{t('budget.global')}</div>
                  <div className="mt-1 font-medium text-zinc-800 dark:text-zinc-200">{formatTokenCount(promptMetrics.global)}</div>
                </div>
                <div>
                  <div className="text-zinc-400">{t('budget.project')}</div>
                  <div className="mt-1 font-medium text-zinc-800">{formatTokenCount(promptMetrics.project)}</div>
                </div>
                <div>
                  <div className="text-zinc-400">{t('budget.agent')}</div>
                  <div className="mt-1 font-medium text-zinc-800">{formatTokenCount(agentPromptTokens)}</div>
                </div>
              </div>
            </section>
          </div>
        </aside>
        )}

        <aside className="hidden w-[320px] shrink-0 border-l border-[#e7dfd0] bg-[#fcfaf5] shadow-[0_18px_48px_rgba(15,23,42,0.08)] xl:flex xl:flex-col dark:border-zinc-800 dark:bg-zinc-950">
          <div className="flex h-full min-h-0 flex-col">
            <section className="flex min-h-0 flex-[1.15] flex-col border-b border-[#e7dfd0] bg-[#f8f3e8] dark:border-zinc-800 dark:bg-zinc-900">
              <div className="flex h-11 items-center justify-between border-b border-[#e7dfd0] px-4 dark:border-zinc-800">
                <div className="flex items-center gap-2">
                  <FolderOpen className="h-4 w-4 text-[#5f5a4f] dark:text-zinc-300" />
                  <h2 className="text-[13px] font-bold tracking-tight text-zinc-900 dark:text-zinc-100">{t('projectWorkspace.title')}</h2>
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
                  title={t('agent.openSettings')}
                >
                  <Settings className="h-4 w-4" />
                  <span className="text-[12px] font-medium">{t('agent.settingsShort')}</span>
                </button>
              </div>

              <div className="min-h-0 flex-1">
                {workspaceAgentDataPath ? (
                  <FolderExplorerPanel
                    embedded
                    onClose={() => {}}
                    initialPath={workspaceAgentDataPath}
                    initialResolveMode="data"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center px-6 text-center text-[12px] text-zinc-500 dark:text-zinc-400">
                    {t('projectWorkspace.empty')}
                  </div>
                )}
              </div>
            </section>

            <section className="flex min-h-0 flex-[0.95] flex-col border-b border-[#e7dfd0] bg-[#fcfbf8] dark:border-zinc-800 dark:bg-zinc-950">
              <AgentSessionPromptStack
                key={promptStackItems.map((item) => `${item.scope}:${item.label}:${item.path}`).join('|')}
                items={promptStackItems}
              />
            </section>
            <section className="min-h-0 flex-[0.8] overflow-y-auto bg-[#fcfbf8] px-3 py-3 dark:bg-zinc-950">
              <div className="space-y-3">
                <div className="px-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-zinc-400">
                  {t('capabilities.title')}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {capabilityCards.map((item) => {
                    const Icon = item.icon;
                    return (
                      <div
                        key={item.label}
                        className={`flex items-center gap-2.5 rounded-2xl border px-3 py-2.5 ${
                          item.enabled
                            ? 'border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900/90'
                            : 'border-zinc-200/80 bg-zinc-50/80 dark:border-zinc-800 dark:bg-zinc-900/60'
                        }`}
                      >
                        <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-xl ${item.enabled ? 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-100' : 'bg-zinc-100 text-zinc-400 dark:bg-zinc-900 dark:text-zinc-500'}`}>
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate text-[12px] font-medium text-zinc-800 dark:text-zinc-200">{item.label}</span>
                            <span className="shrink-0 text-[9px] uppercase tracking-[0.12em] text-zinc-400 dark:text-zinc-500">{item.hint}</span>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center">
                          <span
                            className={`h-2 w-2 rounded-full ${item.enabled ? 'bg-zinc-700 dark:bg-zinc-200' : 'bg-zinc-300 dark:bg-zinc-600'}`}
                            aria-label={item.enabled ? t('capabilities.enabledAria', { label: item.label }) : t('capabilities.disabledAria', { label: item.label })}
                            title={item.enabled ? t('capabilities.enabled') : t('capabilities.disabled')}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>
          </div>
        </aside>
      </div>
    </div>
  );
}
