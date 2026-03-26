'use client';

import { useState, useEffect, useCallback, useMemo, useRef, memo } from 'react';
import { useTranslations } from '@/client/i18n/use-translations';
import {
  Plus, Trash2, X, Minimize2,
  MessageSquare, Archive, ArchiveRestore,
  Settings,
  Download, Upload, Search, Folder, FolderOpen,
  Bot, Command, Terminal, Globe,
  Files, GitBranch, Eye, Database, ListTodo, HardDrive,
  FileText, FileJson,
  Clock, History,
} from 'lucide-react';
import { lazy, Suspense } from 'react';
import type { Agent, AgentCapabilities, ProviderId, OpenAIReasoningEffort } from '@/types';
import { DEFAULT_AGENT_CAPABILITIES } from '@/types';
import { AgentsWorkspaceRail } from '@/components/agents-workspace-rail';
import { type PromptStackSeedItem } from '@/components/agent-session-prompt-stack';

const AgentChatPanelLazy = lazy(() =>
  import('@/components/agent-chat-panel').then(m => ({ default: m.AgentChatPanel }))
);
function AgentChatPanel(props: React.ComponentProps<typeof AgentChatPanelLazy>) {
  return (
    <Suspense fallback={
      <div className="flex-1 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-muted-foreground/30 border-t-primary" />
      </div>
    }>
      <AgentChatPanelLazy {...props} />
    </Suspense>
  );
}
import { AgentAvatar, SettingsForm, type FormData, emptyForm, agentToForm } from '@/components/agent-form';
import { AgentPickerDropdown } from '@/components/agent-picker-dropdown';
import { AgentPickerModal } from '@/components/agent-picker-modal';
import { type AllSessionItem, type OpenedSession, syncUrlParams } from '@/components/agent-session-utils';
import { useProject } from '@/components/project-context';
import { getProviderPreset } from '@/lib/provider-registry';
import { repairTextIfNeeded } from '@/lib/text-repair';
import { cn } from '@/lib/utils';


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

function displayText(value: string | undefined, fallback = '--'): string {
  return repairTextIfNeeded(value) ?? value ?? fallback;
}

