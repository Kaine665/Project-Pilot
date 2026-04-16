'use client';

import { useState, useEffect, useCallback, useMemo, useRef, type MouseEvent } from 'react';
import { useTranslations } from '@/client/i18n/use-translations';
import {
  Plus, Trash2, X, Minimize2,
  PanelLeft, PanelRight,
  MessageSquare,
  Settings,
  Download, Upload, Search, Folder, FolderOpen,
  Bot, Command, Terminal, Globe, Ellipsis,
  Files, GitBranch, Eye, Database, ListTodo, HardDrive,
  FileText, FileJson,
  Clock, Pencil, Pin, PinOff, GitFork, Archive, ArchiveRestore,
} from 'lucide-react';
import { lazy, Suspense } from 'react';
import type { Agent, AgentCapabilities, AgentPreset, OpenAIReasoningEffort } from '@/types';
import { DEFAULT_AGENT_CAPABILITIES } from '@/types';
import { AgentsWorkspaceRail } from '@/components/agents-workspace-rail';
import { ProjectSwitcher } from '@/components/project-switcher';
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
import {
  agentsWorkspaceStorageKey,
  AGENTS_PAGE_AGENT_LIST_COLLAPSE_SNAP_PX,
  AGENTS_PAGE_AGENT_LIST_WIDTH_MIN,
  AGENTS_PAGE_AGENT_LIST_WIDTH_MAX,
  AGENTS_PAGE_MAIN_CHAT_MIN_WIDTH_PX,
  AGENTS_PAGE_WORKSPACE_RAIL_WIDTH_MAX,
  AGENTS_PAGE_WORKSPACE_RAIL_WIDTH_MIN,
  PP_AGENTS_LIST_TOGGLE_EVENT,
  readAgentsPageAgentListCollapsed,
  readAgentsPageAgentListWidth,
  readAgentsPageWorkspaceRailVisible,
  readAgentsPageWorkspaceRailWidth,
  writeAgentsPageAgentListCollapsed,
  writeAgentsPageAgentListWidth,
  writeAgentsPageWorkspaceRailVisible,
  writeAgentsPageWorkspaceRailWidth,
} from '@/lib/agents-workspace-ui-shared';
import { useMediaQuery } from '@/hooks/use-media-query';
import { cn } from '@/lib/utils';
import { dispatchWorkspaceImmersive } from '@/lib/workspace-immersive-bus';

const WORKSPACE_UI_LS_PREFIX = 'pp.agentsWorkspaceUi.v1.';
function workspaceUiLocalStorageKey(projectKey: string | null): string {
  return WORKSPACE_UI_LS_PREFIX + agentsWorkspaceStorageKey(projectKey);
}


// ── Helpers ──

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

/** 侧栏 Agent 搜索：合并可检索字段（小写，子串匹配） */
function agentSidebarSearchText(a: Agent): string {
  return [a.name, a.id, a.slug, a.description, a.projectKey]
    .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    .join(' ')
    .toLowerCase();
}

