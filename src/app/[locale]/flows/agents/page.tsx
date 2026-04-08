'use client';

import { useState, useEffect, useCallback, useMemo, useRef, memo, type MouseEvent } from 'react';
import { useTranslations } from '@/client/i18n/use-translations';
import {
  Plus, Trash2, X, Minimize2,
  PanelLeft, PanelRight,
  MessageSquare, Archive, ArchiveRestore,
  Settings,
  Download, Upload, Search, Folder, FolderOpen,
  Bot, Command, Terminal, Globe,
  Files, GitBranch, Eye, Database, ListTodo, HardDrive,
  FileText, FileJson,
  Clock, History,
} from 'lucide-react';
import { lazy, Suspense } from 'react';
import type { Agent, AgentCapabilities, AgentPreset, OpenAIReasoningEffort } from '@/types';
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
import {
  AgentAvatar,
  SettingsForm,
  type FormData,
  emptyForm,
  agentToForm,
  applyAgentPresetToForm,
} from '@/components/agent-form';
import { AgentPickerDropdown } from '@/components/agent-picker-dropdown';
import { AgentPickerModal } from '@/components/agent-picker-modal';
import { type AllSessionItem, type OpenedSession, syncUrlParams } from '@/components/agent-session-utils';
import { useProject } from '@/components/project-context';
import { Link } from '@/client/i18n/routing';
import { repairTextIfNeeded } from '@/lib/text-repair';
import type {
  AgentsWorkspacePerAgentFocusPersist,
  AgentsWorkspaceProjectPersist,
} from '@/lib/agents-workspace-ui-shared';
import { agentsWorkspaceStorageKey } from '@/lib/agents-workspace-ui-shared';
import { useMediaQuery } from '@/hooks/use-media-query';
import { cn } from '@/lib/utils';

const WORKSPACE_UI_LS_PREFIX = 'pp.agentsWorkspaceUi.v1.';
function workspaceUiLocalStorageKey(projectKey: string | null): string {
  return WORKSPACE_UI_LS_PREFIX + agentsWorkspaceStorageKey(projectKey);
}


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