/** Provider / model line for workspace header (avoid raw "— · —"). */
function formatAgentRuntimeCaption(
  agent: Agent,
  t: (key: string, values?: Record<string, unknown>) => string,
): string {
  const provider = agent.defaultProvider?.trim() ?? '';
  const model = agent.defaultModel?.trim() ?? '';
  if (!provider && !model) return t('workspace.modelFollowsGlobal');
  if (provider && !model) return t('workspace.runtimeProviderInheritModel', { provider });
  if (!provider && model) return model;
  return `${provider} · ${model}`;
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
      className={cn(
        'group/session relative flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 transition-colors',
        isActive
          ? 'bg-accent/80 ring-1 ring-border shadow-sm'
          : 'hover:bg-muted/60',
        s.archived && 'opacity-45',
      )}
    >
      <div
        className={cn(
          'h-10 w-10 shrink-0 overflow-hidden rounded-xl ring-1 ring-inset',
          isActive
            ? 'bg-primary/10 text-primary ring-primary/15'
            : 'bg-muted/80 text-muted-foreground ring-border/60',
        )}
      >
        <AgentAvatar slug={s.agentSlug} iconKey={s.agentIcon} className="h-full w-full object-cover" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 flex items-center justify-between">
          <span
            className={cn(
              'truncate text-[13px]',
              isActive ? 'font-semibold text-foreground' : s.archived ? 'font-medium text-muted-foreground/70' : 'font-medium text-foreground/90',
            )}
          >
            {displayText(s.agentName, s.agentId)}
          </span>
          <span className="shrink-0 text-[10px] font-medium text-muted-foreground">
            {s.isRunning && listClockNow !== undefined
              ? formatSessionElapsed(s.runningStartedAt, listClockNow)
              : formatSessionTimestamp(s.updatedAt, nowTs, yesterdayLabel)}
          </span>
        </div>
        <div className={cn('truncate text-[11px]', s.archived ? 'text-muted-foreground/50' : 'text-muted-foreground')}>
          {s.archived
            ? archivedLabel
            : displayText(s.title, newSessionTitle)}
        </div>
      </div>
      {!isActive && !!s.unreadCount && s.unreadCount > 0 && !s.archived && (
        <span className="flex h-4 min-w-[16px] shrink-0 items-center justify-center rounded-full bg-foreground px-1 text-[9px] font-bold text-background">
          {s.unreadCount > 99 ? '99+' : s.unreadCount}
        </span>
      )}
      <button
        type="button"
        onClick={(e) => onArchiveToggle(s, e)}
        className="shrink-0 rounded-lg p-1.5 text-muted-foreground opacity-0 transition-all hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover/session:opacity-100"
        title={s.archived ? unarchiveTitle : archiveTitle}
        aria-label={s.archived ? unarchiveTitle : archiveTitle}
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
  const tAgents = useTranslations('agents');
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
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const conversationStripRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!historyExpanded) return;
    const onPointerDown = (e: PointerEvent) => {
      const root = conversationStripRef.current;
      if (!root) return;
      const t = e.target;
      if (t instanceof Node && root.contains(t)) return;
      setHistoryExpanded(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [historyExpanded]);

  // ── New session agent picker (dropdown + modal) ──
  const [showAgentDropdown, setShowAgentDropdown] = useState(false);
  const [showAgentModal, setShowAgentModal] = useState(false);

  // ── Cached settings for child panels (fetched once, shared to all AgentChatPanel instances) ──
  type CachedSettings = {
    provider: ProviderId;
    model: string;
    modelOptions: Array<{ value: string; label: string }>;
    effort: OpenAIReasoningEffort;
    fastMode: boolean;
  };
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
        const VALID_EFFORTS: OpenAIReasoningEffort[] = ['minimal', 'low', 'medium', 'high', 'xhigh'];
        const effort: OpenAIReasoningEffort = (typeof claude.openaiReasoningEffort === 'string' && VALID_EFFORTS.includes(claude.openaiReasoningEffort)) ? claude.openaiReasoningEffort : 'xhigh';
        const fastMode = claude.openaiFastMode === true;
        setCachedSettings({ provider: loadedProvider, model, modelOptions, effort, fastMode });
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
          agentSlug: agent?.slug,
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
    setHistoryExpanded(false);
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
    setHistoryExpanded(false);
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
    setHistoryExpanded(false);
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
            defaultOpenAIReasoningEffort: form.defaultProvider === 'openai'
              ? (form.defaultOpenAIReasoningEffort || null)
              : null,
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
            defaultOpenAIReasoningEffort: form.defaultProvider === 'openai'
              ? (form.defaultOpenAIReasoningEffort || null)
              : null,
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
      || form.defaultOpenAIReasoningEffort !== (selectedAgent.defaultOpenAIReasoningEffort ?? '')
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
    if (
      session.agentName === agent.name
      && session.agentIcon === agent.icon
      && session.agentSlug === agent.slug
    ) return session;
    return {
      ...session,
      agentName: agent.name,
      agentSlug: agent.slug,
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
      if (
        session.agentName === agent.name
        && session.agentIcon === agent.icon
        && session.agentSlug === agent.slug
      ) return session;
      return {
        ...session,
        agentName: agent.name,
        agentSlug: agent.slug,
        agentIcon: agent.icon,
      };
    }));
  }, [agents, agentLookup]);

  const activeSessionInfo = useMemo(() =>
    activeOpened?.sessionId ? resolvedSessions.find(s => s.id === activeOpened.sessionId) ?? null : null,
    [activeOpened, resolvedSessions]);

  const fallbackWorkspaceAgent = filteredAgents.find((agent) => agent.id === 'agent-builtin-self-dev') ?? filteredAgents[0] ?? null;
  const workspaceAgent = selectedAgent ?? activeSessionAgent ?? fallbackWorkspaceAgent;
  const workspaceSessionId = activeSessionInfo?.id ?? activeOpened?.sessionId ?? null;
  const workspaceTitle = activeSessionInfo?.title ?? t('session.new');
  const workspaceDisplayTitle = repairTextIfNeeded(workspaceTitle) ?? workspaceTitle;
  const workspaceAgentCapabilities = workspaceAgent?.capabilities ?? DEFAULT_AGENT_CAPABILITIES;
  const workspaceAgentName = displayText(workspaceAgent?.name, t('workspace.defaultAgentName'));
  const workspaceAgentId = workspaceAgent?.id ?? 'agent-builtin-self-dev';

  const handleRailCapabilitiesUpdated = useCallback((next: AgentCapabilities) => {
    setAgents((prev) => prev.map((a) => (a.id === workspaceAgentId ? { ...a, capabilities: next } : a)));
    setForm((f) => (selectedAgentId === workspaceAgentId ? { ...f, capabilities: next } : f));
  }, [workspaceAgentId, selectedAgentId]);

  /** 与 ~/.project-pilot/agents/README.md 一致：agents/workspaces/<agentId>/ */
  const workspaceAgentDataPath = `agents/workspaces/${workspaceAgentId}`;
  const workspaceAgentDescription = displayText(
    workspaceAgent?.description,
    t('workspace.defaultAgentDescription', { agentName: workspaceAgentName }),
  );
  const projectPromptLabel = effectiveProjectKey ? `${effectiveProjectKey}.md` : 'project-pilot.md';
  const projectPromptPath = effectiveProjectKey
    ? `~/.project-pilot/prompts/projects/${effectiveProjectKey}.md`
    : '~/.project-pilot/prompts/projects/project-pilot.md';
  const agentPromptLabel = workspaceAgent
    ? `${workspaceAgent.id}.md`
    : 'agent-builtin-self-dev.md';
  const agentPromptPath = workspaceAgent
    ? `~/.project-pilot/prompts/agents/${workspaceAgent.id}.md`
    : '~/.project-pilot/prompts/agents/agent-builtin-self-dev.md';
  const runtimePromptLabel = workspaceSessionId && workspaceAgent
    ? `${workspaceSessionId}.md`
    : 'session-runtime.md';
  const runtimePromptPath = workspaceSessionId && workspaceAgent
    ? `~/.project-pilot/prompts/runtime/${workspaceAgent.id}/${workspaceSessionId}.md`
    : '~/.project-pilot/prompts/runtime/<agent>/<session>.md';
  const agentPromptTokens = estimateTokenCount(workspaceAgent?.systemPrompt);
  const combinedPromptTokens = (promptMetrics.global ?? 0) + (promptMetrics.project ?? 0) + agentPromptTokens;
  const promptUsagePercent = Math.min(100, Math.round((combinedPromptTokens / 128000) * 100));
  const promptStackItems: PromptStackSeedItem[] = [
    {
      scope: 'Global',
      accent: 'bg-blue-50 text-blue-700 border-blue-100',
      label: t('promptStack.items.global.label'),
      path: '~/.project-pilot/prompts/global.md',
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
      label: `agents/workspaces/${workspaceAgentId}/`,
      path: `~/.project-pilot/agents/workspaces/${workspaceAgentId}/`,
      detail: t('projectWorkspace.tree.agentWorkspaceRoot'),
    },
    {
      depth: 1,
      kind: 'folder',
      label: '.project-pilot/',
      path: '~/.project-pilot/',
      detail: t('projectWorkspace.tree.ppHome'),
    },
    {
      depth: 2,
      kind: 'folder',
      label: 'prompts/',
      path: '~/.project-pilot/prompts/',
      detail: t('projectWorkspace.tree.promptRoot'),
    },
    {
      depth: 3,
      kind: 'folder',
      label: 'agents/',
      path: '~/.project-pilot/prompts/agents/',
      detail: t('projectWorkspace.tree.agentPrompts'),
    },
    {
      depth: 4,
      kind: 'file',
      label: agentPromptLabel,
      path: agentPromptPath,
      detail: t('projectWorkspace.tree.active'),
    },
    {
      depth: 3,
      kind: 'file',
      label: 'global.md',
      path: '~/.project-pilot/prompts/global.md',
      detail: t('projectWorkspace.tree.global'),
    },
    {
      depth: 3,
      kind: 'file',
      label: projectPromptLabel,
      path: projectPromptPath,
      detail: t('projectWorkspace.tree.project'),
    },
    {
      depth: 2,
      kind: 'folder',
      label: 'runtime/',
      path: `~/.project-pilot/prompts/runtime/${workspaceAgentId}/`,
      detail: 'runtime',
    },
    {
      depth: 3,
      kind: 'folder',
      label: `${workspaceAgentId}/`,
      path: `~/.project-pilot/prompts/runtime/${workspaceAgentId}/`,
      detail: 'agent scope',
    },
    {
      depth: 4,
      kind: 'folder',
      label: workspaceSessionId ? `${workspaceSessionId}/` : '<session>/',
      path: workspaceSessionId
        ? `~/.project-pilot/prompts/runtime/${workspaceAgentId}/${workspaceSessionId}/`
        : `~/.project-pilot/prompts/runtime/${workspaceAgentId}/<session>/`,
      detail: 'active session',
    },
    {
      depth: 5,
      kind: 'file',
      label: runtimePromptLabel,
      path: runtimePromptPath,
      detail: 'runtime copy',
    },
    {
      depth: 5,
      kind: 'block',
      label: 'memory.snapshot.json',
      path: workspaceSessionId
        ? `~/.project-pilot/prompts/runtime/${workspaceAgentId}/${workspaceSessionId}/memory.snapshot.json`
        : '~/.project-pilot/prompts/runtime/<agent>/<session>/memory.snapshot.json',
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
        path: '~/.project-pilot/prompts/global.md',
        tokens: promptMetrics.global,
      },
      nodes: [
        { kind: 'folder', label: 'blocks/', path: '~/.project-pilot/prompts/blocks/' },
        { kind: 'block', label: 'safety-rules.block.md', path: '~/.project-pilot/prompts/blocks/safety-rules.block.md' },
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
        { kind: 'folder', label: `projects/${effectiveProjectKey ?? 'project-pilot'}.d/`, path: `~/.project-pilot/prompts/projects/${effectiveProjectKey ?? 'project-pilot'}.d/` },
        { kind: 'folder', label: `docs/${effectiveProjectKey ?? 'project-pilot'}/`, path: `~/.project-pilot/knowledge/design-docs/${effectiveProjectKey ?? 'project-pilot'}/` },
        { kind: 'block', label: 'workspace-context.block.md', path: `~/.project-pilot/prompts/projects/${effectiveProjectKey ?? 'project-pilot'}.d/workspace-context.block.md` },
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
        { kind: 'folder', label: `skills/_agents/${workspaceAgentId}/`, path: `~/.project-pilot/skills/_agents/${workspaceAgentId}/` },
        { kind: 'folder', label: `workspaces/${workspaceAgentId}/`, path: `~/.project-pilot/agents/workspaces/${workspaceAgentId}/` },
        { kind: 'block', label: 'agent-capabilities.block.md', path: '~/.project-pilot/prompts/blocks/agent-capabilities.block.md' },
        ...(workspaceSessionId
          ? [
            { kind: 'folder', label: `${workspaceSessionId}/`, path: `~/.project-pilot/prompts/runtime/${workspaceAgentId}/${workspaceSessionId}/` },
            { kind: 'block', label: 'memory.snapshot.json', path: `~/.project-pilot/prompts/runtime/${workspaceAgentId}/${workspaceSessionId}/memory.snapshot.json` },
          ]
          : [
            { kind: 'folder', label: 'runtime/<session>/', path: `~/.project-pilot/prompts/runtime/${workspaceAgentId}/<session>/` },
          ]),
      ],
    },
  ] as const;

  const capabilityCards = [
    { label: t('capabilities.terminal.label'), hint: t('capabilities.terminal.hint'), icon: Terminal, capabilityKey: 'bash' as const },
    { label: t('capabilities.web.label'), hint: t('capabilities.web.hint'), icon: Globe, capabilityKey: 'web' as const },
    { label: t('capabilities.files.label'), hint: t('capabilities.files.hint'), icon: Files, capabilityKey: 'fileAccess' as const },
    { label: t('capabilities.subAgent.label'), hint: t('capabilities.subAgent.hint'), icon: GitBranch, capabilityKey: 'subAgent' as const },
    { label: t('capabilities.todo.label'), hint: t('capabilities.todo.hint'), icon: ListTodo, capabilityKey: 'todoRead' as const },
    { label: t('capabilities.data.label'), hint: t('capabilities.data.hint'), icon: HardDrive, capabilityKey: 'dataStore' as const },
    { label: t('capabilities.promptPath.label'), hint: t('capabilities.promptPath.hint'), icon: Eye, capabilityKey: 'exposePromptPath' as const },
    { label: t('capabilities.skipReview.label'), hint: t('capabilities.skipReview.hint'), icon: Database, capabilityKey: 'skipReview' as const },
  ] as const;

  const inboxSummary = t('workspace.inboxSummary', { count: visibleSessions.length });
  const activeWorkspaceSession = activePanel?.type === 'session' ? activeOpened : null;
  const activeWorkspaceAgent = activeWorkspaceSession
    ? agents.find((agent) => agent.id === activeWorkspaceSession.agentId) ?? workspaceAgent
    : (selectedAgent ?? workspaceAgent);
  const activeWorkspacePanelKey = activeWorkspaceSession?.key ?? null;
  const activeWorkspaceSessionId = activeWorkspaceSession?.sessionId ?? null;

  const currentAgentSessions = useMemo(() => {
    if (!activeWorkspaceAgent) return [];
    return allSessions.filter(s => s.agentId === activeWorkspaceAgent.id && !s.archived);
  }, [allSessions, activeWorkspaceAgent]);
  const currentAgentRunningSession = useMemo(() => currentAgentSessions.find(s => s.isRunning) ?? null, [currentAgentSessions]);
  const currentAgentHistorySessions = useMemo(() => currentAgentSessions.filter(s => !s.isRunning), [currentAgentSessions]);
  const isDraftSession = activePanel?.type === 'session' && activeWorkspaceSessionId === null;
  const activeExistingSession = useMemo(
    () => activeWorkspaceSessionId ? currentAgentSessions.find(s => s.id === activeWorkspaceSessionId) ?? null : null,
    [activeWorkspaceSessionId, currentAgentSessions],
  );
  const currentAgentRunningSessionId = currentAgentRunningSession?.id ?? null;

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
                agentSlug: agent.slug,
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
          agentSlug: agent.slug,
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
      <aside className="relative flex w-[292px] shrink-0 flex-col border-r border-border bg-muted/20">
        <div className="border-b border-border/80 bg-card/40 px-4 pb-3 pt-4 backdrop-blur-sm">
          <div className="mb-3 flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-start gap-2.5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/15">
                <Bot className="h-4 w-4" aria-hidden />
              </span>
              <div className="min-w-0 pt-0.5">
                <h2 className="truncate text-sm font-semibold tracking-tight text-foreground">
                  {tAgents('title')}
                </h2>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {t('workspace.label')}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              <button
                type="button"
                onClick={handleImport}
                className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                title={t('agent.importButton')}
                aria-label={t('agent.importButton')}
              >
                <Upload className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={handleStartCreate}
                className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                title={t('agent.createButton')}
                aria-label={t('agent.createButton')}
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
          </div>
          <label className="sr-only" htmlFor="agents-sidebar-search">
            {t('workspace.searchPlaceholder')}
          </label>
          <div className="flex items-center gap-2 rounded-lg border border-input bg-background px-3 py-2 shadow-sm transition-shadow focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <input
              id="agents-sidebar-search"
              value={sessionQuery}
              onChange={(e) => setSessionQuery(e.target.value)}
              placeholder={t('workspace.searchPlaceholder')}
              className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-2">
          {filteredAgents.filter(a => !sessionQuery || a.name.toLowerCase().includes(sessionQuery.toLowerCase()) || a.id.toLowerCase().includes(sessionQuery.toLowerCase())).length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-muted/30 px-4 py-12 text-center">
              <MessageSquare className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50" aria-hidden />
              <p className="text-sm text-muted-foreground">
                {sessionQuery ? t('session.emptyFiltered') : t('picker.empty')}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {filteredAgents
                .filter(a => !sessionQuery || a.name.toLowerCase().includes(sessionQuery.toLowerCase()) || a.id.toLowerCase().includes(sessionQuery.toLowerCase()))
                .map((agent) => {
                  const isActive = activeWorkspaceAgent?.id === agent.id;
                  const agentSessions = allSessions.filter(s => s.agentId === agent.id && !s.archived);
                  const lastSession = agentSessions[0];
                  const totalUnread = agentSessions.reduce((sum, s) => sum + (s.unreadCount || 0), 0);
                  const hasRunning = agentSessions.some(s => s.isRunning);
                  return (
                    <div
                      key={agent.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => handleAgentClick(agent)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleAgentClick(agent);
                        }
                      }}
                      className={cn(
                        'group/agent flex cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2.5 transition-colors',
                        isActive
                          ? 'bg-card shadow-sm ring-1 ring-border'
                          : 'hover:bg-muted/70',
                      )}
                    >
                      <div
                        className={cn(
                          'h-10 w-10 shrink-0 overflow-hidden rounded-xl ring-1 ring-inset',
                          isActive
                            ? 'bg-primary/10 text-primary ring-primary/15'
                            : 'bg-muted/80 text-muted-foreground ring-border/60',
                        )}
                      >
                        <AgentAvatar slug={agent.slug} iconKey={agent.icon} className="h-full w-full object-cover" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="mb-0.5 flex items-center justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-1.5">
                            <span
                              className={cn(
                                'truncate text-sm',
                                isActive ? 'font-semibold text-foreground' : 'font-medium text-foreground/90',
                              )}
                            >
                              {agent.name}
                            </span>
                            {agent.builtIn && (
                              <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                                {t('agent.builtInBadge')}
                              </span>
                            )}
                          </div>
                          {lastSession && (
                            <span className="shrink-0 text-[10px] font-medium tabular-nums text-muted-foreground">
                              {formatSessionTimestamp(lastSession.updatedAt, Date.now(), t('session.yesterday'))}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          {hasRunning && (
                            <span
                              className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500 animate-pulse"
                              aria-hidden
                            />
                          )}
                          <span className="truncate">
                            {lastSession
                              ? displayText(lastSession.title, agent.description || agent.id)
                              : (agent.description || agent.id)}
                          </span>
                        </div>
                      </div>
                      {totalUnread > 0 && !isActive && (
                        <span className="flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">
                          {totalUnread > 99 ? '99+' : totalUnread}
                        </span>
                      )}
                      {agentSessions.length > 0 && (
                        <span className="shrink-0 rounded-md bg-muted/80 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground opacity-0 transition-opacity group-hover/agent:opacity-100">
                          {agentSessions.length}
                        </span>
                      )}
                    </div>
                  );
                })}
            </div>
          )}
        </div>

      </aside>

      <div className="flex min-w-0 flex-1">
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-background">
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
              <div className="flex items-start justify-between gap-4 border-b border-border bg-card/50 px-6 py-5 backdrop-blur-sm">
                <div className="flex min-w-0 items-start gap-4">
                  <div className="h-12 w-12 shrink-0 overflow-hidden rounded-2xl bg-muted ring-1 ring-border">
                    <AgentAvatar slug={selectedAgent.slug} iconKey={selectedAgent.icon} className="h-full w-full object-cover" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-base font-semibold tracking-tight text-foreground">{selectedAgent.name}</span>
                      {selectedAgent.builtIn && (
                        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                          {t('agent.builtInBadge')}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 truncate font-mono text-xs text-muted-foreground">{selectedAgent.id}</div>
                    <div className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                      {selectedAgent.description || t('workspace.defaultAgentDescription', { agentName: selectedAgent.name })}
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => handleExport(selectedAgent)}
                    className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    title="导出 .ppagent"
                    aria-label="导出 .ppagent"
                  >
                    <Download className="h-4 w-4" />
                  </button>
                  {!selectedAgent.builtIn && (
                    <button
                      type="button"
                      onClick={() => handleDelete(selectedAgentId!)}
                      className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      title={tActions('delete')}
                      aria-label={tActions('delete')}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleClose}
                    className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    title={tActions('close')}
                    aria-label={tActions('close')}
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
          <div className="flex flex-1 flex-col overflow-hidden bg-linear-to-b from-background via-background to-muted/20">
            {activeWorkspaceAgent ? (
              <>
                {/* ── Top: row 1 = Agent & config, row 2 = conversation ── */}
                <div className="shrink-0 border-b border-border bg-card/30 px-4 py-3 backdrop-blur-sm sm:px-5">
                  <div className="mx-auto flex max-w-6xl flex-col gap-3">
                    {/* Row 1 — identity & configuration (not conversation) */}
                    <section
                      aria-label={t('workspace.rowAgentEyebrow')}
                      className="flex flex-col gap-3 rounded-xl border border-border/60 bg-background/80 p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                    >
                      <div className="flex min-w-0 flex-1 items-start gap-3">
                        <div className="h-11 w-11 shrink-0 overflow-hidden rounded-xl bg-muted ring-1 ring-border">
                          <AgentAvatar slug={activeWorkspaceAgent.slug} iconKey={activeWorkspaceAgent.icon} className="h-full w-full object-cover" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                            {t('workspace.rowAgentEyebrow')}
                          </p>
                          <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                            <span className="truncate text-base font-semibold tracking-tight text-foreground">
                              {activeWorkspaceAgent.name}
                            </span>
                            {activeWorkspaceAgent.builtIn ? (
                              <span className="shrink-0 rounded-md border border-border bg-muted/50 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                                {t('agent.builtInBadge')}
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                            {formatAgentRuntimeCaption(activeWorkspaceAgent, t)}
                          </p>
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border/60 pt-3 sm:border-t-0 sm:pt-0">
                        <button
                          type="button"
                          onClick={() => handleAgentSettingsClick(activeWorkspaceAgent)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-accent"
                        >
                          <Settings className="h-3.5 w-3.5" />
                          {t('workspace.configureAgent')}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleExport(activeWorkspaceAgent)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-accent"
                        >
                          <Download className="h-3.5 w-3.5" />
                          {t('workspace.exportPackage')}
                        </button>
                      </div>
                    </section>

                    {/* Row 2 — 对话上下文 + 新开 / 历史；加高、可点区域更大 */}
                    <section
                      ref={conversationStripRef}
                      aria-label={t('workspace.rowConversationEyebrow')}
                      className="relative rounded-lg border border-border/60 bg-background/80 shadow-sm"
                    >
                      <div className="flex flex-col gap-2.5 p-3 sm:flex-row sm:items-center sm:gap-3">
                        <div className="flex min-w-0 flex-1 flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
                          <span className="shrink-0 text-xs font-semibold tracking-tight text-foreground">
                            {t('workspace.rowConversationEyebrow')}
                          </span>
                          <div className="min-h-[44px] min-w-0 flex-1 rounded-lg border border-border/50 bg-muted/30 px-3 py-2 sm:min-h-0 sm:py-2.5">
                            {currentAgentRunningSession ? (
                              <button
                                type="button"
                                onClick={() => handleSessionClick(currentAgentRunningSession)}
                                title={displayText(currentAgentRunningSession.title, t('workspace.runningLabel'))}
                                className={cn(
                                  'flex w-full min-w-0 items-center gap-2.5 rounded-md text-left text-sm transition-colors',
                                  activeWorkspaceSessionId === currentAgentRunningSession.id
                                    ? 'text-foreground'
                                    : 'hover:bg-muted/60',
                                )}
                              >
                                <span className="relative flex h-2 w-2 shrink-0">
                                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                                </span>
                                <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                                  {displayText(currentAgentRunningSession.title, t('workspace.runningLabel'))}
                                </span>
                                <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
                                  {formatSessionElapsed(currentAgentRunningSession.runningStartedAt, listClockNow ?? Date.now())}
                                </span>
                              </button>
                            ) : isDraftSession ? (
                              <div
                                className="flex items-center gap-2 text-sm font-medium text-foreground"
                                title={t('workspace.draftSessionLabel')}
                              >
                                <MessageSquare className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                                <span className="min-w-0 truncate">{t('workspace.draftShort')}</span>
                                <span className="ml-auto hidden text-xs font-normal text-muted-foreground sm:inline">
                                  {t('workspace.sessionStateEmptyDetail')}
                                </span>
                              </div>
                            ) : !isDraftSession && activeExistingSession && activeExistingSession.id !== currentAgentRunningSessionId ? (
                              <button
                                type="button"
                                onClick={() => handleSessionClick(activeExistingSession)}
                                title={displayText(activeExistingSession.title, t('workspace.unnamedSession'))}
                                className="flex w-full min-w-0 items-center gap-2 text-left text-sm transition-colors hover:bg-muted/50"
                              >
                                <MessageSquare className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                                <span className="min-w-0 flex-1 truncate">
                                  <span className="text-muted-foreground">{t('workspace.currentSessionLabel')}</span>
                                  <span className="mx-1.5 text-muted-foreground/50">·</span>
                                  <span className="font-medium text-foreground">
                                    {displayText(activeExistingSession.title, t('workspace.unnamedSession'))}
                                  </span>
                                </span>
                                <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
                                  {formatSessionTimestamp(activeExistingSession.updatedAt, listClockNow ?? Date.now())}
                                </span>
                              </button>
                            ) : (
                              <p
                                className="text-sm leading-snug text-muted-foreground"
                                title={t('workspace.sessionStateEmptyDetail')}
                              >
                                <span className="font-medium text-foreground/80">{t('workspace.sessionStripIdleShort')}</span>
                                <span className="mt-0.5 block text-xs sm:mt-0 sm:ml-2 sm:inline">
                                  {t('workspace.sessionStateEmptyDetail')}
                                </span>
                              </p>
                            )}
                          </div>
                        </div>

                        <div className="flex shrink-0 flex-wrap items-center gap-2 sm:flex-nowrap sm:border-l sm:border-border/60 sm:pl-3">
                          <button
                            type="button"
                            onClick={() => handleNewSession(activeWorkspaceAgent)}
                            className="inline-flex min-h-10 min-w-0 flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition-opacity hover:opacity-90 sm:min-h-9 sm:flex-initial sm:px-3"
                            title={t('workspace.newConversation')}
                          >
                            <Plus className="h-4 w-4 shrink-0" aria-hidden />
                            <span className="truncate sm:hidden">{t('workspace.newConversationShort')}</span>
                            <span className="hidden truncate sm:inline">{t('workspace.newConversation')}</span>
                          </button>
                          {currentAgentHistorySessions.length > 0 ? (
                            <button
                              type="button"
                              onClick={() => setHistoryExpanded((prev) => !prev)}
                              aria-expanded={historyExpanded}
                              title={
                                historyExpanded
                                  ? t('workspace.collapseHistory')
                                  : t('workspace.historyChatsWithCount', { count: currentAgentHistorySessions.length })
                              }
                              className={cn(
                                'inline-flex min-h-10 min-w-[44px] flex-1 items-center justify-center gap-2 rounded-lg border border-border px-3 text-sm font-medium transition-colors sm:min-h-9 sm:flex-initial',
                                historyExpanded ? 'border-primary/30 bg-primary/10 text-foreground' : 'bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
                              )}
                            >
                              <History className="h-4 w-4 shrink-0" aria-hidden />
                              <span className="sm:hidden">
                                {t('workspace.historyShort')}
                                <span className="tabular-nums"> ({currentAgentHistorySessions.length})</span>
                              </span>
                              <span className="hidden items-center gap-1.5 sm:inline-flex">
                                <span className="tabular-nums">{currentAgentHistorySessions.length}</span>
                                <span className="text-muted-foreground">·</span>
                                <span className="max-w-24 truncate">{t('workspace.historySessionsLabel')}</span>
                              </span>
                            </button>
                          ) : null}
                        </div>
                      </div>

                      {historyExpanded && currentAgentHistorySessions.length > 0 ? (
                        <div className="absolute left-3 right-3 top-[calc(100%-0.25rem)] z-30 mt-0 overflow-hidden rounded-lg border border-border bg-popover shadow-lg">
                          <ul className="max-h-[min(280px,45vh)] space-y-0 overflow-y-auto p-1.5" role="list">
                            {currentAgentHistorySessions.map((session) => (
                              <li key={session.id}>
                                <button
                                  type="button"
                                  onClick={() => handleSessionClick(session)}
                                  className={cn(
                                    'flex min-h-10 w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors',
                                    activeWorkspaceSessionId === session.id
                                      ? 'bg-primary/10'
                                      : 'hover:bg-muted/70',
                                  )}
                                >
                                  <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                                  <span className="min-w-0 flex-1 truncate text-foreground">
                                    {displayText(session.title, t('workspace.unnamedSession'))}
                                  </span>
                                  <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
                                    {formatSessionTimestamp(session.updatedAt, listClockNow ?? Date.now())}
                                  </span>
                                </button>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </section>
                  </div>
                </div>

                {/* ── Bottom: Chat area (fixed height) ── */}
                <div className="min-h-0 flex-1" style={{ minHeight: 420 }}>
                  <AgentChatPanel
                    key={`workspace-${activeWorkspaceAgent.id}-${activeWorkspacePanelKey ?? 'root'}`}
                    agent={activeWorkspaceAgent}
                    initialSessionId={activeWorkspaceSessionId}
                    variant="full"
                    projectKey={effectiveProjectKey}
                    cachedAgents={agents}
                    cachedSettings={cachedSettings}
                    workspaceMode
                    draftCacheSlot={activeWorkspacePanelKey ?? 'root'}
                    onSessionChange={(newSession) => handleWorkspacePanelSessionChange(
                      activeWorkspaceAgent,
                      activeWorkspacePanelKey,
                      activeWorkspaceSessionId,
                      newSession,
                    )}
                  />
                </div>
              </>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                  <Bot className="h-7 w-7" />
                </div>
                <p className="max-w-sm text-sm text-muted-foreground">{t('workspace.noAgentsInWorkspace')}</p>
              </div>
            )}
          </div>
        )}
        </main>

        {false && (
        <aside className="w-[320px] shrink-0 border-l border-zinc-200 bg-[#fbfbfb] flex flex-col dark:border-zinc-800 dark:bg-zinc-950">
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
                <span className="truncate font-mono text-[11px]">{workspaceAgentDataPath}</span>
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
                  <div className="h-11 w-11 shrink-0 overflow-hidden rounded-2xl bg-zinc-100 dark:bg-zinc-800">
                    <AgentAvatar slug={workspaceAgent?.slug} iconKey={workspaceAgent?.icon} className="h-full w-full object-cover" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-zinc-950 dark:text-zinc-100">{workspaceDisplayTitle}</div>
                    <div className="mt-1 text-[12px] text-zinc-500">{workspaceAgentId}</div>
                    <div className="mt-3 inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500 dark:bg-zinc-800 dark:text-zinc-300">
                      <Command className="h-3 w-3" />
                      {workspaceAgentDataPath}
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
                  const capOn = workspaceAgentCapabilities[item.capabilityKey];
                  return (
                    <div key={item.label} className="flex items-center justify-between border-b border-zinc-100 px-1 py-2.5 last:border-b-0 dark:border-zinc-800">
                      <div className="flex items-center gap-2.5">
                        <div className={`flex h-7 w-7 items-center justify-center rounded-md ${capOn ? 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-100' : 'bg-zinc-50 text-zinc-300 dark:bg-zinc-900 dark:text-zinc-600'}`}>
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-[12px] font-medium text-zinc-800 dark:text-zinc-200">{item.label}</div>
                          <div className="mt-0.5 text-[10px] uppercase tracking-[0.12em] text-zinc-400 dark:text-zinc-500">{item.hint}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 text-[10px] text-zinc-500 dark:text-zinc-400">
                        <span className={`h-1.5 w-1.5 rounded-full ${capOn ? 'bg-zinc-700 dark:bg-zinc-200' : 'bg-zinc-300 dark:bg-zinc-600'}`} />
                        <span>{capOn ? t('capabilities.enabled') : t('capabilities.disabled')}</span>
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

        <aside className="flex h-full min-h-0 w-[min(100%,288px)] shrink-0 flex-col border-l border-border bg-muted/10 sm:w-[292px]">
          <AgentsWorkspaceRail
            workspaceAgentDataPath={workspaceAgentDataPath}
            promptStackItems={promptStackItems}
            promptStackKey={promptStackItems.map((item) => `${item.scope}:${item.label}:${item.path}`).join('|')}
            capabilityCards={capabilityCards}
            capabilityAgentId={workspaceAgentId}
            capabilities={workspaceAgent?.capabilities}
            onCapabilitiesUpdated={handleRailCapabilitiesUpdated}
          />
        </aside>
      </div>
    </div>
  );
}