/** 同一 Agent 下至多保留一条草稿（sessionId === null），避免重复「新会话」或历史 blob 堆叠多条。 */
function dedupeDraftTabsByAgent<T extends { agentId: string; sessionId: string | null }>(tabs: T[]): T[] {
  const seenDraftAgent = new Set<string>();
  return tabs.filter((t) => {
    if (t.sessionId !== null) return true;
    if (seenDraftAgent.has(t.agentId)) return false;
    seenDraftAgent.add(t.agentId);
    return true;
  });
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

// ── Main page ──

export default function AgentsPage() {
  const { projects, activeKey } = useProject();
  const t = useTranslations('agentsWorkspace');
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

  // 清理每个 Agent 多余的 draft（只保留最新的一个）
  useEffect(() => {
    setOpenedSessions(prev => {
      const seen = new Set<string>();
      const cleaned: OpenedSession[] = [];
      // 反向遍历，保留最新的 draft
      for (let i = prev.length - 1; i >= 0; i--) {
        const o = prev[i];
        if (o.sessionId === null) {
          if (seen.has(o.agentId)) continue; // 跳过多余的 draft
          seen.add(o.agentId);
        }
        cleaned.unshift(o);
      }
      return cleaned.length === prev.length ? prev : cleaned;
    });
  }, []);
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

  /** 侧栏「+」下拉：外部导入 / 自主填写 / 使用模板 */
  const [newAgentMenuOpen, setNewAgentMenuOpen] = useState(false);
  const newAgentMenuRef = useRef<HTMLDivElement>(null);
  const [newAgentModal, setNewAgentModal] = useState<'closed' | 'import' | 'presetPick' | 'create'>('closed');

  const [sessionQuery, setSessionQuery] = useState('');
  const [expandedAgentHistoryIds, setExpandedAgentHistoryIds] = useState<Set<string>>(() => new Set());
  const [sessionContextMenu, setSessionContextMenu] = useState<
    | { kind: 'session'; x: number; y: number; session: AllSessionItem }
    | { kind: 'draft'; x: number; y: number; key: number; agentId: string }
    | null
  >(null);
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  /** 置顶成功瞬间高亮对应行，随后清除 */
  const [pinFlashSessionId, setPinFlashSessionId] = useState<string | null>(null);
  const pinFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [mobileAgentsListOpen, setMobileAgentsListOpen] = useState(false);
  const [mobileWorkspaceRailOpen, setMobileWorkspaceRailOpen] = useState(false);
  /** 简单浏览器「工作区放大」：覆盖本页顶栏以下区域，不使用系统全屏（Electron 顶栏按钮不受影响） */
  const [simpleBrowserWorkspaceFill, setSimpleBrowserWorkspaceFill] = useState(false);
  useEffect(() => {
    dispatchWorkspaceImmersive(simpleBrowserWorkspaceFill);
    return () => dispatchWorkspaceImmersive(false);
  }, [simpleBrowserWorkspaceFill]);
  /** 桌面（lg+）右侧 AgentsWorkspaceRail 显隐；默认收起，localStorage 整页缓存 3 小时内有效 */
  const [workspaceRailVisible, setWorkspaceRailVisible] = useState(() =>
    readAgentsPageWorkspaceRailVisible(),
  );
  const toggleWorkspaceRailVisible = useCallback(() => {
    setWorkspaceRailVisible((v) => {
      const next = !v;
      writeAgentsPageWorkspaceRailVisible(next);
      return next;
    });
  }, []);

  /** >= lg：右侧工作区 Rail 与主内容区分界可拖（与左侧列表一致，持久化整页级） */
  const [workspaceRailWidthPx, setWorkspaceRailWidthPx] = useState(() => readAgentsPageWorkspaceRailWidth());
  const workspaceRailWidthRef = useRef(workspaceRailWidthPx);
  workspaceRailWidthRef.current = workspaceRailWidthPx;
  const workspaceRailResizeDragRef = useRef<{ startX: number; startW: number } | null>(null);

  /** >= md：左侧列表与主区并排，可拖改列宽；<md 为抽屉，宽度类名单独控制 */
  const mdUpAgents = useMediaQuery('(min-width: 768px)');
  const mdUpAgentsRef = useRef(mdUpAgents);
  mdUpAgentsRef.current = mdUpAgents;
  const lgUpAgents = useMediaQuery('(min-width: 1024px)');
  const [agentListCollapsed, setAgentListCollapsed] = useState(() => readAgentsPageAgentListCollapsed());
  const [agentListWidthPx, setAgentListWidthPx] = useState(() => readAgentsPageAgentListWidth());
  const agentListWidthRef = useRef(agentListWidthPx);
  agentListWidthRef.current = agentListWidthPx;
  const agentListResizeDragRef = useRef<{ startX: number; startW: number } | null>(null);

  useEffect(() => {
    const onToggleFromRail = () => {
      if (mdUpAgentsRef.current) {
        setAgentListCollapsed((c) => {
          const next = !c;
          writeAgentsPageAgentListCollapsed(next);
          return next;
        });
      } else {
        setMobileAgentsListOpen((o) => !o);
      }
    };
    window.addEventListener(PP_AGENTS_LIST_TOGGLE_EVENT, onToggleFromRail);
    return () => window.removeEventListener(PP_AGENTS_LIST_TOGGLE_EVENT, onToggleFromRail);
  }, []);

  useEffect(() => {
    if (!mdUpAgents || agentListCollapsed) return;
    const clampToViewport = () => {
      const reserveCenter =
        AGENTS_PAGE_MAIN_CHAT_MIN_WIDTH_PX +
        (lgUpAgents && workspaceRailVisible ? AGENTS_PAGE_WORKSPACE_RAIL_WIDTH_MIN : 0);
      const maxW = Math.min(
        AGENTS_PAGE_AGENT_LIST_WIDTH_MAX,
        Math.max(AGENTS_PAGE_AGENT_LIST_WIDTH_MIN, window.innerWidth - reserveCenter),
      );
      setAgentListWidthPx((w) => {
        const next = Math.min(w, maxW);
        if (next !== w) writeAgentsPageAgentListWidth(next);
        return next;
      });
    };
    clampToViewport();
    window.addEventListener('resize', clampToViewport);
    return () => window.removeEventListener('resize', clampToViewport);
  }, [mdUpAgents, agentListCollapsed, lgUpAgents, workspaceRailVisible]);

  const onWorkspaceRailResizePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!lgUpAgents || !workspaceRailVisible) return;
      e.preventDefault();
      workspaceRailResizeDragRef.current = { startX: e.clientX, startW: workspaceRailWidthRef.current };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [lgUpAgents, workspaceRailVisible],
  );

  const onWorkspaceRailResizePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = workspaceRailResizeDragRef.current;
    if (!drag) return;
    const leftW = mdUpAgents && !agentListCollapsed ? agentListWidthRef.current : 0;
    const maxW = Math.min(
      AGENTS_PAGE_WORKSPACE_RAIL_WIDTH_MAX,
      Math.max(
        AGENTS_PAGE_WORKSPACE_RAIL_WIDTH_MIN,
        window.innerWidth - leftW - AGENTS_PAGE_MAIN_CHAT_MIN_WIDTH_PX,
      ),
    );
    /** 分割条在侧栏左缘：指针左移则侧栏变宽（与 VS Code 拉左侧沿一致） */
    const raw = drag.startW - (e.clientX - drag.startX);
    const next = Math.min(maxW, Math.max(AGENTS_PAGE_WORKSPACE_RAIL_WIDTH_MIN, raw));
    setWorkspaceRailWidthPx(next);
  }, [mdUpAgents, agentListCollapsed]);

  const onWorkspaceRailResizePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (workspaceRailResizeDragRef.current) {
      workspaceRailResizeDragRef.current = null;
      writeAgentsPageWorkspaceRailWidth(workspaceRailWidthRef.current);
    }
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  }, []);

  /** md+：左侧 Agent 列表右缘可拖改宽；拖过窄则收起（与右侧 Rail 左缘分割条方向对称） */
  const onAgentListResizePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!mdUpAgents || agentListCollapsed) return;
      e.preventDefault();
      agentListResizeDragRef.current = { startX: e.clientX, startW: agentListWidthRef.current };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [mdUpAgents, agentListCollapsed],
  );

  const onAgentListResizePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = agentListResizeDragRef.current;
      if (!drag) return;
      const reserveCenter =
        AGENTS_PAGE_MAIN_CHAT_MIN_WIDTH_PX +
        (lgUpAgents && workspaceRailVisible ? AGENTS_PAGE_WORKSPACE_RAIL_WIDTH_MIN : 0);
      const maxW = Math.min(
        AGENTS_PAGE_AGENT_LIST_WIDTH_MAX,
        Math.max(AGENTS_PAGE_AGENT_LIST_WIDTH_MIN, window.innerWidth - reserveCenter),
      );
      const raw = drag.startW + (e.clientX - drag.startX);
      if (raw < AGENTS_PAGE_AGENT_LIST_COLLAPSE_SNAP_PX) {
        setAgentListCollapsed(true);
        writeAgentsPageAgentListCollapsed(true);
        agentListResizeDragRef.current = null;
        try {
          (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
        } catch {
          /* noop */
        }
        return;
      }
      const next = Math.min(maxW, Math.max(AGENTS_PAGE_AGENT_LIST_WIDTH_MIN, raw));
      setAgentListWidthPx(next);
    },
    [mdUpAgents, lgUpAgents, workspaceRailVisible],
  );

  const onAgentListResizePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const wasDragging = agentListResizeDragRef.current !== null;
    agentListResizeDragRef.current = null;
    if (wasDragging && !readAgentsPageAgentListCollapsed()) {
      writeAgentsPageAgentListWidth(agentListWidthRef.current);
    }
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
  }, []);

  useEffect(() => {
    if (!lgUpAgents || !workspaceRailVisible) return;
    const clampToViewport = () => {
      const leftW = mdUpAgents && !agentListCollapsed ? agentListWidthRef.current : 0;
      const maxW = Math.min(
        AGENTS_PAGE_WORKSPACE_RAIL_WIDTH_MAX,
        Math.max(
          AGENTS_PAGE_WORKSPACE_RAIL_WIDTH_MIN,
          window.innerWidth - leftW - AGENTS_PAGE_MAIN_CHAT_MIN_WIDTH_PX,
        ),
      );
      setWorkspaceRailWidthPx((w) => {
        const next = Math.min(w, maxW);
        if (next !== w) writeAgentsPageWorkspaceRailWidth(next);
        return next;
      });
    };
    clampToViewport();
    window.addEventListener('resize', clampToViewport);
    return () => window.removeEventListener('resize', clampToViewport);
  }, [lgUpAgents, workspaceRailVisible, mdUpAgents, agentListCollapsed]);

  useEffect(() => {
    if (lgUpAgents) setMobileAgentsListOpen(false);
  }, [lgUpAgents]);

  useEffect(() => {
    if (lgUpAgents) setMobileWorkspaceRailOpen(false);
  }, [lgUpAgents]);

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
      const filteredTabs = dedupeDraftTabsByAgent(blob.tabs.filter(t => agentIdSet.has(t.agentId)));
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
              const agentIdSetPersist = new Set(agentsRef.current.map((a) => a.id));
              const tabsOut = dedupeDraftTabsByAgent(
                blob.tabs.filter((t) => agentIdSetPersist.has(t.agentId)),
              );
              localStorage.setItem(
                workspaceUiLocalStorageKey(pk),
                JSON.stringify({ ...blob, tabs: tabsOut }),
              );
            } catch { /* ignore */ }
            return;
          }
        }

        try {
          const raw = localStorage.getItem(workspaceUiLocalStorageKey(pk));
          if (raw) {
            const local = JSON.parse(raw) as AgentsWorkspaceProjectPersist;
            const agentIdSetPersist = new Set(agentsRef.current.map((a) => a.id));
            const tabsOut = dedupeDraftTabsByAgent(
              (local.tabs ?? []).filter((t) => agentIdSetPersist.has(t.agentId)),
            );
            if (tabsOut.length && applyBlob({ ...local, tabs: tabsOut })) {
              workspaceUiHydratedRef.current = true;
              void fetch('/api/data/agents-workspace-ui', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  projectKey: pk,
                  tabs: tabsOut,
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
            const agentIdSetPersist = new Set(agentsRef.current.map((a) => a.id));
            const tabsOut = dedupeDraftTabsByAgent(
              (local.tabs ?? []).filter((t) => agentIdSetPersist.has(t.agentId)),
            );
            if (tabsOut.length) applyBlob({ ...local, tabs: tabsOut });
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
      const sessions: AllSessionItem[] = (sessData.sessions ?? []).map((s: {
        id: string;
        title: string;
        updatedAt: string;
        agentId: string;
        unreadCount?: number;
        archived?: boolean;
        pinned?: boolean;
        projectKey?: string;
      }) => {
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
          pinned: s.pinned,
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

  /** 去掉同一 Agent 下多余草稿（含会话中遗留），并修正当前焦点与 URL */
  useEffect(() => {
    const prev = openedSessions;
    const next = dedupeDraftTabsByAgent(prev);
    if (next.length === prev.length) return;

    setOpenedSessions(next);
    setSessionContextMenu((m) => {
      if (m?.kind !== 'draft') return m;
      return next.some((o) => o.key === m.key) ? m : null;
    });

    const ap = activePanel;
    if (ap?.type === 'session' && !next.some((o) => o.key === ap.key)) {
      const victim = prev.find((o) => o.key === ap.key);
      const agentId = victim?.agentId;
      const draftReplacement =
        agentId != null ? next.find((o) => o.agentId === agentId && o.sessionId === null) : undefined;
      if (draftReplacement) {
        setActivePanel({ type: 'session', key: draftReplacement.key });
        syncUrlParams({ agent: agentId!, session: null });
        return;
      }
      const otherForAgent = agentId != null ? next.find((o) => o.agentId === agentId) : undefined;
      if (otherForAgent) {
        setActivePanel({ type: 'session', key: otherForAgent.key });
        syncUrlParams({ agent: otherForAgent.agentId, session: otherForAgent.sessionId });
        return;
      }
      if (agentId) {
        setActivePanel({ type: 'agent', agentId, mode: 'chat' });
        syncUrlParams({ agent: agentId, session: null });
      }
    }
  }, [openedSessions, activePanel]);

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

  /** 侧栏搜索过滤后的 Agent（名称 / ID / slug / 描述 / 项目 Key） */
  const sidebarAgentsSearchFiltered = useMemo(() => {
    const q = sessionQuery.trim().toLowerCase();
    if (!q) return filteredAgents;
    return filteredAgents.filter((a) => agentSidebarSearchText(a).includes(q));
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

  // ── Handlers: Agents tab ──

  const toggleAgentHistoryExpanded = useCallback((agentId: string) => {
    setExpandedAgentHistoryIds((prev) => {
      const next = new Set(prev);
      if (next.has(agentId)) next.delete(agentId);
      else next.add(agentId);
      return next;
    });
  }, []);

  const handleNewSession = useCallback((agent: Agent) => {
    setMobileAgentsListOpen(false);
    setNewAgentMenuOpen(false);
    setNewAgentModal('closed');
    setCreating(false);
    setSelectedAgentId(agent.id);
    setForm(agentToForm(agent));
    setExpandedPrompt(false);
    const existingDraft = openedSessionsRef.current.find(
      (o) => o.agentId === agent.id && o.sessionId === null,
    );
    if (existingDraft) {
      setActivePanel({ type: 'session', key: existingDraft.key });
      syncUrlParams({ agent: agent.id, session: null });
      return;
    }
    const key = nextKeyRef.current++;
    setOpenedSessions((prev) => [...prev, { sessionId: null, agentId: agent.id, key }]);
    setActivePanel({ type: 'session', key });
    syncUrlParams({ agent: agent.id, session: null });
  }, []);

  const handleSessionClick = useCallback((session: AllSessionItem) => {
    setMobileAgentsListOpen(false);
    setNewAgentMenuOpen(false);
    setNewAgentModal('closed');
    persistWorkspaceFocusFromRefs();
    if (session.unreadCount) {
      setAllSessions((prev) =>
        prev.map((s) => (s.id === session.id ? { ...s, unreadCount: 0 } : s)),
      );
      fetch(`/api/agent-chat/sessions/${session.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'markAsRead' }),
      }).catch(() => {});
    }
    const ag = agentsRef.current.find((a) => a.id === session.agentId);
    if (ag) {
      setCreating(false);
      setSelectedAgentId(ag.id);
      setForm(agentToForm(ag));
      setExpandedPrompt(false);
    }
    const existing = openedSessionsRef.current.find(
      (o) => o.sessionId === session.id && o.agentId === session.agentId,
    );
    if (existing) {
      setActivePanel({ type: 'session', key: existing.key });
    } else {
      const key = nextKeyRef.current++;
      setOpenedSessions((prev) => [...prev, { sessionId: session.id, agentId: session.agentId, key }]);
      setActivePanel({ type: 'session', key });
    }
    syncUrlParams({ agent: session.agentId, session: session.id });
  }, [persistWorkspaceFocusFromRefs]);

  const openPersistedSessionContextMenu = useCallback((clientX: number, clientY: number, session: AllSessionItem) => {
    setSessionContextMenu({ kind: 'session', x: clientX, y: clientY, session });
  }, []);

  const handleSessionContextMenu = useCallback((e: MouseEvent<HTMLButtonElement>, session: AllSessionItem) => {
    e.preventDefault();
    e.stopPropagation();
    openPersistedSessionContextMenu(e.clientX, e.clientY, session);
  }, [openPersistedSessionContextMenu]);

  /** 部分环境对 button 上 `contextmenu` 不稳定，右键 `mousedown` 作后备 */
  const handleSessionRowMouseDown = useCallback(
    (e: MouseEvent<HTMLButtonElement>, session: AllSessionItem) => {
      if (e.button !== 2) return;
      e.preventDefault();
      e.stopPropagation();
      openPersistedSessionContextMenu(e.clientX, e.clientY, session);
    },
    [openPersistedSessionContextMenu],
  );

  const openDraftContextMenu = useCallback((clientX: number, clientY: number, draft: OpenedSession) => {
    setSessionContextMenu({
      kind: 'draft',
      x: clientX,
      y: clientY,
      key: draft.key,
      agentId: draft.agentId,
    });
  }, []);

  const handleDraftContextMenu = useCallback((e: MouseEvent<HTMLButtonElement>, draft: OpenedSession) => {
    e.preventDefault();
    e.stopPropagation();
    openDraftContextMenu(e.clientX, e.clientY, draft);
  }, [openDraftContextMenu]);

  const handleDraftRowMouseDown = useCallback(
    (e: MouseEvent<HTMLButtonElement>, draft: OpenedSession) => {
      if (e.button !== 2) return;
      e.preventDefault();
      e.stopPropagation();
      openDraftContextMenu(e.clientX, e.clientY, draft);
    },
    [openDraftContextMenu],
  );

  const closeSessionContextMenu = useCallback(() => {
    setSessionContextMenu(null);
  }, []);

  const handleRemoveDraftFromOpenedList = useCallback(
    (draftKey: number, agentId: string) => {
      closeSessionContextMenu();
      const opened = openedSessionsRef.current;
      const filtered = opened.filter((o) => o.key !== draftKey);
      const wasActive =
        activePanelRef.current?.type === 'session' && activePanelRef.current.key === draftKey;

      setOpenedSessions(filtered);

      if (wasActive) {
        const nextForAgent = filtered.find((o) => o.agentId === agentId);
        if (nextForAgent) {
          setActivePanel({ type: 'session', key: nextForAgent.key });
          syncUrlParams({
            agent: agentId,
            session: nextForAgent.sessionId,
          });
        } else {
          setActivePanel({ type: 'agent', agentId, mode: 'chat' });
          syncUrlParams({ agent: agentId, session: null });
        }
      }
    },
    [closeSessionContextMenu],
  );

  const handleSessionPin = useCallback(async (session: AllSessionItem) => {
    const newPinned = !session.pinned;
    setAllSessions((prev) => prev.map((s) => (s.id === session.id ? { ...s, pinned: newPinned } : s)));
    closeSessionContextMenu();
    const res = await fetch(`/api/agent-chat/sessions/${session.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: newPinned ? 'pin' : 'unpin' }),
    }).catch(() => null);
    if (!res?.ok) {
      setAllSessions((prev) => prev.map((s) => (s.id === session.id ? { ...s, pinned: !newPinned } : s)));
      return;
    }
    if (pinFlashTimerRef.current) {
      clearTimeout(pinFlashTimerRef.current);
      pinFlashTimerRef.current = null;
    }
    if (newPinned) {
      setPinFlashSessionId(session.id);
      pinFlashTimerRef.current = setTimeout(() => {
        setPinFlashSessionId((cur) => (cur === session.id ? null : cur));
        pinFlashTimerRef.current = null;
      }, 1400);
    } else {
      setPinFlashSessionId((cur) => (cur === session.id ? null : cur));
    }
  }, [closeSessionContextMenu]);

  useEffect(() => {
    return () => {
      if (pinFlashTimerRef.current) clearTimeout(pinFlashTimerRef.current);
    };
  }, []);

  const handleSessionRenameStart = useCallback((session: AllSessionItem) => {
    setRenamingSessionId(session.id);
    setRenameValue(session.title);
    closeSessionContextMenu();
  }, [closeSessionContextMenu]);

  const handleSessionRenameSubmit = useCallback(async (sessionId: string) => {
    const trimmed = renameValue.trim();
    if (!trimmed) {
      setRenamingSessionId(null);
      return;
    }
    setAllSessions((prev) => prev.map((s) => (s.id === sessionId ? { ...s, title: trimmed } : s)));
    setRenamingSessionId(null);
    await fetch(`/api/agent-chat/sessions/${sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'rename', title: trimmed }),
    }).catch(() => {});
  }, [renameValue]);

  const handleSessionMarkAsUnread = useCallback(async (session: AllSessionItem) => {
    setAllSessions((prev) =>
      prev.map((s) =>
        s.id === session.id ? { ...s, unreadCount: Math.max(1, s.unreadCount ?? 0) } : s,
      ),
    );
    closeSessionContextMenu();
    await fetch(`/api/agent-chat/sessions/${session.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'markAsUnread' }),
    }).catch(() => {});
  }, [closeSessionContextMenu]);

  const handleSessionFork = useCallback(async (session: AllSessionItem) => {
    closeSessionContextMenu();
    const res = await fetch(`/api/agent-chat/sessions/${session.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'fork' }),
    }).catch(() => null);
    if (res?.ok) {
      const data = (await res.json().catch(() => ({}))) as { forkedId?: string };
      if (data.forkedId) {
        const forkedId = data.forkedId;
        const now = new Date().toISOString();
        const forked: AllSessionItem = {
          ...session,
          id: forkedId,
          title: `${session.title} (fork)`,
          updatedAt: now,
          unreadCount: 0,
          archived: undefined,
          pinned: undefined,
          isRunning: undefined,
        };
        setAllSessions((prev) => [forked, ...prev]);
        const key = nextKeyRef.current++;
        setOpenedSessions((prev) => [...prev, { sessionId: forkedId, agentId: session.agentId, key }]);
        setActivePanel({ type: 'session', key });
        syncUrlParams({ agent: session.agentId, session: forkedId });
      }
    }
  }, [closeSessionContextMenu]);

  const handleSessionArchiveFromMenu = useCallback(async (session: AllSessionItem) => {
    const newArchived = !session.archived;
    setAllSessions((prev) => prev.map((s) => (s.id === session.id ? { ...s, archived: newArchived } : s)));
    closeSessionContextMenu();
    const res = await fetch(`/api/agent-chat/sessions/${session.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: newArchived ? 'archive' : 'unarchive' }),
    }).catch(() => null);
    if (!res?.ok) {
      setAllSessions((prev) => prev.map((s) => (s.id === session.id ? { ...s, archived: !newArchived } : s)));
    }
  }, [closeSessionContextMenu]);

  useEffect(() => {
    if (!sessionContextMenu) return;
    const onPointerDown = (e: PointerEvent) => {
      // 避免右键按下阶段误关菜单，导致随后 `contextmenu` 无法稳定打开自定义菜单
      if (e.button !== 0) return;
      closeSessionContextMenu();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeSessionContextMenu();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [sessionContextMenu, closeSessionContextMenu]);

  const handleAgentClick = (agent: Agent) => {
    setMobileAgentsListOpen(false);
    setNewAgentMenuOpen(false);
    setNewAgentModal('closed');
    const opened = openedSessionsRef.current;
    const fromAid = getWorkspaceContextAgentIdFromRefs();

    if (!creating && fromAid === agent.id) {
      toggleAgentHistoryExpanded(agent.id);
      return;
    }

    persistWorkspaceFocusFromRefs();

    setCreating(false);
    setSelectedAgentId(agent.id);
    setForm(agentToForm(agent));
    setExpandedPrompt(false);
    setExpandedAgentHistoryIds((prev) => {
      const next = new Set(prev);
      next.add(agent.id);
      return next;
    });

    const saved = lastWorkspaceFocusByAgentRef.current[agent.id];
    const restoredSessionId = saved?.kind === 'session' ? saved.sessionId : null;
    if (restoredSessionId) {
      const tab = opened.find((o) => o.agentId === agent.id && o.sessionId === restoredSessionId);
      if (tab) {
        setActivePanel({ type: 'session', key: tab.key });
        syncUrlParams({ agent: agent.id, session: tab.sessionId });
        return;
      }
      const key = nextKeyRef.current++;
      setOpenedSessions((prev) => [...prev, { sessionId: restoredSessionId, agentId: agent.id, key }]);
      setActivePanel({ type: 'session', key });
      syncUrlParams({ agent: agent.id, session: restoredSessionId });
      return;
    }
    if (saved?.kind === 'agent') {
      setActivePanel({ type: 'agent', agentId: agent.id, mode: saved.mode });
      syncUrlParams({ agent: agent.id, session: null });
      return;
    }

    setActivePanel({ type: 'agent', agentId: agent.id, mode: 'chat' });
    syncUrlParams({ agent: agent.id, session: null });
  };

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

  /** 自主填写：空白表单，不自动合并项目默认 agent 模板 */
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

  /** 相对数据根：仅 canonical workspace；其下默认有子目录 data/（见后端 ensure） */
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
      scope: 'Resolved',
      accent: 'bg-rose-50 text-rose-800 border-rose-100',
      label: t('promptStack.items.resolved.label'),
      path: '—',
      tokens: null,
      description: t('promptStack.items.resolved.description'),
      target: 'resolved',
      agentId: workspaceAgentId,
      sessionId: workspaceSessionId,
      projectKey: effectiveProjectKey ?? undefined,
    },
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

  return (
    <div className="relative flex h-full min-h-0 w-full min-w-0 overflow-hidden bg-background text-foreground">
      <div
        id="pp-agents-workspace-browser-fill"
        className={cn(
          'absolute inset-0 z-[70] flex min-h-0 min-w-0 flex-col overflow-hidden',
          simpleBrowserWorkspaceFill ? 'pointer-events-auto bg-background' : 'pointer-events-none',
        )}
        aria-hidden={!simpleBrowserWorkspaceFill}
      />
      {mobileAgentsListOpen && (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          aria-label={t('workspace.closeOverlayAria')}
          onClick={() => setMobileAgentsListOpen(false)}
        />
      )}
      <div
        className={cn(
          'relative flex h-full shrink-0 flex-col overflow-visible',
          !mdUpAgents && 'shrink-0',
        )}
        style={mdUpAgents ? { width: agentListCollapsed ? 0 : agentListWidthPx } : undefined}
      >
        <aside
          aria-hidden={mdUpAgents && agentListCollapsed ? true : undefined}
          className={cn(
            'relative z-50 flex min-h-0 flex-1 flex-col border-b border-r border-border/80 bg-muted/25 dark:bg-muted/10',
            mdUpAgents ? 'min-w-0 md:h-full md:w-full' : 'h-full w-[292px]',
            mdUpAgents && agentListCollapsed && 'min-w-0 max-w-0 overflow-hidden border-r-0 p-0',
            'md:z-auto',
            'max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:h-full max-md:w-[min(100%,300px)] max-md:max-w-[90vw] max-md:shadow-xl',
            'max-md:transition-transform max-md:duration-200 max-md:ease-out',
            mobileAgentsListOpen ? 'max-md:translate-x-0' : 'max-md:pointer-events-none max-md:-translate-x-full',
          )}
          style={mdUpAgents ? { width: agentListCollapsed ? 0 : '100%' } : undefined}
        >
        <div className="border-b border-border/70 bg-card/50 px-4 pb-3 pt-4 backdrop-blur-sm dark:bg-card/35">
          <div className="mb-3 min-w-0">
            <ProjectSwitcher variant="sidebar" />
          </div>
          <label className="sr-only" htmlFor="agents-sidebar-search">
            {t('workspace.agentSearchPlaceholder')}
          </label>
          <div className="flex items-stretch gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-border/70 bg-background/95 px-3 py-2 shadow-[0_1px_2px_rgba(15,23,42,0.05)] transition-shadow focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/35 dark:border-border dark:bg-background/90 dark:shadow-[0_1px_2px_rgba(0,0,0,0.35)]">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <input
                id="agents-sidebar-search"
                value={sessionQuery}
                onChange={(e) => setSessionQuery(e.target.value)}
                placeholder={t('workspace.agentSearchPlaceholder')}
                className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/80"
              />
            </div>
            <div ref={newAgentMenuRef} className="relative flex shrink-0 items-center self-center">
              <button
                type="button"
                onClick={() => setNewAgentMenuOpen((o) => !o)}
                aria-haspopup="menu"
                aria-expanded={newAgentMenuOpen}
                aria-label={t('agent.newAgentMenuAria')}
                title={t('agent.createButton')}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/80 bg-background text-foreground/85 shadow-[0_1px_2px_rgba(15,23,42,0.06)] transition-colors hover:border-border hover:bg-accent hover:text-foreground hover:shadow-sm dark:border-border dark:bg-background/95 dark:text-foreground/90 dark:shadow-[0_1px_2px_rgba(0,0,0,0.35)] dark:hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Plus className="h-[18px] w-[18px]" strokeWidth={2.5} aria-hidden />
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
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-2">
          {sidebarAgentsSearchFiltered.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/80 bg-muted/35 px-4 py-12 text-center dark:bg-muted/20">
              <MessageSquare className="mx-auto mb-3 h-8 w-8 text-muted-foreground/55 dark:text-muted-foreground/50" aria-hidden />
              <p className="text-sm leading-snug text-muted-foreground">
                {sessionQuery ? t('workspace.agentSearchEmpty') : t('picker.empty')}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {sidebarAgentsGrouped.map((group) => (
                <section
                  key={group.id}
                  aria-label={t(`picker.group.${group.id}`)}
                  className="flex flex-col gap-1"
                >
                    {group.agents.map((agent) => {
                      const isActive = activeWorkspaceAgent?.id === agent.id;
                      const agentSessions = allSessions.filter((s) => s.agentId === agent.id && !s.archived);
                      const historySessions = agentSessions;
                      const lastSession = agentLatestNonArchivedSession.get(agent.id);
                      const totalUnread = agentSessions.reduce((sum, s) => sum + (s.unreadCount || 0), 0);
                      const hasRunning = agentSessions.some((s) => s.isRunning);
                      const isHistoryExpanded = expandedAgentHistoryIds.has(agent.id);
                      const draftSessions = openedSessions.filter((o) => o.agentId === agent.id && o.sessionId === null);
                      return (
                        <div key={agent.id} className="flex flex-col gap-0.5">
                          <div
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
                              'group/agent flex cursor-pointer items-start gap-3 rounded-xl px-2.5 py-2.5 transition-colors',
                              isActive
                                ? 'bg-card shadow-sm ring-1 ring-border/80 dark:ring-border'
                                : 'hover:bg-muted/65 dark:hover:bg-muted/30',
                            )}
                          >
                            <div
                              className={cn(
                                'mt-0.5 h-10 w-10 shrink-0 overflow-hidden rounded-xl ring-1 ring-inset',
                                isActive
                                  ? 'bg-primary/10 text-primary ring-primary/15'
                                  : 'bg-muted/85 text-muted-foreground ring-border/70 dark:bg-muted/50',
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
                              <div className="mb-0.5 min-w-0">
                                <span
                                  className={cn(
                                    'block truncate text-sm leading-tight',
                                    isActive ? 'font-semibold tracking-tight text-foreground' : 'font-medium text-foreground',
                                  )}
                                >
                                  {agent.name}
                                </span>
                              </div>
                              <div
                                className="flex min-w-0 items-start gap-1.5 text-[13px] leading-snug text-muted-foreground/95 dark:text-muted-foreground"
                                title={displayText(
                                  agent.description?.trim() ? agent.description : undefined,
                                  t('workspace.defaultAgentDescription', { agentName: agent.name }),
                                )}
                              >
                                {hasRunning && (
                                  <span
                                    className="mt-0.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500 animate-pulse"
                                    aria-hidden
                                  />
                                )}
                                <span className="line-clamp-2 min-w-0 flex-1 break-words leading-snug">
                                  {displayText(
                                    agent.description?.trim() ? agent.description : undefined,
                                    t('workspace.defaultAgentDescription', { agentName: agent.name }),
                                  )}
                                </span>
                              </div>
                            </div>
                            <div className="flex min-w-0 shrink-0 flex-col items-end gap-1 self-start pt-0.5">
                              {lastSession ? (
                                <span className="block w-full text-right text-[11px] font-medium tabular-nums text-muted-foreground/90">
                                  {formatSessionTimestamp(lastSession.updatedAt, Date.now(), t('session.yesterday'))}
                                </span>
                              ) : null}
                              {(totalUnread > 0 && !isActive) || agentSessions.length > 0 ? (
                                <div className="flex shrink-0 items-center justify-end gap-1.5">
                                  {totalUnread > 0 && !isActive ? (
                                    <span className="flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">
                                      {totalUnread > 99 ? '99+' : totalUnread}
                                    </span>
                                  ) : null}
                                  {agentSessions.length > 0 ? (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        toggleAgentHistoryExpanded(agent.id);
                                      }}
                                      className="shrink-0 rounded-md bg-muted/80 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground hover:bg-muted"
                                      title={isHistoryExpanded ? tActions('collapse') : tActions('expand')}
                                    >
                                      {isHistoryExpanded ? '−' : '+'} {agentSessions.length}
                                    </button>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
                          </div>

                          {isHistoryExpanded && historySessions.length === 0 && (
                            <div className="ml-0.5 flex flex-col gap-0.5 rounded-lg bg-muted/20 p-1.5 pl-2">
                              <button
                                type="button"
                                onClick={() => handleNewSession(agent)}
                                className="flex min-h-8 w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                              >
                                <Plus className="h-3 w-3 shrink-0" aria-hidden />
                                <span>{t('session.new')}</span>
                              </button>
                              {draftSessions.map((draft) => {
                                const isDraftActive = activePanel?.type === 'session' && activePanel.key === draft.key;
                                return (
                                  <button
                                    key={`draft-${draft.key}`}
                                    type="button"
                                    onClick={() => {
                                      setActivePanel({ type: 'session', key: draft.key });
                                      syncUrlParams({ agent: agent.id, session: null });
                                    }}
                                    onContextMenu={(e) => handleDraftContextMenu(e, draft)}
                                    onMouseDown={(e) => handleDraftRowMouseDown(e, draft)}
                                    className={cn(
                                      'flex min-h-8 items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors',
                                      isDraftActive
                                        ? 'bg-primary/10 font-medium text-foreground'
                                        : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                                    )}
                                  >
                                    <MessageSquare className="h-3 w-3 shrink-0 text-primary/60" aria-hidden />
                                    <span className="min-w-0 flex-1 truncate italic">{t('workspace.draftSessionLabel')}</span>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                          {isHistoryExpanded && historySessions.length > 0 && (
                            <div className="ml-0.5 flex max-h-48 flex-col gap-0.5 overflow-y-auto rounded-lg bg-muted/20 p-1.5 pl-2">
                              <button
                                type="button"
                                onClick={() => handleNewSession(agent)}
                                className="flex min-h-7 items-center gap-2 rounded-md px-2 py-1 text-left text-xs text-muted-foreground/60 transition-colors hover:bg-muted/50 hover:text-foreground"
                              >
                                <Plus className="h-3 w-3 shrink-0" aria-hidden />
                                <span>{t('session.new')}</span>
                              </button>
                              {draftSessions.map((draft) => {
                                const isDraftActive = activePanel?.type === 'session' && activePanel.key === draft.key;
                                return (
                                  <button
                                    key={`draft-${draft.key}`}
                                    type="button"
                                    onClick={() => {
                                      setActivePanel({ type: 'session', key: draft.key });
                                      syncUrlParams({ agent: agent.id, session: null });
                                    }}
                                    onContextMenu={(e) => handleDraftContextMenu(e, draft)}
                                    onMouseDown={(e) => handleDraftRowMouseDown(e, draft)}
                                    className={cn(
                                      'flex min-h-8 items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors',
                                      isDraftActive
                                        ? 'bg-primary/10 font-medium text-foreground'
                                        : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                                    )}
                                  >
                                    <MessageSquare className="h-3 w-3 shrink-0 text-primary/60" aria-hidden />
                                    <span className="min-w-0 flex-1 truncate italic">{t('workspace.draftSessionLabel')}</span>
                                  </button>
                                );
                              })}
                              {[...historySessions]
                                .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0))
                                .map((session) =>
                                  renamingSessionId === session.id ? (
                                    <form
                                      key={session.id}
                                      className="flex min-h-8 items-center gap-2 rounded-md px-2 py-1"
                                      onSubmit={(e) => {
                                        e.preventDefault();
                                        void handleSessionRenameSubmit(session.id);
                                      }}
                                      onContextMenu={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        openPersistedSessionContextMenu(e.clientX, e.clientY, session);
                                      }}
                                      onMouseDown={(e) => {
                                        if (e.button !== 2) return;
                                        e.preventDefault();
                                        e.stopPropagation();
                                        openPersistedSessionContextMenu(e.clientX, e.clientY, session);
                                      }}
                                    >
                                      <Pencil className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
                                      <input
                                        autoFocus
                                        value={renameValue}
                                        onChange={(e) => setRenameValue(e.target.value)}
                                        onBlur={() => void handleSessionRenameSubmit(session.id)}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Escape') setRenamingSessionId(null);
                                        }}
                                        className="min-w-0 flex-1 rounded border border-border bg-background px-1.5 py-0.5 text-xs text-foreground outline-none focus:ring-1 focus:ring-ring"
                                      />
                                    </form>
                                  ) : (
                                    <div
                                      key={session.id}
                                      role="presentation"
                                      className={cn(
                                        'flex min-h-8 items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-all duration-300',
                                        session.pinned &&
                                          'border-l-2 border-l-primary bg-primary/[0.06]',
                                        activeSessionId === session.id
                                          ? 'bg-primary/10 font-medium text-foreground'
                                          : session.pinned
                                            ? 'text-foreground/90 hover:bg-primary/[0.09]'
                                            : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                                        pinFlashSessionId === session.id &&
                                          'ring-2 ring-primary/45 ring-offset-1 ring-offset-background animate-pulse',
                                      )}
                                      onContextMenu={(e) => {
                                        if ((e.target as HTMLElement).closest('[data-session-archive-hit]')) return;
                                        e.preventDefault();
                                        e.stopPropagation();
                                        openPersistedSessionContextMenu(e.clientX, e.clientY, session);
                                      }}
                                      onMouseDown={(e) => {
                                        if (e.button !== 2) return;
                                        if ((e.target as HTMLElement).closest('[data-session-archive-hit]')) return;
                                        e.preventDefault();
                                        e.stopPropagation();
                                        openPersistedSessionContextMenu(e.clientX, e.clientY, session);
                                      }}
                                    >
                                      <button
                                        type="button"
                                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                                        onClick={() => handleSessionClick(session)}
                                        onContextMenu={(e) => handleSessionContextMenu(e, session)}
                                        onMouseDown={(e) => handleSessionRowMouseDown(e, session)}
                                        title={displayText(session.title, t('workspace.sessionFallbackTitle'))}
                                      >
                                        {session.pinned ? (
                                          <Pin className="h-3 w-3 shrink-0 text-primary" aria-hidden />
                                        ) : (
                                          <Clock className="h-3 w-3 shrink-0" aria-hidden />
                                        )}
                                        <span className="min-w-0 flex-1 truncate">
                                          {displayText(session.title, t('workspace.sessionFallbackTitle'))}
                                        </span>
                                        {(session.unreadCount ?? 0) > 0 && (
                                          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
                                        )}
                                      </button>
                                      <span className="flex shrink-0 items-center gap-1">
                                        <span className="text-[10px] font-medium tabular-nums text-muted-foreground/85">
                                          {formatSessionTimestamp(
                                            session.updatedAt,
                                            Date.now(),
                                            t('session.yesterday'),
                                          )}
                                        </span>
                                        <button
                                          type="button"
                                          data-session-archive-hit
                                          className="rounded p-0.5 text-muted-foreground/60 transition-colors hover:bg-muted/80 hover:text-foreground"
                                          title={t('session.contextMenu.archive')}
                                          aria-label={t('session.contextMenu.archive')}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            e.preventDefault();
                                            void handleSessionArchiveFromMenu(session);
                                          }}
                                        >
                                          <Archive className="h-3 w-3 shrink-0" aria-hidden />
                                        </button>
                                      </span>
                                    </div>
                                  ),
                                )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                </section>
              ))}
            </div>
          )}
        </div>
          {mdUpAgents && !agentListCollapsed ? (
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label={t('workspace.resizeAgentListAria')}
              onPointerDown={onAgentListResizePointerDown}
              onPointerMove={onAgentListResizePointerMove}
              onPointerUp={onAgentListResizePointerUp}
              onPointerCancel={onAgentListResizePointerUp}
              className={cn(
                'absolute inset-y-0 right-0 z-30 hidden w-2 translate-x-1/2 cursor-ew-resize touch-none select-none',
                'hover:bg-muted/35 dark:hover:bg-muted/25 md:block',
              )}
            />
          ) : null}
        </aside>
      </div>

      {sessionContextMenu ? (
        <>
          <div
            className="fixed inset-0 z-[200]"
            aria-hidden
            onClick={closeSessionContextMenu}
            onContextMenu={(e) => {
              e.preventDefault();
              // 勿在此处 close：同一记右键会先 mousedown 打开菜单、再 contextmenu 命中本层 z-200 遮罩，若关闭会表现为「右键无菜单」
            }}
          />
          <div
            role="menu"
            className="fixed z-[210] min-w-[200px] rounded-lg border border-border bg-popover py-1 text-sm text-popover-foreground shadow-lg"
            style={{ left: sessionContextMenu.x, top: sessionContextMenu.y }}
          >
            {sessionContextMenu.kind === 'session' ? (
              <>
                <button
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/80"
                  onClick={() => void handleSessionPin(sessionContextMenu.session)}
                >
                  {sessionContextMenu.session.pinned ? (
                    <PinOff className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  ) : (
                    <Pin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  )}
                  {sessionContextMenu.session.pinned
                    ? t('session.contextMenu.unpin')
                    : t('session.contextMenu.pin')}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/80"
                  onClick={() => handleSessionRenameStart(sessionContextMenu.session)}
                >
                  <Pencil className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  {t('session.contextMenu.rename')}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/80"
                  onClick={() => void handleSessionMarkAsUnread(sessionContextMenu.session)}
                >
                  <MessageSquare className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  {t('session.contextMenu.markAsUnread')}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/80"
                  onClick={() => void handleSessionFork(sessionContextMenu.session)}
                >
                  <GitFork className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  {t('session.contextMenu.forkChat')}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/80"
                  onClick={() => void handleSessionArchiveFromMenu(sessionContextMenu.session)}
                >
                  {sessionContextMenu.session.archived ? (
                    <ArchiveRestore className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  ) : (
                    <Archive className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  )}
                  {sessionContextMenu.session.archived
                    ? t('session.contextMenu.unarchive')
                    : t('session.contextMenu.archive')}
                </button>
              </>
            ) : (
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/80"
                title={t('workspace.sessionTabCloseTitle')}
                onClick={() =>
                  handleRemoveDraftFromOpenedList(sessionContextMenu.key, sessionContextMenu.agentId)}
              >
                <X className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                {t('workspace.sessionTabCloseLabel')}
              </button>
            )}
          </div>
        </>
      ) : null}

      <div className="relative flex min-h-0 min-w-0 flex-1 bg-muted/20 dark:bg-muted/10">
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background shadow-[-4px_0_24px_rgba(0,0,0,0.03)] border-l border-border/50 dark:shadow-none dark:border-border/60 z-10 ring-1 ring-border/5">
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
                    onClick={() => setMobileAgentsListOpen(true)}
                    className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
                    aria-label={t('workspace.openAgentListAria')}
                  >
                    <PanelLeft className="h-4 w-4" aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => setMobileWorkspaceRailOpen((o) => !o)}
                    aria-expanded={mobileWorkspaceRailOpen}
                    aria-controls="agents-workspace-rail-aside"
                    className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
                    aria-label={t('workspace.openWorkspaceRailAria')}
                  >
                    <PanelRight className="h-4 w-4" aria-hidden />
                  </button>
                  <button
                    type="button"
                    className="hidden rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:inline-flex"
                    title={t('workspace.more')}
                    aria-label={t('workspace.more')}
                  >
                    <Ellipsis className="h-4 w-4" aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={toggleWorkspaceRailVisible}
                    className={cn(
                      'hidden rounded-lg p-2 transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:inline-flex',
                      workspaceRailVisible ? 'text-foreground' : 'text-muted-foreground',
                    )}
                    title={t('workspace.toggleSidebar')}
                    aria-label={t('workspace.toggleSidebar')}
                    aria-pressed={workspaceRailVisible}
                  >
                    <PanelRight className="h-4 w-4" aria-hidden />
                  </button>
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
          <div className="flex flex-1 flex-col overflow-hidden bg-linear-to-b from-background via-background/95 to-muted/28 dark:to-muted/15">
            {activeWorkspaceAgent ? (
              <>
                {/* ── Top: Agent identity & configuration ── */}
                <div className="relative shrink-0 border-b border-border/80 bg-card/45 px-4 py-1 backdrop-blur-sm sm:px-5 dark:border-border dark:bg-card/30">
                  <div className="mx-auto flex max-w-6xl flex-col gap-3">
                    <section
                      aria-label={activeWorkspaceAgent.name}
                      className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                    >
                      <div className="flex min-w-0 flex-1 items-start gap-2">
                        <button
                          type="button"
                          onClick={() => setMobileAgentsListOpen(true)}
                          className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-foreground shadow-sm transition-colors hover:bg-muted/80 lg:hidden"
                          aria-label={t('workspace.openAgentListAria')}
                        >
                          <PanelLeft className="h-4 w-4" aria-hidden />
                        </button>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                            <span className="truncate text-base font-semibold tracking-tight text-foreground antialiased">
                              {activeWorkspaceAgent.name}
                            </span>
                            {activeWorkspaceAgent.builtIn ? (
                              <span className="shrink-0 rounded-md border border-border/80 bg-muted/60 px-2 py-0.5 text-[11px] font-semibold tracking-wide text-muted-foreground dark:border-border">
                                {t('agent.builtInBadge')}
                              </span>
                            ) : null}
                          </div>
                          {activeWorkspaceRuntimeCaption ? (
                            <p className="mt-1.5 text-xs font-medium leading-snug text-muted-foreground/90 dark:text-muted-foreground">
                              {activeWorkspaceRuntimeCaption}
                            </p>
                          ) : null}
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center gap-0.5 rounded-lg border border-border/80 bg-card px-1 py-0.5 shadow-xs ml-auto">
                        <button
                          type="button"
                          onClick={() => setMobileWorkspaceRailOpen((o) => !o)}
                          aria-expanded={mobileWorkspaceRailOpen}
                          aria-controls="agents-workspace-rail-aside"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-transparent text-muted-foreground transition-colors hover:bg-accent hover:text-foreground lg:hidden"
                          aria-label={t('workspace.openWorkspaceRailAria')}
                        >
                          <PanelRight className="h-4 w-4" aria-hidden />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleAgentSettingsClick(activeWorkspaceAgent)}
                          className="inline-flex items-center gap-1.5 rounded-md bg-transparent px-3 py-1.5 text-[13px] font-medium text-foreground transition-colors hover:bg-accent dark:border-border"
                        >
                          <Settings className="h-3.5 w-3.5" />
                          {t('workspace.configureAgent')}
                        </button>
                        <button
                          type="button"
                          className="hidden h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground lg:inline-flex"
                          title={t('workspace.more')}
                          aria-label={t('workspace.more')}
                        >
                          <Ellipsis className="h-4 w-4" aria-hidden />
                        </button>
                        <button
                          type="button"
                          onClick={toggleWorkspaceRailVisible}
                          className={cn(
                            'hidden h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-foreground lg:inline-flex',
                            workspaceRailVisible ? 'text-foreground' : 'text-muted-foreground',
                          )}
                          title={t('workspace.toggleSidebar')}
                          aria-label={t('workspace.toggleSidebar')}
                          aria-pressed={workspaceRailVisible}
                        >
                          <PanelRight className="h-4 w-4" aria-hidden />
                        </button>
                      </div>
                    </section>
                  </div>
                </div>

                {/* ── Chat area ── */}
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
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted/90 text-muted-foreground ring-1 ring-border/60 dark:bg-muted/50">
                  <Bot className="h-7 w-7 opacity-90" />
                </div>
                <p className="max-w-sm text-sm leading-relaxed text-muted-foreground/95">{t('workspace.noAgentsInWorkspace')}</p>
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
                onClick={openNewAgentManual}
                className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-[12px] font-medium text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                新建 Agent
              </button>
              <button
                onClick={openNewAgentImportModal}
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
            'relative flex h-full min-h-0 flex-col border-l border-border/80 bg-muted/25 dark:bg-muted/10',
            'lg:shrink-0',
            !workspaceRailVisible && 'lg:hidden',
            'max-lg:absolute max-lg:right-0 max-lg:top-0 max-lg:z-50 max-lg:w-[min(100vw,320px)] max-lg:max-w-[90vw] max-lg:shadow-xl',
            'max-lg:transition-transform max-lg:duration-200 max-lg:ease-out',
            mobileWorkspaceRailOpen
              ? 'max-lg:translate-x-0'
              : 'max-lg:pointer-events-none max-lg:translate-x-full',
          )}
          style={lgUpAgents && workspaceRailVisible ? { width: workspaceRailWidthPx } : undefined}
        >
          {lgUpAgents && workspaceRailVisible ? (
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label={t('workspace.resizeWorkspaceRailAria')}
              onPointerDown={onWorkspaceRailResizePointerDown}
              onPointerMove={onWorkspaceRailResizePointerMove}
              onPointerUp={onWorkspaceRailResizePointerUp}
              onPointerCancel={onWorkspaceRailResizePointerUp}
              className={cn(
                'absolute inset-y-0 left-0 z-30 w-2 -translate-x-1/2 cursor-ew-resize touch-none select-none',
                'hover:bg-muted/35 dark:hover:bg-muted/25',
              )}
            />
          ) : null}
          <AgentsWorkspaceRail
            projectRootPath={projectRootPath}
            workspaceAgentDataPath={workspaceAgentDataPath}
            promptStackItems={promptStackItems}
            promptStackKey={promptStackItems.map((item) => `${item.scope}:${item.label}:${item.path}`).join('|')}
            capabilityCards={capabilityCards}
            capabilityAgentId={workspaceAgentId}
            capabilities={workspaceAgent?.capabilities}
            onCapabilitiesUpdated={handleRailCapabilitiesUpdated}
            simpleBrowserWorkspaceFill={simpleBrowserWorkspaceFill}
            onSimpleBrowserWorkspaceFillChange={setSimpleBrowserWorkspaceFill}
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