/** Provider / model line for workspace header；无配置时不占行。 */
function formatAgentRuntimeCaption(agent: Agent): string {
  const provider = agent.defaultProvider?.trim() ?? '';
  const model = agent.defaultModel?.trim() ?? '';
  if (!provider && !model) return '';
  if (provider && !model) return provider;
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
        <AgentAvatar
          slug={s.agentSlug}
          iconKey={s.agentIcon}
          agentId={s.agentId}
          customAvatar={s.agentCustomAvatar}
          updatedAt={s.agentUpdatedAt}
          className="h-full w-full object-cover"
        />
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
  const tPresets = useTranslations('presets');
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
  const workspaceUiHydratedRef = useRef(false);
  const hydrateSeqRef = useRef(0);

  // ── Agent create/edit ──
  const [creating, setCreating] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const selectedAgentIdRef = useRef(selectedAgentId);
  selectedAgentIdRef.current = selectedAgentId;
  const activePanelRef = useRef(activePanel);
  activePanelRef.current = activePanel;
  const lastWorkspaceFocusByAgentRef = useRef<Record<string, AgentsWorkspacePerAgentFocusPersist>>({});

  const persistWorkspaceFocusFromRefs = useCallback(() => {
    const panel = activePanelRef.current;
    const opened = openedSessionsRef.current;
    let aid: string | null = null;
    let focus: AgentsWorkspacePerAgentFocusPersist | null = null;
    if (panel?.type === 'session') {
      const o = opened.find((x) => x.key === panel.key);
      if (o) {
        aid = o.agentId;
        focus = { kind: 'session', sessionId: o.sessionId };
      }
    } else if (panel?.type === 'agent') {
      aid = panel.agentId;
      focus = { kind: 'agent', mode: panel.mode };
    }
    if (aid && focus) {
      lastWorkspaceFocusByAgentRef.current[aid] = focus;
    }
  }, []);

  const getWorkspaceContextAgentIdFromRefs = (): string | null => {
    const panel = activePanelRef.current;
    const opened = openedSessionsRef.current;
    if (panel?.type === 'session') {
      return opened.find((o) => o.key === panel.key)?.agentId ?? null;
    }
    if (panel?.type === 'agent') {
      return panel.agentId;
    }
    return selectedAgentIdRef.current;
  };

  const [form, setForm] = useState<FormData>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [expandedPrompt, setExpandedPrompt] = useState(false);

  /** 侧栏「+」下拉：外部导入 / 自主填写 / 使用预设 */
  const [newAgentMenuOpen, setNewAgentMenuOpen] = useState(false);
  const newAgentMenuRef = useRef<HTMLDivElement>(null);
  const [newAgentModal, setNewAgentModal] = useState<'closed' | 'import' | 'presetPick' | 'create'>('closed');

  const [sessionQuery, setSessionQuery] = useState('');
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [mobileAgentsListOpen, setMobileAgentsListOpen] = useState(false);
  const [mobileWorkspaceRailOpen, setMobileWorkspaceRailOpen] = useState(false);
  const mdUpAgents = useMediaQuery('(min-width: 768px)');
  const lgUpAgents = useMediaQuery('(min-width: 1024px)');
  const conversationStripRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (mdUpAgents) setMobileAgentsListOpen(false);
  }, [mdUpAgents]);

  useEffect(() => {
    if (lgUpAgents) setMobileWorkspaceRailOpen(false);
  }, [lgUpAgents]);

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

  useEffect(() => {
    if (!historyExpanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setHistoryExpanded(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [historyExpanded]);

  useEffect(() => {
    if (!newAgentMenuOpen) return;
    const onDown = (e: PointerEvent) => {
      const el = newAgentMenuRef.current;
      if (!el || !(e.target instanceof Node) || el.contains(e.target)) return;
      setNewAgentMenuOpen(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [newAgentMenuOpen]);

  useEffect(() => {
    if (newAgentModal !== 'import' && newAgentModal !== 'presetPick') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setNewAgentModal('closed');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [newAgentModal]);

  // ── New session agent picker (dropdown + modal) ──
  const [showAgentDropdown, setShowAgentDropdown] = useState(false);
  const [showAgentModal, setShowAgentModal] = useState(false);

  // ── Cached settings for child panels (fetched once, shared to all AgentChatPanel instances) ──
  type CachedSettings = {
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
        const VALID_EFFORTS: OpenAIReasoningEffort[] = ['minimal', 'low', 'medium', 'high', 'xhigh'];
        const effort: OpenAIReasoningEffort = (typeof claude.openaiReasoningEffort === 'string' && VALID_EFFORTS.includes(claude.openaiReasoningEffort)) ? claude.openaiReasoningEffort : 'xhigh';
        const fastMode = claude.openaiFastMode === true;
        setCachedSettings({ effort, fastMode });
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

  const [agentPresets, setAgentPresets] = useState<AgentPreset[]>([]);
  const fetchAgentPresets = useCallback(async () => {
    try {
      const res = await fetch('/api/data/agent-presets', { cache: 'no-store' });
      const data = await res.json();
      setAgentPresets(data.presets ?? []);
    } catch {
      setAgentPresets([]);
    }
  }, []);

  useEffect(() => { fetchAgents(); }, [fetchAgents]);
  useEffect(() => { void fetchAgentPresets(); }, [fetchAgentPresets]);

  const [urlProjectKey, setUrlProjectKey] = useState<string | null>(null);
  useEffect(() => {
    setUrlProjectKey(new URLSearchParams(window.location.search).get('project'));
  }, []);

  // 实际使用的 projectKey：优先用 ProjectProvider 的值，挂载后再同步 URL 参数
  const effectiveProjectKey = activeKey ?? urlProjectKey;

  const projectRootPath = useMemo(() => {
    const key = effectiveProjectKey;
    if (!key) return null;
    const entry = projects.find((p) => p.key === key);
    const raw = entry?.path?.trim();
    return raw && raw.length > 0 ? raw : null;
  }, [effectiveProjectKey, projects]);

  const currentProject = useMemo(
    () => (activeKey ? projects.find((p) => p.key === activeKey) : undefined),
    [projects, activeKey],
  );

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

  // ── Clear opened session panels when project changes ──
  const prevProjectKeyRef = useRef(effectiveProjectKey);
  useEffect(() => {
    if (prevProjectKeyRef.current !== effectiveProjectKey) {
      prevProjectKeyRef.current = effectiveProjectKey;
      workspaceUiHydratedRef.current = false;
      lastWorkspaceFocusByAgentRef.current = {};
      setOpenedSessions([]);
      setActivePanel(null);
      setSelectedAgentId(null);
      setCreating(false);
      setForm(emptyForm);
      setExpandedPrompt(false);
    }
  }, [effectiveProjectKey]);

  // URL 优先；否则从服务端恢复已打开标签（再 fallback localStorage）
  useEffect(() => {
    if (agents.length === 0) return;

    const seq = ++hydrateSeqRef.current;
    const pk = effectiveProjectKey ?? null;
    const url = new URL(window.location.href);
    const agentParam = url.searchParams.get('agent');
    const sessionParam = url.searchParams.get('session');

    if (agentParam) {
      const agent = agentsRef.current.find(a => a.id === agentParam);
      if (agent) {
        setSelectedAgentId(agent.id);
        setForm(agentToForm(agent));
        if (sessionParam) {
          const key = nextKeyRef.current++;
          setOpenedSessions(prev => [...prev, { sessionId: sessionParam, agentId: agent.id, key }]);
          setActivePanel({ type: 'session', key });
          lastWorkspaceFocusByAgentRef.current[agent.id] = { kind: 'session', sessionId: sessionParam };
        } else {
          setActivePanel({ type: 'agent', agentId: agent.id, mode: 'chat' });
          lastWorkspaceFocusByAgentRef.current[agent.id] = { kind: 'agent', mode: 'chat' };
        }
        workspaceUiHydratedRef.current = true;
        return;
      }
      syncUrlParams({ agent: null, session: null });
    }

    const applyBlob = (blob: AgentsWorkspaceProjectPersist): boolean => {
      const agentList = agentsRef.current;
      const agentIdSet = new Set(agentList.map(a => a.id));
      const filteredTabs = blob.tabs.filter(t => agentIdSet.has(t.agentId));
      if (filteredTabs.length === 0) return false;

      let k = nextKeyRef.current;
      const restored = filteredTabs.map(t => ({ ...t, key: k++ }));
      nextKeyRef.current = k;
      setOpenedSessions(restored);

      if (blob.lastFocusByAgent && Object.keys(blob.lastFocusByAgent).length > 0) {
        lastWorkspaceFocusByAgentRef.current = { ...blob.lastFocusByAgent };
      }

      if (blob.active?.kind === 'session') {
        const act = blob.active;
        const match = restored.find(
          o => o.agentId === act.agentId && o.sessionId === act.sessionId,
        );
        if (match) {
          setActivePanel({ type: 'session', key: match.key });
          const ag = agentList.find(a => a.id === match.agentId);
          if (ag) {
            setSelectedAgentId(ag.id);
            setForm(agentToForm(ag));
          }
          syncUrlParams({ agent: match.agentId, session: match.sessionId });
          return true;
        }
      } else if (blob.active?.kind === 'agent' && agentIdSet.has(blob.active.agentId)) {
        const act = blob.active;
        const ag = agentList.find(a => a.id === act.agentId)!;
        setSelectedAgentId(ag.id);
        setForm(agentToForm(ag));
        setActivePanel({
          type: 'agent',
          agentId: ag.id,
          mode: act.mode === 'settings' ? 'settings' : 'chat',
        });
        syncUrlParams({ agent: ag.id, session: null });
        return true;
      }

      const first = restored[0];
      setActivePanel({ type: 'session', key: first.key });
      const ag = agentList.find(a => a.id === first.agentId);
      if (ag) {
        setSelectedAgentId(ag.id);
        setForm(agentToForm(ag));
      }
      syncUrlParams({ agent: first.agentId, session: first.sessionId });
      return true;
    };

    let cancelled = false;
    void (async () => {
      const qs = `projectKey=${encodeURIComponent(pk ?? '')}`;
      try {
        const res = await fetch(`/api/data/agents-workspace-ui?${qs}`, { cache: 'no-store' });
        let blob: AgentsWorkspaceProjectPersist | null = null;
        if (res.ok) {
          blob = await res.json() as AgentsWorkspaceProjectPersist;
        }
        if (cancelled || seq !== hydrateSeqRef.current) return;

        if (blob?.tabs?.length) {
          if (applyBlob(blob)) {
            workspaceUiHydratedRef.current = true;
            try {
              localStorage.setItem(workspaceUiLocalStorageKey(pk), JSON.stringify(blob));
            } catch { /* ignore */ }
            return;
          }
        }

        try {
          const raw = localStorage.getItem(workspaceUiLocalStorageKey(pk));
          if (raw) {
            const local = JSON.parse(raw) as AgentsWorkspaceProjectPersist;
            if (local?.tabs?.length && applyBlob(local)) {
              workspaceUiHydratedRef.current = true;
              void fetch('/api/data/agents-workspace-ui', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  projectKey: pk,
                  tabs: local.tabs,
                  active: local.active,
                  lastFocusByAgent: local.lastFocusByAgent,
                }),
              }).catch(() => {});
              return;
            }
          }
        } catch { /* ignore */ }

        workspaceUiHydratedRef.current = true;
      } catch {
        if (cancelled || seq !== hydrateSeqRef.current) return;
        try {
          const raw = localStorage.getItem(workspaceUiLocalStorageKey(pk));
          if (raw) {
            const local = JSON.parse(raw) as AgentsWorkspaceProjectPersist;
            if (local?.tabs?.length) applyBlob(local);
          }
        } catch { /* ignore */ }
        workspaceUiHydratedRef.current = true;
      }
    })();

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agents.length, effectiveProjectKey]);

  // Refresh agent list when window regains focus
  useEffect(() => {
    const handleFocus = () => fetchAgents();
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [fetchAgents]);

  // ── Session cache per project (stale-while-revalidate) ──
  const sessionCacheRef = useRef<Map<string, AllSessionItem[]>>(new Map());
  const CACHE_KEY_ALL = '__all__';

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
          agentCustomAvatar: agent?.customAvatar,
          agentUpdatedAt: agent?.updatedAt,
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

  // 持久化已打开标签（服务端 + localStorage），切换路由/刷新后可恢复
  useEffect(() => {
    const t = window.setTimeout(() => {
      if (!workspaceUiHydratedRef.current) return;
      const pk = effectiveProjectKey ?? null;
      const tabs = openedSessions.map(({ agentId, sessionId }) => ({ agentId, sessionId }));
      let active: AgentsWorkspaceProjectPersist['active'] = null;
      if (activePanel?.type === 'session') {
        const o = openedSessions.find(x => x.key === activePanel.key);
        if (o) active = { kind: 'session', agentId: o.agentId, sessionId: o.sessionId };
      } else if (activePanel?.type === 'agent') {
        active = { kind: 'agent', agentId: activePanel.agentId, mode: activePanel.mode };
      }
      const lf = lastWorkspaceFocusByAgentRef.current;
      const lastFocusByAgent = Object.keys(lf).length > 0 ? { ...lf } : undefined;
      const body: AgentsWorkspaceProjectPersist = { tabs, active, lastFocusByAgent };

      try {
        if (tabs.length > 0) {
          localStorage.setItem(workspaceUiLocalStorageKey(pk), JSON.stringify(body));
        } else {
          lastWorkspaceFocusByAgentRef.current = {};
          localStorage.removeItem(workspaceUiLocalStorageKey(pk));
        }
      } catch { /* ignore */ }

      void fetch('/api/data/agents-workspace-ui', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectKey: pk,
          tabs: body.tabs,
          active: body.active,
          lastFocusByAgent: body.lastFocusByAgent,
        }),
      }).catch(() => {});
    }, 400);
    return () => clearTimeout(t);
  }, [openedSessions, activePanel, effectiveProjectKey]);

  // ── Clock for running-session elapsed display ──
  const hasRunningSession = useMemo(() => allSessions.some(s => s.isRunning), [allSessions]);
  const [listClockNow, setListClockNow] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (!hasRunningSession) return;
    setListClockNow(Date.now());
    const timer = setInterval(() => setListClockNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [hasRunningSession]);

  // ── 每个 Agent 最近一条未归档会话（侧栏排序 + 预览行，不依赖 allSessions 全局顺序）──
  const agentLatestNonArchivedSession = useMemo(() => {
    const m = new Map<string, AllSessionItem>();
    for (const s of allSessions) {
      if (s.archived) continue;
      const t = new Date(s.updatedAt).getTime();
      if (!Number.isFinite(t)) continue;
      const prev = m.get(s.agentId);
      const pt = prev ? new Date(prev.updatedAt).getTime() : -Infinity;
      if (t >= pt) m.set(s.agentId, s);
    }
    return m;
  }, [allSessions]);

  // ── Project-filtered agents；有对话的按最近活动时间倒序置顶（类即时通讯）──
  const filteredAgents = useMemo(() => {
    const filtered = !effectiveProjectKey
      ? agents
      : agents.filter(a => !a.projectKey || a.projectKey === effectiveProjectKey);

    const activityTs = (id: string) => {
      const s = agentLatestNonArchivedSession.get(id);
      return s ? new Date(s.updatedAt).getTime() : -1;
    };

    return [...filtered].sort((a, b) => {
      const ta = activityTs(a.id);
      const tb = activityTs(b.id);
      if (ta !== tb) return tb - ta;
      if (effectiveProjectKey) {
        const ap = a.projectKey ? 1 : 0;
        const bp = b.projectKey ? 1 : 0;
        if (ap !== bp) return bp - ap;
      }
      return 0;
    });
  }, [agents, effectiveProjectKey, agentLatestNonArchivedSession]);

  /** 侧栏搜索过滤后的 Agent（与列表展示一致） */
  const sidebarAgentsSearchFiltered = useMemo(() => {
    const q = sessionQuery.trim().toLowerCase();
    if (!q) return filteredAgents;
    return filteredAgents.filter(
      (a) =>
        (a.name ?? '').toLowerCase().includes(q) ||
        (a.id ?? '').toLowerCase().includes(q),
    );
  }, [filteredAgents, sessionQuery]);

  /**
   * 侧栏分组：内置 / 项目专属（有 projectKey）/ 全局自定义，组内仍按最近活动时间排序。
   * 与 AgentPicker 的 picker.group.* 分类一致。
   */
  const sidebarAgentsGrouped = useMemo(() => {
    const activityTs = (id: string) => {
      const s = agentLatestNonArchivedSession.get(id);
      return s ? new Date(s.updatedAt).getTime() : -1;
    };
    const sortAgents = (list: Agent[]) =>
      [...list].sort((a, b) => {
        const ta = activityTs(a.id);
        const tb = activityTs(b.id);
        if (ta !== tb) return tb - ta;
        if (effectiveProjectKey) {
          const ap = a.projectKey ? 1 : 0;
          const bp = b.projectKey ? 1 : 0;
          if (ap !== bp) return bp - ap;
        }
        return 0;
      });

    const builtin: Agent[] = [];
    const project: Agent[] = [];
    const global: Agent[] = [];
    for (const a of sidebarAgentsSearchFiltered) {
      if (a.builtIn) builtin.push(a);
      else if (a.projectKey) project.push(a);
      else global.push(a);
    }

    const sections: Array<{ id: 'builtin' | 'project' | 'global'; agents: Agent[] }> = [
      { id: 'builtin', agents: sortAgents(builtin) },
      { id: 'project', agents: sortAgents(project) },
      { id: 'global', agents: sortAgents(global) },
    ];
    return sections.filter((s) => s.agents.length > 0);
  }, [sidebarAgentsSearchFiltered, agentLatestNonArchivedSession, effectiveProjectKey]);

  // ── Recent agent IDs（与侧栏最近活跃一致，供选择器复用）──
  const recentAgentIds = useMemo(() => {
    return [...agentLatestNonArchivedSession.entries()]
      .sort(([, sa], [, sb]) => new Date(sb.updatedAt).getTime() - new Date(sa.updatedAt).getTime())
      .map(([id]) => id)
      .slice(0, 5);
  }, [agentLatestNonArchivedSession]);

  // ── Handlers: Conversations tab ──

  const handleSessionClick = useCallback((session: AllSessionItem) => {
    setMobileAgentsListOpen(false);
    setHistoryExpanded(false);
    persistWorkspaceFocusFromRefs();
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
  }, [persistWorkspaceFocusFromRefs]);

  const handleNewSession = (agent: Agent) => {
    setMobileAgentsListOpen(false);
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
    setMobileAgentsListOpen(false);
    setNewAgentMenuOpen(false);
    setNewAgentModal('closed');
    const opened = openedSessionsRef.current;
    const fromAid = getWorkspaceContextAgentIdFromRefs();

    // 同一 Agent：从会话缩回概览（与旧版侧栏一致）；已在概览/设置则不再重复切换
    if (!creating && fromAid === agent.id) {
      if (activePanelRef.current?.type === 'session') {
        setActivePanel({ type: 'agent', agentId: agent.id, mode: 'chat' });
        syncUrlParams({ agent: agent.id, session: null });
        lastWorkspaceFocusByAgentRef.current[agent.id] = { kind: 'agent', mode: 'chat' };
      }
      return;
    }

    persistWorkspaceFocusFromRefs();

    setCreating(false);
    setSelectedAgentId(agent.id);
    setForm(agentToForm(agent));
    setExpandedPrompt(false);
    setHistoryExpanded(false);

    const saved = lastWorkspaceFocusByAgentRef.current[agent.id];
    if (saved?.kind === 'session') {
      const tab = opened.find((o) => o.agentId === agent.id && o.sessionId === saved.sessionId);
      if (tab) {
        setActivePanel({ type: 'session', key: tab.key });
        syncUrlParams({ agent: agent.id, session: tab.sessionId });
        return;
      }
    }
    if (saved?.kind === 'agent') {
      setActivePanel({ type: 'agent', agentId: agent.id, mode: saved.mode });
      syncUrlParams({ agent: agent.id, session: null });
      return;
    }

    setActivePanel({ type: 'agent', agentId: agent.id, mode: 'chat' });
    syncUrlParams({ agent: agent.id, session: null });
  };

  /** 从顶部标签栏移除已打开实例（不删服务端会话，仍可从侧栏/历史进入） */
  const handleCloseWorkspaceSessionTab = useCallback((opened: OpenedSession, e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setHistoryExpanded(false);
    const agentId = opened.agentId;
    const tabsBefore = openedSessionsRef.current.filter((o) => o.agentId === agentId);
    const idx = tabsBefore.findIndex((o) => o.key === opened.key);
    const remainingAfter = tabsBefore.filter((o) => o.key !== opened.key);
    const wasActive = activePanel?.type === 'session' && activePanel.key === opened.key;

    setOpenedSessions((prev) => prev.filter((o) => o.key !== opened.key));

    if (!wasActive) return;

    const nextTab = remainingAfter[idx] ?? remainingAfter[idx - 1] ?? remainingAfter[0];
    if (nextTab) {
      setActivePanel({ type: 'session', key: nextTab.key });
      syncUrlParams({ agent: nextTab.agentId, session: nextTab.sessionId });
      return;
    }
    const ag = agents.find((a) => a.id === agentId);
    if (ag) {
      setCreating(false);
      setSelectedAgentId(ag.id);
      setForm(agentToForm(ag));
      setExpandedPrompt(false);
      setActivePanel({ type: 'agent', agentId: ag.id, mode: 'chat' });
      syncUrlParams({ agent: ag.id, session: null });
    } else {
      setActivePanel({ type: 'agent', agentId, mode: 'chat' });
      setSelectedAgentId(agentId);
      syncUrlParams({ agent: agentId, session: null });
    }
  }, [activePanel, agents]);

  const handleAgentSettingsClick = (agent: Agent) => {
    setNewAgentMenuOpen(false);
    setNewAgentModal('closed');
    setCreating(false);
    setSelectedAgentId(agent.id);
    setForm(agentToForm(agent));
    setExpandedPrompt(false);
    setActivePanel({ type: 'agent', agentId: agent.id, mode: 'settings' });
    syncUrlParams({ agent: agent.id, session: null });
  };

  // Alias for handleAgentClick used by handleClone
  const handleSelect = handleAgentClick;

  /** 自主填写：空白表单，不自动合并项目默认预设 */
  const openNewAgentManual = useCallback(() => {
    setNewAgentMenuOpen(false);
    setSelectedAgentId(null);
    setCreating(true);
    const defaultPk = (activeKey?.trim() || projects[0]?.key || '').trim();
    setForm({ ...emptyForm, projectKey: defaultPk });
    setExpandedPrompt(false);
    setActivePanel(null);
    setNewAgentModal('create');
  }, [activeKey, projects]);

  const openNewAgentPresetPicker = useCallback(() => {
    setNewAgentMenuOpen(false);
    setNewAgentModal('presetPick');
  }, []);

  const handlePresetChosenForNewAgent = useCallback(
    (preset: AgentPreset) => {
      setSelectedAgentId(null);
      setCreating(true);
      const defaultPk = (activeKey?.trim() || projects[0]?.key || '').trim();
      let initial: FormData = { ...emptyForm, projectKey: defaultPk };
      initial = applyAgentPresetToForm(initial, preset);
      setForm(initial);
      setExpandedPrompt(false);
      setActivePanel(null);
      setNewAgentModal('create');
    },
    [activeKey, projects],
  );

  const openNewAgentImportModal = useCallback(() => {
    setNewAgentMenuOpen(false);
    setNewAgentModal('import');
  }, []);

  const handleClose = () => {
    setNewAgentMenuOpen(false);
    setNewAgentModal('closed');
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
    if (creating && !form.projectKey?.trim()) {
      alert(t('agent.saveNeedsProject'));
      return;
    }
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
            projectKey: form.projectKey.trim(),
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
          setNewAgentModal('closed');
          setSelectedAgentId(data.agent.id);
          setForm(agentToForm(data.agent));
          setActivePanel({ type: 'agent', agentId: data.agent.id, mode: 'chat' });
          syncUrlParams({ agent: data.agent.id, session: null });
        } else {
          try {
            const err = await res.json() as { error?: string };
            alert(t('agent.saveErrorWithReason', { reason: err.error ?? String(res.status) }));
          } catch {
            alert(t('agent.saveErrorWithReason', { reason: String(res.status) }));
          }
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
            projectKey: form.projectKey.trim(),
            defaultProvider: form.defaultProvider || undefined,
            defaultModel: form.defaultModel || undefined,
            defaultOpenAIReasoningEffort: form.defaultProvider === 'openai'
              ? (form.defaultOpenAIReasoningEffort || null)
              : null,
            contextStrategy: form.contextStrategy || undefined,
          }),
        });
        if (res.ok) {
          await fetchAgents();
        } else {
          try {
            const err = await res.json() as { error?: string };
            alert(t('agent.saveErrorWithReason', { reason: err.error ?? String(res.status) }));
          } catch {
            alert(t('agent.saveErrorWithReason', { reason: String(res.status) }));
          }
        }
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

  const runAgentPackageImportFilePicker = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.ppagent';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const pkg = JSON.parse(text) as Record<string, unknown>;
        const importTargetKey = (activeKey?.trim() || projects[0]?.key || '').trim();
        if (!importTargetKey) {
          alert(t('agent.importNeedsProject'));
          return;
        }
        const res = await fetch('/api/agents/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...pkg, targetProjectKey: importTargetKey }),
        });
        if (res.ok) {
          const data = await res.json();
          await fetchAgents();
          handleSelect(data.agent);
          setNewAgentModal('closed');
          const msg = data.contextsImported > 0
            ? t('agent.importSuccessWithContexts', { name: data.agent.name, count: data.contextsImported })
            : t('agent.importSuccess', { name: data.agent.name });
          alert(msg);
        } else {
          const err = await res.json() as { error?: string };
          alert(t('agent.importErrorWithReason', { reason: err.error ?? String(res.status) }));
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
      && session.agentCustomAvatar === agent.customAvatar
      && session.agentUpdatedAt === agent.updatedAt
    ) return session;
    return {
      ...session,
      agentName: agent.name,
      agentSlug: agent.slug,
      agentIcon: agent.icon,
      agentCustomAvatar: agent.customAvatar,
      agentUpdatedAt: agent.updatedAt,
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
        && session.agentCustomAvatar === agent.customAvatar
        && session.agentUpdatedAt === agent.updatedAt
      ) return session;
      return {
        ...session,
        agentName: agent.name,
        agentSlug: agent.slug,
        agentIcon: agent.icon,
        agentCustomAvatar: agent.customAvatar,
        agentUpdatedAt: agent.updatedAt,
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
        { kind: 'folder', label: 'documents/content/', path: '~/.project-pilot/documents/content/' },
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

  const activeWorkspaceSession = activePanel?.type === 'session' ? activeOpened : null;
  const activeWorkspaceAgent = activeWorkspaceSession
    ? agents.find((agent) => agent.id === activeWorkspaceSession.agentId) ?? workspaceAgent
    : (selectedAgent ?? workspaceAgent);
  const activeWorkspacePanelKey = activeWorkspaceSession?.key ?? null;
  const activeWorkspaceSessionId = activeWorkspaceSession?.sessionId ?? null;
  const activeWorkspaceRuntimeCaption = activeWorkspaceAgent
    ? formatAgentRuntimeCaption(activeWorkspaceAgent)
    : '';

  const currentAgentSessions = useMemo(() => {
    if (!activeWorkspaceAgent) return [];
    return allSessions.filter(s => s.agentId === activeWorkspaceAgent.id && !s.archived);
  }, [allSessions, activeWorkspaceAgent]);
  const currentAgentHistorySessions = useMemo(() => currentAgentSessions.filter(s => !s.isRunning), [currentAgentSessions]);
  const openedSessionTabsForAgent = useMemo(() => {
    if (!activeWorkspaceAgent) return [];
    return openedSessions.filter((o) => o.agentId === activeWorkspaceAgent.id);
  }, [openedSessions, activeWorkspaceAgent]);

  const handleWorkspaceSessionTabClick = useCallback((opened: OpenedSession) => {
    setHistoryExpanded(false);
    setActivePanel({ type: 'session', key: opened.key });
    syncUrlParams({ agent: opened.agentId, session: opened.sessionId });
  }, []);

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
                agentCustomAvatar: agent.customAvatar,
                agentUpdatedAt: agent.updatedAt,
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
          agentCustomAvatar: agent.customAvatar,
          agentUpdatedAt: agent.updatedAt,
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

  const mobileChromeTitle = creating
    ? tAgents('newAgent')
    : displayText(selectedAgent?.name ?? activeWorkspaceAgent?.name, tAgents('title'));

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 overflow-hidden bg-background text-foreground">
      {mobileAgentsListOpen && (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          aria-label={t('workspace.closeOverlayAria')}
          onClick={() => setMobileAgentsListOpen(false)}
        />
      )}
      <aside
        className={cn(
          'relative z-50 flex w-[292px] shrink-0 flex-col border-r border-border bg-muted/20',
          'md:z-auto',
          'max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:h-full max-md:w-[min(100%,300px)] max-md:max-w-[90vw] max-md:shadow-xl',
          'max-md:transition-transform max-md:duration-200 max-md:ease-out',
          mobileAgentsListOpen ? 'max-md:translate-x-0' : 'max-md:pointer-events-none max-md:-translate-x-full',
        )}
      >
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
            <div ref={newAgentMenuRef} className="relative flex shrink-0 items-center gap-0.5">
              <button
                type="button"
                onClick={() => setNewAgentMenuOpen((o) => !o)}
                aria-haspopup="menu"
                aria-expanded={newAgentMenuOpen}
                aria-label={t('agent.newAgentMenuAria')}
                title={t('agent.createButton')}
                className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Plus className="h-4 w-4" />
              </button>
              {newAgentMenuOpen ? (
                <div
                  role="menu"
                  className="absolute right-0 top-full z-[100] mt-1 w-44 overflow-hidden rounded-lg border border-border bg-popover py-1 text-popover-foreground shadow-md"
                >
                  <button
                    type="button"
                    role="menuitem"
                    className="flex w-full items-center px-3 py-2 text-left text-sm transition-colors hover:bg-muted/80"
                    onClick={() => {
                      openNewAgentImportModal();
                    }}
                  >
                    {t('agent.menuImportExternal')}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="flex w-full items-center px-3 py-2 text-left text-sm transition-colors hover:bg-muted/80"
                    onClick={() => {
                      openNewAgentManual();
                    }}
                  >
                    {t('agent.menuManualEntry')}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="flex w-full items-center px-3 py-2 text-left text-sm transition-colors hover:bg-muted/80"
                    onClick={() => {
                      openNewAgentPresetPicker();
                    }}
                  >
                    {t('agent.menuFromPreset')}
                  </button>
                </div>
              ) : null}
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
          {sidebarAgentsSearchFiltered.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-muted/30 px-4 py-12 text-center">
              <MessageSquare className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50" aria-hidden />
              <p className="text-sm text-muted-foreground">
                {sessionQuery ? t('session.emptyFiltered') : t('picker.empty')}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {sidebarAgentsGrouped.map((group) => (
                <section key={group.id} aria-label={t(`picker.group.${group.id}`)}>
                  <h3 className="mb-1.5 px-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {t(`picker.group.${group.id}`)}
                    </span>
                  </h3>
                  <div className="flex flex-col gap-1">
                    {group.agents.map((agent) => {
                      const isActive = activeWorkspaceAgent?.id === agent.id;
                      const agentSessions = allSessions.filter(s => s.agentId === agent.id && !s.archived);
                      const lastSession = agentLatestNonArchivedSession.get(agent.id);
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
                            <AgentAvatar
                              slug={agent.slug}
                              iconKey={agent.icon}
                              agentId={agent.id}
                              customAvatar={agent.customAvatar}
                              updatedAt={agent.updatedAt}
                              className="h-full w-full object-cover"
                            />
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
                </section>
              ))}
            </div>
          )}
        </div>

      </aside>

      <div className="relative flex min-h-0 min-w-0 flex-1">
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
        {/* 占位：顶栏改为 fixed 后避免主内容顶到导航下 */}
        <div className="h-14 shrink-0 lg:hidden" aria-hidden />
        {/*
          fixed + z-[60]：右侧抽屉遮罩为 z-40 全屏，若顶栏仅在文档流中会被挡住，表现为「侧栏按钮丢失」。
          md:left-[292px]：与左侧 Agent 列表同宽，避免盖住桌面窄窗下的左栏。
        */}
        <div
          role="toolbar"
          aria-label={t('workspace.mobileAgentsToolbarAria')}
          className={cn(
            'fixed right-0 top-16 z-[60] flex h-14 items-center gap-2 border-b border-border bg-card/95 px-3 shadow-sm backdrop-blur-sm lg:hidden',
            'left-0 md:left-[292px]',
          )}
        >
          <button
            type="button"
            onClick={() => setMobileAgentsListOpen(true)}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-foreground shadow-sm transition-colors hover:bg-muted/80 md:hidden"
            aria-label={t('workspace.openAgentListAria')}
          >
            <PanelLeft className="h-5 w-5" aria-hidden />
          </button>
          <div className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
            {mobileChromeTitle}
          </div>
          <button
            type="button"
            onClick={() => setMobileWorkspaceRailOpen((o) => !o)}
            aria-expanded={mobileWorkspaceRailOpen}
            aria-controls="agents-workspace-rail-aside"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-foreground shadow-sm transition-colors hover:bg-muted/80"
            aria-label={t('workspace.openWorkspaceRailAria')}
          >
            <PanelRight className="h-5 w-5" aria-hidden />
          </button>
        </div>
        {activePanel?.type === 'agent' && selectedAgent && agentViewMode === 'settings' ? (
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
                    <AgentAvatar
                      slug={selectedAgent.slug}
                      iconKey={selectedAgent.icon}
                      agentId={selectedAgent.id}
                      customAvatar={selectedAgent.customAvatar}
                      updatedAt={selectedAgent.updatedAt}
                      className="h-full w-full object-cover"
                    />
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
                onAvatarChanged={fetchAgents}
              />
            </>
          )
        ) : (
          <div className="flex flex-1 flex-col overflow-hidden bg-linear-to-b from-background via-background to-muted/20">
            {activeWorkspaceAgent ? (
              <>
                {/* ── Top: row 1 = Agent & config, row 2 = conversation ── */}
                {/* relative z-30：下拉（历史）绝对定位溢出到下方时，必须整块叠在聊天区之上，否则兄弟节点会抢走点击 */}
                <div className="relative z-30 shrink-0 border-b border-border bg-card/30 px-4 py-3 backdrop-blur-sm sm:px-5">
                  <div className="mx-auto flex max-w-6xl flex-col gap-3">
                    {/* Row 1 — identity & configuration (not conversation) */}
                    <section
                      aria-label={activeWorkspaceAgent.name}
                      className="flex flex-col gap-3 rounded-xl border border-border/60 bg-background/80 p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                    >
                      <div className="flex min-w-0 flex-1 items-start gap-3">
                        <div className="h-11 w-11 shrink-0 overflow-hidden rounded-xl bg-muted ring-1 ring-border">
                          <AgentAvatar
                            slug={activeWorkspaceAgent.slug}
                            iconKey={activeWorkspaceAgent.icon}
                            agentId={activeWorkspaceAgent.id}
                            customAvatar={activeWorkspaceAgent.customAvatar}
                            updatedAt={activeWorkspaceAgent.updatedAt}
                            className="h-full w-full object-cover"
                          />
                        </div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                            <span className="truncate text-base font-semibold tracking-tight text-foreground">
                              {activeWorkspaceAgent.name}
                            </span>
                            {activeWorkspaceAgent.builtIn ? (
                              <span className="shrink-0 rounded-md border border-border bg-muted/50 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                                {t('agent.builtInBadge')}
                              </span>
                            ) : null}
                          </div>
                          {activeWorkspaceRuntimeCaption ? (
                            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                              {activeWorkspaceRuntimeCaption}
                            </p>
                          ) : null}
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
                      </div>
                    </section>

                    {/* Row 2 — 多会话标签行 + 新开 / 历史（其余布局不变） */}
                    <section
                      ref={conversationStripRef}
                      aria-label={t('workspace.rowConversationEyebrow')}
                      className="relative rounded-lg border border-border/60 bg-background/80 shadow-sm"
                    >
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch sm:gap-0">
                        <div className="flex min-h-10 min-w-0 flex-1 flex-col justify-end sm:min-h-9">
                          <div
                            role="tablist"
                            className="flex min-w-0 items-end gap-0.5 overflow-x-auto border-b border-border/70 px-2 pt-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                          >
                            {openedSessionTabsForAgent.map((opened) => {
                              const sess = opened.sessionId
                                ? currentAgentSessions.find((s) => s.id === opened.sessionId)
                                : null;
                              const label = opened.sessionId === null
                                ? t('workspace.draftShort')
                                : displayText(sess?.title, t('workspace.unnamedSession'));
                              const isActive =
                                activePanel?.type === 'session' && activePanel.key === opened.key;
                              const running = !!sess?.isRunning;
                              return (
                                <div
                                  key={opened.key}
                                  className={cn(
                                    'group/tab relative flex max-w-[min(220px,48vw)] shrink-0 rounded-t-md border',
                                    isActive
                                      ? 'z-10 -mb-px border-border border-b-background bg-background text-foreground'
                                      : 'border-transparent border-b-0 bg-muted/45 text-muted-foreground hover:bg-muted/80 hover:text-foreground',
                                  )}
                                >
                                  <button
                                    type="button"
                                    role="tab"
                                    aria-selected={isActive}
                                    title={t('workspace.sessionTabSwitch', { title: label })}
                                    onClick={() => handleWorkspaceSessionTabClick(opened)}
                                    className="flex min-w-0 flex-1 items-center gap-2 py-2 pl-3 pr-8 text-left text-sm transition-colors"
                                  >
                                    {running ? (
                                      <span className="relative flex h-2 w-2 shrink-0">
                                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                                        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                                      </span>
                                    ) : (
                                      <MessageSquare
                                        className={cn(
                                          'h-3.5 w-3.5 shrink-0',
                                          isActive ? 'text-primary' : 'text-muted-foreground',
                                        )}
                                        aria-hidden
                                      />
                                    )}
                                    <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
                                  </button>
                                  <button
                                    type="button"
                                    aria-label={t('workspace.sessionTabCloseLabel')}
                                    title={t('workspace.sessionTabCloseTitle')}
                                    onClick={(e) => handleCloseWorkspaceSessionTab(opened, e)}
                                    className="absolute right-1 top-1 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/15 hover:text-destructive focus-visible:opacity-100 group-hover/tab:opacity-100 group-focus-within/tab:opacity-100"
                                  >
                                    <X className="h-3.5 w-3.5" aria-hidden />
                                  </button>
                                </div>
                              );
                            })}
                            {openedSessionTabsForAgent.length === 0 ? (
                              <span className="px-2 py-2 text-xs text-muted-foreground">
                                {t('workspace.sessionTabsEmptyHint')}
                              </span>
                            ) : null}
                          </div>
                        </div>

                        <div className="flex shrink-0 flex-wrap items-center gap-2 border-border/70 px-2 py-2 sm:flex-nowrap sm:border-b sm:border-l sm:px-3 sm:py-0">
                          <button
                            type="button"
                            onClick={() => handleNewSession(activeWorkspaceAgent)}
                            className="inline-flex min-h-10 min-w-0 flex-1 items-center justify-center gap-2 rounded-lg border border-border bg-background px-4 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-muted sm:min-h-9 sm:flex-initial sm:rounded-md sm:px-3"
                            title={t('workspace.newConversation')}
                          >
                            <Plus className="h-4 w-4 shrink-0" aria-hidden />
                            <span className="truncate sm:hidden">{t('workspace.newConversationShort')}</span>
                            <span className="hidden truncate sm:inline">{t('workspace.newConversation')}</span>
                          </button>
                          {currentAgentHistorySessions.length > 0 ? (
                            <div className="relative shrink-0 sm:flex-initial">
                              <button
                                type="button"
                                onClick={() => setHistoryExpanded((prev) => !prev)}
                                aria-expanded={historyExpanded}
                                aria-haspopup="menu"
                                aria-label={t('workspace.historyWithCountAria', { count: currentAgentHistorySessions.length })}
                                title={
                                  historyExpanded
                                    ? t('workspace.collapseHistory')
                                    : t('workspace.historyChatsWithCount', { count: currentAgentHistorySessions.length })
                                }
                                className={cn(
                                  'inline-flex min-h-10 min-w-[44px] w-full items-center justify-center gap-2 rounded-lg border border-border px-3 text-sm font-medium transition-colors sm:min-h-9 sm:w-auto sm:rounded-md',
                                  historyExpanded ? 'border-primary/30 bg-primary/10 text-foreground' : 'bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
                                )}
                              >
                                <History className="h-4 w-4 shrink-0" aria-hidden />
                                <span className="sm:hidden">
                                  {t('workspace.historyShort')}
                                  <span className="tabular-nums"> ({currentAgentHistorySessions.length})</span>
                                </span>
                                <span className="hidden items-center gap-2 sm:inline-flex">
                                  <span>{t('workspace.historySessionsLabel')}</span>
                                  <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
                                    {currentAgentHistorySessions.length > 99 ? '99+' : currentAgentHistorySessions.length}
                                  </span>
                                </span>
                              </button>
                              {historyExpanded ? (
                                <div
                                  role="menu"
                                  className="absolute right-0 top-full z-100 mt-1.5 w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-md"
                                >
                                  <ul className="max-h-[min(320px,50vh)] space-y-0 overflow-y-auto p-1" role="none">
                                    {currentAgentHistorySessions.map((session) => (
                                      <li key={session.id} role="none">
                                        <button
                                          type="button"
                                          role="menuitem"
                                          onClick={() => handleSessionClick(session)}
                                          className={cn(
                                            'flex min-h-10 w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors',
                                            activeWorkspaceSessionId === session.id
                                              ? 'bg-primary/10'
                                              : 'hover:bg-muted/70',
                                          )}
                                        >
                                          <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                                          <span className="min-w-0 flex-1 truncate">
                                            {displayText(session.title, t('workspace.unnamedSession'))}
                                          </span>
                                          <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
                                            {formatSessionTimestamp(
                                              session.updatedAt,
                                              listClockNow ?? Date.now(),
                                              t('session.yesterday'),
                                            )}
                                          </span>
                                        </button>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </section>
                  </div>
                </div>

                {/* ── Bottom: Chat area (fixed height) ── */}
                <div
                  className="relative z-0 min-h-0 flex-1"
                  style={{ minHeight: 'min(420px, 50svh)' }}
                >
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
                    <AgentAvatar
                      slug={workspaceAgent?.slug}
                      iconKey={workspaceAgent?.icon}
                      agentId={workspaceAgent?.id}
                      customAvatar={workspaceAgent?.customAvatar}
                      updatedAt={workspaceAgent?.updatedAt}
                      className="h-full w-full object-cover"
                    />
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

        {mobileWorkspaceRailOpen && (
          <button
            type="button"
            className="fixed inset-0 z-40 bg-black/50 lg:hidden"
            aria-label={t('workspace.closeOverlayAria')}
            onClick={() => setMobileWorkspaceRailOpen(false)}
          />
        )}
        <aside
          id="agents-workspace-rail-aside"
          className={cn(
            'flex h-full min-h-0 w-[min(100%,288px)] flex-col border-l border-border bg-muted/10 sm:w-[292px] lg:w-[340px]',
            'lg:relative lg:shrink-0',
            'max-lg:absolute max-lg:right-0 max-lg:top-0 max-lg:z-50 max-lg:w-[min(100vw,320px)] max-lg:max-w-[90vw] max-lg:shadow-xl',
            'max-lg:transition-transform max-lg:duration-200 max-lg:ease-out',
            mobileWorkspaceRailOpen
              ? 'max-lg:translate-x-0'
              : 'max-lg:pointer-events-none max-lg:translate-x-full',
          )}
        >
          <AgentsWorkspaceRail
            projectRootPath={projectRootPath}
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

      {newAgentModal === 'import' ? (
        <div
          className="fixed inset-0 z-[200] flex items-start justify-center bg-black/40 px-4 pt-[18vh] backdrop-blur-[2px]"
          onClick={(e) => {
            if (e.target === e.currentTarget) setNewAgentModal('closed');
          }}
          role="presentation"
        >
          <div
            className="w-full max-w-md overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-agent-import-title"
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h2 id="new-agent-import-title" className="text-sm font-semibold">
                {t('agent.modalImportTitle')}
              </h2>
              <button
                type="button"
                onClick={() => setNewAgentModal('closed')}
                className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label={tActions('close')}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-4 px-4 py-4">
              <p className="text-sm leading-relaxed text-muted-foreground">{t('agent.modalImportDescription')}</p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => runAgentPackageImportFilePicker()}
                  className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  {t('agent.modalImportChooseFile')}
                </button>
                <button
                  type="button"
                  onClick={() => setNewAgentModal('closed')}
                  className="inline-flex items-center justify-center rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-muted/80"
                >
                  {tActions('cancel')}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {newAgentModal === 'presetPick' ? (
        <div
          className="fixed inset-0 z-[200] flex items-start justify-center bg-black/40 px-4 pt-[18vh] backdrop-blur-[2px]"
          onClick={(e) => {
            if (e.target === e.currentTarget) setNewAgentModal('closed');
          }}
          role="presentation"
        >
          <div
            className="flex max-h-[min(520px,85vh)] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-agent-preset-title"
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h2 id="new-agent-preset-title" className="text-sm font-semibold">
                {t('agent.modalPresetTitle')}
              </h2>
              <button
                type="button"
                onClick={() => setNewAgentModal('closed')}
                className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label={tActions('close')}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="border-b border-border/60 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
              {t('agent.modalPresetDescription')}
            </p>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {agentPresets.length === 0 ? (
                <div className="px-2 py-8 text-center text-sm text-muted-foreground">
                  <p>{t('agent.modalPresetEmpty')}</p>
                  <Link
                    href="/workspace/presets"
                    className="mt-3 inline-block text-sm font-medium text-primary underline-offset-2 hover:underline"
                    onClick={() => setNewAgentModal('closed')}
                  >
                    {t('agent.modalPresetManage')}
                  </Link>
                </div>
              ) : (
                <ul className="space-y-0.5" role="listbox">
                  {agentPresets.map((preset) => (
                    <li key={preset.id} role="none">
                      <button
                        type="button"
                        role="option"
                        className="flex w-full flex-col gap-0.5 rounded-lg px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted/80"
                        onClick={() => handlePresetChosenForNewAgent(preset)}
                      >
                        <span className="font-medium text-foreground">{preset.name}</span>
                        {preset.description ? (
                          <span className="line-clamp-2 text-xs text-muted-foreground">{preset.description}</span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {newAgentModal === 'create' && creating ? (
        <div
          className="fixed inset-0 z-[200] flex items-start justify-center bg-black/40 px-4 py-6 backdrop-blur-[2px] sm:py-10"
          onClick={(e) => {
            if (e.target === e.currentTarget) handleClose();
          }}
          role="presentation"
        >
          <div
            className="flex max-h-[min(90vh,880px)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-agent-create-title"
          >
            <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
              <h2 id="new-agent-create-title" className="text-sm font-semibold">
                {t('agent.modalCreateTitle')}
              </h2>
              <button
                type="button"
                onClick={handleClose}
                className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label={tActions('close')}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              {expandedPrompt ? (
                <div className="flex h-[min(60vh,480px)] flex-col gap-3 p-4">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                      系统提示词 — {form.name || '未命名'}
                    </label>
                    <button
                      type="button"
                      onClick={() => setExpandedPrompt(false)}
                      className="rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
                      title="收起"
                    >
                      <Minimize2 className="h-4 w-4" />
                    </button>
                  </div>
                  <textarea
                    autoFocus
                    value={form.systemPrompt}
                    onChange={(e) => setForm((f) => ({ ...f, systemPrompt: e.target.value }))}
                    placeholder="定义 Agent 的行为和能力，例如：你是一个专注于代码审查的助手..."
                    className="min-h-0 w-full flex-1 resize-none rounded-md border border-zinc-300 px-4 py-3 text-sm leading-relaxed outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500 dark:border-zinc-600 dark:bg-zinc-800 dark:focus:border-zinc-400 dark:focus:ring-zinc-400"
                  />
                </div>
              ) : (
                <div className="flex h-full min-h-[320px] flex-col overflow-hidden">
                  <p className="shrink-0 border-b border-border/60 bg-muted/20 px-4 py-2.5 text-center text-[11px] leading-relaxed text-muted-foreground">
                    {t('workspace.createAgentPresetHintBefore')}
                    <Link href="/workspace/presets" className="mx-0.5 font-medium text-primary underline-offset-2 hover:underline">
                      {tPresets('title')}
                    </Link>
                    {t('workspace.createAgentPresetHintAfter')}
                  </p>
                  <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
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
                      onAvatarChanged={fetchAgents}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
