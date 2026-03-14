'use client';

import { useState, useEffect, useRef, useCallback, useMemo, startTransition } from 'react';
import { flushSync } from 'react-dom';
import { Loader2, Maximize2, Minimize2, Bot, Sparkles, Plus, MessageSquare, Trash2, Settings, FileDown, ClipboardList, ArrowLeft, GitFork, ArrowUp, ChevronDown, ChevronUp, Layers, FolderOpen } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { ChatBubble } from '@/components/chat-bubble';
import { ChatInput } from '@/components/chat-input';
import { ChatNotificationBanners } from '@/components/chat-notification-banners';
import { useNotificationManager } from '@/hooks/use-notification-manager';
import { SaveKnowledgeDialog } from '@/components/save-knowledge-dialog';
import { SessionDropdown } from '@/components/session-dropdown';
import { GuestAgentOverlay } from '@/components/guest-agent-overlay';
import { SessionConfigPanel } from '@/components/session-config-panel';
import { PlanViewerPanel } from '@/components/plan-viewer-panel';
import { SessionCompressDialog } from '@/components/session-compress-dialog';
import { FilePreviewDialog } from '@/components/file-preview-dialog';
import { FolderExplorerPanel } from '@/components/folder-explorer-panel';
import type { SessionNavLink } from '@/components/agent-session-utils';
import { buildSessionUrl } from '@/components/agent-session-utils';
import { PROVIDER_REGISTRY, getProviderPreset, getModelContextWindow } from '@/lib/provider-registry';
import { imageAttachmentFromDataUrl } from '@/lib/image-assets';
import type { Agent, ProviderId, OpenAIReasoningEffort } from '@/types';
import type { PendingUserQueueItem, PendingUserQueueState, SessionConfig } from '@/types/agent-chat';
import type { ChatMessage, ChatToolCall, ChatSSEEvent, ContentBlock } from '@/types';

// Session list item (no messages)
export interface SessionListItem {
  id: string;
  title: string;
  updatedAt: string;
  unreadCount?: number;
  isRunning?: boolean;
  isAwaiting?: boolean;
  runningStartedAt?: string;
}

interface AgentChatPanelProps {
  agent: Agent;
  /** undefined = auto-select latest; null = new empty session; string = load specific session */
  initialSessionId?: string | null;
  /** Called when sessions are created or updated (for parent to refresh sidebar) */
  onSessionChange?: (newSession?: SessionListItem) => void;
  /** Display variant: sidebar or full (butler mode). Omit for plain agent chat. */
  variant?: 'sidebar' | 'full';
  /** Project scope (butler mode). When set, flow context is injected. */
  projectKey?: string | null;
  /** Pre-loaded agents list from parent; skips redundant /api/agents fetch */
  cachedAgents?: Agent[];
  /** Pre-loaded settings (provider, model, effort) from parent; skips /api/settings fetch */
  cachedSettings?: {
    provider: ProviderId;
    model: string;
    modelOptions: ModelSelectOption[];
    effort: OpenAIReasoningEffort;
  };
}

type IndexedSSEEvent = ChatSSEEvent & { _idx: number };
type ModelSelectOption = { value: string; label: string };

const PROVIDER_LABELS: Record<ProviderId, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  deepseek: 'DeepSeek',
  kimi: 'Kimi',
  qwen: 'Qwen',
  zhipu: 'GLM',
  minimax: 'MiniMax',
  openrouter: 'OpenRouter',
  ollama: 'Ollama',
  custom: 'Custom',
};

// Title is generated asynchronously by session-title-generator.
// Keep this strip function for backward compatibility with older replies.
function stripSessionTitleTag(text: string): string {
  return text.replace(/<session-title>[\s\S]*?<\/session-title>\s*/, '');
}

function clonePendingQueueItems(items: PendingUserQueueItem[]): PendingUserQueueItem[] {
  return items.map((item) => ({
    text: item.text,
    images: item.images?.length ? [...item.images] : undefined,
  }));
}

function sortSessionList(items: SessionListItem[]): SessionListItem[] {
  return [...items].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
}

function mergeSessionList(
  prev: SessionListItem[],
  remote: SessionListItem[],
): SessionListItem[] {
  const remoteIds = new Set(remote.map((s) => s.id));
  const localById = new Map(prev.map((s) => [s.id, s]));
  const mergedRemote = remote.map((item) => {
    const local = localById.get(item.id);
    if (!local?.isRunning && !local?.isAwaiting) return item;
    return {
      ...item,
      isRunning: local.isRunning || undefined,
      isAwaiting: local.isAwaiting || item.isAwaiting || undefined,
      runningStartedAt: local.runningStartedAt ?? item.runningStartedAt,
    };
  });
  const localOnly = prev.filter((s) => !remoteIds.has(s.id));
  return sortSessionList([...localOnly, ...mergedRemote]);
}

function upsertSessionListItem(
  prev: SessionListItem[],
  item: SessionListItem,
): SessionListItem[] {
  const next = prev.filter((s) => s.id !== item.id);
  next.push(item);
  return sortSessionList(next);
}

function patchSessionListItem(
  prev: SessionListItem[],
  sessionId: string,
  patch: Partial<SessionListItem>,
): SessionListItem[] {
  return sortSessionList(
    prev.map((s) => (s.id === sessionId ? { ...s, ...patch } : s)),
  );
}

function formatSessionElapsed(startedAt: string | undefined, nowTs: number): string {
  if (!startedAt) return '0s';
  const diffSeconds = Math.max(
    0,
    Math.floor((nowTs - new Date(startedAt).getTime()) / 1000),
  );
  if (diffSeconds < 60) return `${diffSeconds}s`;
  if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)}m`;
  return `${Math.floor(diffSeconds / 3600)}h`;
}


export function AgentChatPanel({
  agent,
  initialSessionId,
  onSessionChange,
  variant,
  projectKey,
  cachedAgents,
  cachedSettings,
}: AgentChatPanelProps) {
  const t = useTranslations();
  const router = useRouter();
  const hasProject = !!variant && !!projectKey;
  const isFull = variant === 'full';

  // Initialize notification manager
  const { notifyCompletion } = useNotificationManager();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingBlocks, setStreamingBlocks] = useState<ContentBlock[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Session management
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionList, setSessionList] = useState<SessionListItem[]>([]);
  const [sessionTitle, setSessionTitle] = useState(hasProject ? t('chat.newSession') : 'New Session');
  const [sessionClockNow, setSessionClockNow] = useState(() => Date.now());

  // Provider / model routing
  const [chatProvider, setChatProvider] = useState<ProviderId>('anthropic');
  const [chatModel, setChatModel] = useState('claude-sonnet-4-5-20250929');
  const [chatModelOptions, setChatModelOptions] = useState<ModelSelectOption[]>([
    { value: 'claude-sonnet-4-5-20250929', label: 'Claude Sonnet 4.5' },
  ]);
  const [chatEffort, setChatEffort] = useState<OpenAIReasoningEffort>('xhigh');

  // Guest Agent (observer)
  const [guestAgent, setGuestAgent] = useState<Agent | null>(null);
  const [guestAgents, setGuestAgents] = useState<Agent[]>([]);

  // Knowledge draft notifications (auto-path)
  const [knowledgeDrafts, setKnowledgeDrafts] = useState<Array<{ entryId: string; label: string }>>([]);

  // Design doc saved notifications (auto-path)
  const [docsSaved, setDocsSaved] = useState<Array<{ docId: string; title: string; projectKey: string }>>([]);

  // Save as knowledge dialog
  const [saveDialogContent, setSaveDialogContent] = useState<string | null>(null);

  // Session compression
  const [compressDialogOpen, setCompressDialogOpen] = useState(false);
  const [compressDismissed, setCompressDismissed] = useState(false);

  // Session config
  const [sessionConfig, setSessionConfig] = useState<SessionConfig>({});
  const [showConfig, setShowConfig] = useState(false);
  const [showFolderExplorer, setShowFolderExplorer] = useState(false);

  // Plan viewer
  const [planContent, setPlanContent] = useState<string | null>(null);
  const [isPlanOpen, setIsPlanOpen] = useState(false);
  const [inPlanMode, setInPlanMode] = useState(false);

  // File preview
  const [previewFilePath, setPreviewFilePath] = useState<string | null>(null);

  // Token usage tracking
  const [tokenInputs, setTokenInputs] = useState(0);
  const [tokenOutputs, setTokenOutputs] = useState(0);
  const [promptEstimate, setPromptEstimate] = useState(0);
  const [contextWindow, setContextWindow] = useState(200000);

  // 父子会话导航
  const [parentSession, setParentSession] = useState<SessionNavLink | null>(null);
  const [childSessions, setChildSessions] = useState<SessionNavLink[]>([]);
  const [showChildList, setShowChildList] = useState(false);

  const streamAbortRef = useRef<AbortController | null>(null);
  const blocksRef = useRef<ContentBlock[]>([]);
  const rafIdRef = useRef<number>(0);
  const fullTextRef = useRef('');
  const toolCallsRef = useRef<ChatToolCall[]>([]);
  const lastEventIdxRef = useRef<number>(-1);
  const finalizingRef = useRef(false);
  const streamTargetSessionRef = useRef<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const initTokenRef = useRef(0);
  const doSendRef = useRef<(text: string, images?: string[]) => void>(() => {});
  const isStreamingRef = useRef(false);
  const messagesRef = useRef<ChatMessage[]>([]);
  const pendingAnswerRef = useRef<{ answer: string; targetSessionId: string } | null>(null);
  const pendingUserMessagesRef = useRef<PendingUserQueueItem[]>([]);
  // OpenAI 模型列表缓存（5 分钟 TTL，避免每次切换都发请求）
  const openaiModelsCacheRef = useRef<{ options: { value: string; label: string }[]; cachedAt: number } | null>(null);
  const OPENAI_MODELS_CACHE_TTL = 5 * 60 * 1000;
  const [pendingUserQueueCount, setPendingUserQueueCount] = useState(0);
  const [pendingUserMessages, setPendingUserMessages] = useState<PendingUserQueueItem[]>([]);
  const [queueExpanded, setQueueExpanded] = useState(true);

  // Sync sessionId to both state and ref atomically (avoids stale ref between renders)
  const setSessionIdSync = useCallback((id: string | null) => {
    setSessionId(id);
    sessionIdRef.current = id;
  }, []);

  useEffect(() => {
    isStreamingRef.current = isStreaming;
  }, [isStreaming]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const persistPendingUserQueue = useCallback((
    targetSessionId: string,
    items: PendingUserQueueItem[],
    expanded: boolean = queueExpanded,
  ) => {
    fetch(`/api/agent-chat/sessions/${targetSessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'updatePendingUserQueue',
        queue: {
          items: clonePendingQueueItems(items),
          expanded: expanded ? undefined : false,
        } satisfies PendingUserQueueState,
      }),
    }).catch(() => {});
  }, [queueExpanded]);

  const replacePendingUserQueue = useCallback((
    items: PendingUserQueueItem[],
    options?: { persist?: boolean; sessionId?: string | null; expanded?: boolean },
  ) => {
    const nextItems = clonePendingQueueItems(items);
    pendingUserMessagesRef.current = nextItems;
    setPendingUserMessages(nextItems);
    setPendingUserQueueCount(nextItems.length);

    if (options?.persist) {
      const targetSessionId = options.sessionId ?? sessionIdRef.current;
      if (targetSessionId) {
        persistPendingUserQueue(targetSessionId, nextItems, options.expanded);
      }
    }
  }, [persistPendingUserQueue]);

  const updateQueueExpanded = useCallback((expanded: boolean) => {
    setQueueExpanded(expanded);
    const currentSid = sessionIdRef.current;
    if (currentSid && pendingUserMessagesRef.current.length > 0) {
      persistPendingUserQueue(currentSid, pendingUserMessagesRef.current, expanded);
    }
  }, [persistPendingUserQueue]);

  useEffect(() => {
    if (!sessionList.some((session) => session.isRunning)) return;
    const timer = window.setInterval(() => {
      setSessionClockNow(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, [sessionList]);

  // Abort any in-flight stream when the component unmounts (e.g. agent view -> session view switch)
  useEffect(() => {
    return () => {
      streamAbortRef.current?.abort();
      pendingAnswerRef.current = null;
      pendingUserMessagesRef.current = [];
    };
  }, []);

  const flushQueuedUserMessage = useCallback((targetSessionId: string, delayMs = 200) => {
    setTimeout(() => {
      if (sessionIdRef.current !== targetSessionId) return;
      if (scrollRef.current?.offsetParent === null) return;
      if (isStreamingRef.current) return;

      const [next, ...rest] = pendingUserMessagesRef.current;
      if (!next) return;
      replacePendingUserQueue(rest, { persist: true, sessionId: targetSessionId });
      doSendRef.current(next.text, next.images);
    }, delayMs);
  }, [replacePendingUserQueue]);

  // Stable streaming message object
  const streamingMessage = useMemo<ChatMessage>(() => ({
    id: 'streaming',
    role: 'assistant',
    content: '',
    timestamp: '',
  }), []);

  // Load guest agent candidates (chat-mode agents, excluding current agent)
  useEffect(() => {
    if (cachedAgents) {
      setGuestAgents(cachedAgents.filter(a => !a.archived && a.id !== agent.id));
      return;
    }
    (async () => {
      try {
        const res = await fetch('/api/agents', { cache: 'no-store' });
        const data = await res.json();
        const available = (data.agents ?? []).filter(
          (a: Agent) => !a.archived && a.id !== agent.id,
        );
        setGuestAgents(available);
      } catch {
        // ignore
      }
    })();
  }, [agent.id, cachedAgents]);

  // Provider/model selector options
  const providerOptions = useMemo(
    () => PROVIDER_REGISTRY.map((p) => ({ value: p.id, label: PROVIDER_LABELS[p.id] || p.id })),
    [],
  );
  const effortOptions = useMemo(
    () => [
      { value: 'low', label: 'Low' },
      { value: 'medium', label: 'Medium' },
      { value: 'high', label: 'High' },
      { value: 'xhigh', label: 'Extra High' },
    ],
    [],
  );

  // Load provider/model from global settings (skip if parent provided cached values)
  useEffect(() => {
    if (cachedSettings) {
      setChatProvider(cachedSettings.provider);
      setChatModel(cachedSettings.model);
      setChatModelOptions(cachedSettings.modelOptions);
      setChatEffort(cachedSettings.effort);
      return;
    }
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
        // Build model options for loaded provider
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
        const options = Array.from(optionMap.entries()).map(([value, label]) => ({ value, label }));
        const selected = options.some((o) => o.value === fallbackModel) ? fallbackModel : (options[0]?.value || '');
        // Apply agent default model (overrides global settings, can be overridden by session config)
        const effectiveProvider = agent.defaultProvider ?? loadedProvider;
        if (agent.defaultProvider) {
          const agentPreset = getProviderPreset(agent.defaultProvider);
          const agentOptionMap = new Map<string, string>();
          for (const m of agentPreset.models) agentOptionMap.set(m.id, m.label || m.id);
          const agentDefaultModel = agent.defaultModel ?? '';
          if (agentDefaultModel && !agentOptionMap.has(agentDefaultModel)) agentOptionMap.set(agentDefaultModel, agentDefaultModel);
          const agentOptions = Array.from(agentOptionMap.entries()).map(([value, label]) => ({ value, label }));
          const agentSelected = agentOptions.some(o => o.value === agentDefaultModel)
            ? agentDefaultModel
            : agentOptions[0]?.value || '';
          setChatProvider(effectiveProvider);
          setChatModelOptions(agentOptions.length > 0 ? agentOptions : options);
          setChatModel(agentSelected || selected);
        } else {
          setChatProvider(loadedProvider);
          setChatModelOptions(options);
          setChatModel(selected);
        }
        // Load OpenAI reasoning effort
        const VALID_EFFORTS: OpenAIReasoningEffort[] = ['low', 'medium', 'high', 'xhigh'];
        const savedEffort = claude.openaiReasoningEffort;
        if (typeof savedEffort === 'string' && VALID_EFFORTS.includes(savedEffort as OpenAIReasoningEffort)) {
          setChatEffort(savedEffort as OpenAIReasoningEffort);
        }
      } catch {
        // ignore
      }
    })();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Update model options when provider changes (+ fetch OpenAI catalog)
  useEffect(() => {
    let cancelled = false;
    const preset = getProviderPreset(chatProvider);
    const staticOptions = preset.models.map((m) => ({ value: m.id, label: m.label || m.id }));

    if (chatProvider === 'openai') {
      // 立即显示静态选项，不等待网络请求
      setChatModelOptions(staticOptions);
      if (!staticOptions.some((o) => o.value === chatModel)) {
        setChatModel(staticOptions[0]?.value || '');
      }

      // 检查缓存（5 分钟 TTL），命中则直接用，不发请求
      const cache = openaiModelsCacheRef.current;
      if (cache && Date.now() - cache.cachedAt < OPENAI_MODELS_CACHE_TTL) {
        setChatModelOptions(cache.options);
        return () => { cancelled = true; };
      }

      // 后台 fetch 动态模型目录，merge 到静态选项里
      (async () => {
        try {
          const res = await fetch('/api/settings/openai-models', { cache: 'no-store' });
          const data = await res.json();
          if (cancelled) return;
          if (res.ok && data?.ok && Array.isArray(data.models)) {
            const merged = [...staticOptions];
            const knownIds = new Set(merged.map((o) => o.value));
            for (const r of data.models) {
              if (r && typeof r === 'object' && typeof r.id === 'string') {
                const id = r.id.trim();
                if (id && !knownIds.has(id)) {
                  merged.push({ value: id, label: typeof r.displayName === 'string' ? r.displayName : id });
                  knownIds.add(id);
                }
              }
            }
            if (!cancelled) {
              openaiModelsCacheRef.current = { options: merged, cachedAt: Date.now() };
              setChatModelOptions(merged);
            }
          }
        } catch {
          // ignore - fallback to static models already shown
        }
      })();
    } else {
      if (staticOptions.length > 0) {
        setChatModelOptions(staticOptions);
        if (!staticOptions.some((o) => o.value === chatModel)) {
          setChatModel(staticOptions[0].value);
        }
      }
    }
    return () => { cancelled = true; };
  }, [chatProvider]); // eslint-disable-line react-hooks/exhaustive-deps

  // 模型切换时立即更新 contextWindow（纯本地计算，无需网络请求）
  useEffect(() => {
    setContextWindow(getModelContextWindow(chatModel || 'claude-sonnet-4-6'));
  }, [chatModel]);

  // Fetch prompt info (system prompt size)
  // 注意：estimatedTokens 只依赖 agent/project，与 model 无关；contextWindow 已在上方本地计算。
  // 因此切换 model 时无需重新 fetch，只在 agent 或 project 变化时才请求。
  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ agentId: agent.id });
    if (projectKey) params.set('projectKey', projectKey);

    (async () => {
      try {
        const res = await fetch(`/api/agent-chat/prompt-info?${params}`, { cache: 'no-store' });
        if (cancelled || !res.ok) return;
        const data = await res.json();
        if (!cancelled) {
          setPromptEstimate(data.estimatedTokens ?? 0);
        }
      } catch {
        // ignore - fallback to local estimate
      }
    })();

    return () => { cancelled = true; };
  }, [agent.id, projectKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch session list
  const fetchSessionList = useCallback(async (agentId: string, pk?: string | null) => {
    try {
      let url = `/api/agent-chat/sessions?agentId=${agentId}`;
      if (pk) url += `&projectKey=${pk}`;
      const res = await fetch(url, { cache: 'no-store' });
      const data = await res.json();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const remote: SessionListItem[] = (data.sessions ?? []).map((s: any) => ({
        ...s,
        isAwaiting: s.execution?.status === 'awaiting' || undefined,
      }));
      setSessionList((prev) => mergeSessionList(prev, remote));
      return remote;
    } catch {
      return [];
    }
  }, []);

  const markSessionRunning = useCallback((targetSessionId: string, startedAt?: string, title?: string) => {
    const now = new Date().toISOString();
    const runStart = startedAt ?? now;
    setSessionList((prev) => {
      const existing = prev.find((s) => s.id === targetSessionId);
      return upsertSessionListItem(prev, {
        id: targetSessionId,
        title: title ?? existing?.title ?? (hasProject ? t('chat.newSession') : 'New Session'),
        updatedAt: now,
        unreadCount: existing?.unreadCount ?? 0,
        isRunning: true,
        isAwaiting: undefined,
        runningStartedAt: runStart,
      });
    });
    // Notify parent (e.g. agents page sidebar) so it can show running indicator
    onSessionChange?.({
      id: targetSessionId,
      title: title ?? sessionTitle,
      updatedAt: now,
      isRunning: true,
      runningStartedAt: runStart,
    });
  }, [hasProject, t, onSessionChange, sessionTitle]);

  const clearSessionRunning = useCallback((targetSessionId: string, opts?: {
    updatedAt?: string;
    /** Proactively set unreadCount (for sessions the user is NOT currently viewing) */
    unreadCount?: number;
    /** Title override (for stale streams where sessionTitle may have changed) */
    title?: string;
  }) => {
    const ts = opts?.updatedAt ?? new Date().toISOString();
    const extraPatch: Partial<SessionListItem> = {
      updatedAt: ts,
      isRunning: false,
      isAwaiting: undefined,
      runningStartedAt: undefined,
    };
    if (opts?.unreadCount !== undefined) {
      extraPatch.unreadCount = opts.unreadCount;
    }
    setSessionList((prev) => patchSessionListItem(prev, targetSessionId, extraPatch));
    // Notify parent so it can clear running indicator and fetch updated state
    onSessionChange?.({
      id: targetSessionId,
      title: opts?.title ?? sessionTitle,
      updatedAt: ts,
      isRunning: false,
      unreadCount: opts?.unreadCount,
    });
  }, [onSessionChange, sessionTitle]);

  // Load parent/child session navigation links
  const loadSessionNavLinks = useCallback(async (sid: string, parentSid?: string) => {
    setParentSession(null);
    setChildSessions([]);
    setShowChildList(false);

    // Parent session
    if (parentSid) {
      try {
        const res = await fetch(`/api/agent-chat/sessions/${parentSid}`, { cache: 'no-store' });
        if (res.ok) {
          const ps = await res.json();
          setParentSession({ id: ps.id, title: ps.title, agentId: ps.agentId });
        }
      } catch { /* ignore */ }
    }

    // Child sessions
    try {
      const res = await fetch(`/api/agent-chat/sessions/${sid}/children`, { cache: 'no-store' });
      if (res.ok) {
        const { children } = await res.json();
        if (Array.isArray(children) && children.length > 0) {
          setChildSessions(children.map((c: { id: string; title: string; agentId: string }) => ({
            id: c.id, title: c.title, agentId: c.agentId,
          })));
        }
      }
    } catch { /* ignore */ }
  }, []);

  // Load a session's full data (messages + config)
  const loadSessionData = useCallback(async (sid: string, token?: number) => {
    try {
      const res = await fetch(`/api/agent-chat/sessions/${sid}`, { cache: 'no-store' });
      if (!res.ok) return;
      if (token !== undefined && initTokenRef.current !== token) return;
      const data = await res.json();
      let messages: Array<{ role: 'user' | 'assistant'; content: string; contentBlocks?: ContentBlock[] }> = data.messages ?? [];

      // Defensive: if disk data ends with a user message (assistant reply may not
      // have been persisted yet), check in-memory status for up-to-date messages.
      if (messages.length > 0 && messages[messages.length - 1].role === 'user') {
        try {
          const statusRes = await fetch(`/api/agent-chat/status?sessionId=${sid}`, { cache: 'no-store' });
          if (statusRes.ok) {
            const statusData = await statusRes.json();
            if (Array.isArray(statusData.messages) && statusData.messages.length > messages.length) {
              messages = statusData.messages;
            }
          }
        } catch { /* ignore fallback failure */ }
      }

      const restored: ChatMessage[] = messages.map(
        (m: { role: 'user' | 'assistant'; content: string; contentBlocks?: ContentBlock[] }, i: number) => ({
          id: `restored-${i}`,
          role: m.role,
          content: m.content,
          contentBlocks: m.contentBlocks,
          timestamp: '',
        }),
      );
      setMessages(restored);
      setSessionTitle(data.title ?? 'New Session');
      const loadedConfig = data.config ?? {};
      setSessionConfig(loadedConfig);
      const loadedQueueState = data.pendingUserQueue as PendingUserQueueState | undefined;
      const loadedQueue = Array.isArray(loadedQueueState?.items)
        ? clonePendingQueueItems(loadedQueueState.items)
        : [];
      replacePendingUserQueue(loadedQueue);
      setQueueExpanded(loadedQueueState?.expanded !== false);
      // Session model config has highest priority (overrides agent default and global settings)
      if (loadedConfig.provider) {
        setChatProvider(loadedConfig.provider);
        const sessionPreset = getProviderPreset(loadedConfig.provider);
        const sessionOptionMap = new Map<string, string>();
        for (const m of sessionPreset.models) sessionOptionMap.set(m.id, m.label || m.id);
        if (loadedConfig.model && !sessionOptionMap.has(loadedConfig.model)) {
          sessionOptionMap.set(loadedConfig.model, loadedConfig.model);
        }
        const sessionOptions = Array.from(sessionOptionMap.entries()).map(([value, label]) => ({ value, label }));
        if (sessionOptions.length > 0) setChatModelOptions(sessionOptions);
        if (loadedConfig.model) setChatModel(loadedConfig.model);
      }

      // 加载父子会话导航信息（fire-and-forget，不阻塞主流程）
      loadSessionNavLinks(sid, data.parentSessionId);
    } catch {
      // ignore
    }
  }, [loadSessionNavLinks, replacePendingUserQueue]);

  // Finalize streaming -> commit assistant message
  const finalizeStream = useCallback(() => {
    if (finalizingRef.current) return;
    finalizingRef.current = true;

    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = 0;
    }

    // Guard: if session has switched, discard accumulated data instead of committing
    const streamTarget = streamTargetSessionRef.current;
    const isStaleStream = streamTarget !== null && streamTarget !== sessionIdRef.current;

    const fullText = fullTextRef.current;
    const toolCalls = toolCallsRef.current;
    const blocks = blocksRef.current;

    // Use flushSync to ensure streaming bubble is cleared before committing final message.
    flushSync(() => {
      setIsStreaming(false);
      setStreamingBlocks([]);
      setInPlanMode(false);
    });

    if (!isStaleStream && (fullText || toolCalls.length > 0)) {
      const cleanedText = stripSessionTitleTag(fullText);
      const assistantMsg: ChatMessage = {
        id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        role: 'assistant',
        content: cleanedText,
        timestamp: new Date().toISOString(),
        toolCalls: toolCalls.length > 0 ? [...toolCalls] : undefined,
        contentBlocks: blocks.length > 0 ? [...blocks] : undefined,
      };
      setMessages((prev) => [...prev, assistantMsg]);
    }
    blocksRef.current = [];
    fullTextRef.current = '';
    toolCallsRef.current = [];
    lastEventIdxRef.current = -1;
    streamAbortRef.current = null;
    streamTargetSessionRef.current = null;
    finalizingRef.current = false;

    const currentSid = sessionIdRef.current;

    if (isStaleStream && streamTarget) {
      // Stream completed for a session the user is NOT currently viewing
      // → proactively set unreadCount so the badge appears immediately
      clearSessionRunning(streamTarget, { unreadCount: 1 });
    } else if (currentSid) {
      // Stream completed for the session the user IS viewing
      // → no unread badge needed; also call markAsRead to reset any backend count
      clearSessionRunning(currentSid);
      fetch(`/api/agent-chat/sessions/${currentSid}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'markAsRead' }),
      }).catch(() => {});
    }

    // Refresh session list to get AI-generated title
    fetchSessionList(agent.id, projectKey).then((sessions: SessionListItem[]) => {
      const current = sessions.find((s: SessionListItem) => s.id === currentSid);
      if (current) {
        setSessionTitle(current.title);
      }
    });

    // Notify parent to refresh sidebar sessions
    onSessionChange?.();

    // Delayed re-fetch to sync with backend persistence (unreadCount, title, etc.)
    setTimeout(() => {
      onSessionChange?.();
    }, 2000);

    // Auto-send queued AskUserQuestion answer from the previous turn
    const pending = pendingAnswerRef.current;
    pendingAnswerRef.current = null;
    if (pending && pending.targetSessionId === sessionIdRef.current) {
      setTimeout(() => {
        // Re-check session match and visibility inside timeout to prevent stale sends
        if (pending.targetSessionId === sessionIdRef.current && scrollRef.current?.offsetParent !== null) {
          doSendRef.current(pending.answer);
        }
      }, 300);
      return;
    }

    if (currentSid) {
      flushQueuedUserMessage(currentSid);
    }

    // Send completion notification (for both active and background sessions)
    const completedSid = isStaleStream ? streamTarget : currentSid;
    if (completedSid && (fullText || toolCalls.length > 0)) {
      notifyCompletion({
        agentName: agent.name || agent.id,
        sessionId: completedSid,
        sessionTitle: sessionTitle || 'Untitled Session',
        navigateToSession: () => {
          // Navigate to this session if needed
          const sessionUrl = buildSessionUrl(agent.id, completedSid);
          router.push(sessionUrl);
        },
      }).catch(err => console.error('通知发送失败:', err));
    }
  }, [agent.id, agent.name, projectKey, fetchSessionList, onSessionChange, flushQueuedUserMessage, router, sessionTitle, notifyCompletion]);

  // Connect to SSE stream
  const connectToStream = useCallback((targetSessionId: string, since: number) => {
    if (streamAbortRef.current) {
      streamAbortRef.current.abort();
    }

    // Track which session this stream belongs to
    streamTargetSessionRef.current = targetSessionId;

    const abort = new AbortController();
    streamAbortRef.current = abort;

    fetch(`/api/agent-chat/stream?sessionId=${targetSessionId}&since=${since}`, {
      signal: abort.signal,
      cache: 'no-store',
    }).then(async (res) => {
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const blocks = blocksRef.current;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // Guard: if user switched away from this session, stop processing
        if (sessionIdRef.current !== targetSessionId) {
          reader.cancel();
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        let chunkHasDisplayEvents = false;

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.slice(6).trim();
          if (!jsonStr) continue;

          let raw: IndexedSSEEvent;
          try {
            raw = JSON.parse(jsonStr);
          } catch {
            continue;
          }

          if (typeof raw._idx === 'number') {
            lastEventIdxRef.current = raw._idx;
          }

          const event = raw as unknown as ChatSSEEvent;

          switch (event.type) {
            case 'text_delta': {
              fullTextRef.current += event.text;
              const lastBlock = blocks[blocks.length - 1];
              if (lastBlock && lastBlock.type === 'text') {
                lastBlock.text += event.text;
              } else {
                blocks.push({ type: 'text', text: event.text });
              }
              chunkHasDisplayEvents = true;
              break;
            }

            case 'tool_use_start': {
              const tc: ChatToolCall = {
                id: event.id,
                toolName: event.toolName,
                input: event.input,
                status: 'running',
              };
              toolCallsRef.current.push(tc);
              blocks.push({ type: 'tool_call', toolCall: tc });
              chunkHasDisplayEvents = true;

              // Detect Write to .claude/plans/ -> capture plan content
              if (event.toolName === 'Write') {
                try {
                  const parsed = typeof event.input === 'string' ? JSON.parse(event.input) : event.input;
                  const fp = (parsed?.file_path ?? '').replace(/\\/g, '/');
                  if (fp.includes('.claude/plans/')) {
                    setPlanContent(parsed.content);
                    setIsPlanOpen(true);
                  }
                } catch { /* ignore parse errors */ }
              }
              // Track plan mode state
              if (event.toolName === 'EnterPlanMode') {
                setInPlanMode(true);
              }
              break;
            }

            case 'tool_use_end': {
              const tc = toolCallsRef.current.find((t) => t.id === event.id);
              if (tc) {
                tc.output = event.output;
                tc.status = event.status;
                chunkHasDisplayEvents = true;

                // ExitPlanMode -> extract plan content from output as fallback
                if (tc.toolName === 'ExitPlanMode') {
                  setInPlanMode(false);
                  const out = (event.output ?? '').trim();
                  if (out.length > 50) {
                    setPlanContent(out);
                    setIsPlanOpen(true);
                  }
                }
              }
              break;
            }

            case 'session_title_set':
              setSessionTitle(event.title);
              setSessionList((prev) => patchSessionListItem(prev, targetSessionId, {
                title: event.title,
                updatedAt: new Date().toISOString(),
              }));
              // Notify parent immediately to update sidebar title.
              onSessionChange?.({
                id: targetSessionId,
                title: event.title,
                updatedAt: new Date().toISOString(),
              });
              break;

            case 'knowledge_draft_created':
              setKnowledgeDrafts(prev => [...prev, { entryId: event.entryId, label: event.label }]);
              break;

            case 'doc_created':
              setDocsSaved(prev => [...prev, { docId: event.docId, title: event.title, projectKey: event.projectKey }]);
              break;

            case 'token_usage':
              if (event.inputTokens > 0) setTokenInputs(event.inputTokens);
              if (event.outputTokens > 0) setTokenOutputs(event.outputTokens);
              if (event.contextWindow && event.contextWindow > 0) setContextWindow(event.contextWindow);
              break;

            case 'error':
              console.error('Agent chat stream error:', event.message);
              setErrorMsg(event.message ?? 'Stream error');
              break;

            case 'awaiting_sub_agents':
              // Session entered awaiting state — stop stream but mark as awaiting
              setSessionList((prev) =>
                prev.map((s) =>
                  s.id === streamTargetSessionRef.current
                    ? { ...s, isRunning: false, isAwaiting: true, runningStartedAt: undefined }
                    : s,
                ),
              );
              break;

            case 'done':
              break;
          }
        }

        if (chunkHasDisplayEvents && !rafIdRef.current) {
          rafIdRef.current = requestAnimationFrame(() => {
            rafIdRef.current = 0;
            startTransition(() => {
              setStreamingBlocks([...blocksRef.current]);
            });
          });
        }
      }

      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = 0;
      }
      finalizeStream();
    }).catch((err) => {
      if ((err as Error).name === 'AbortError') return;
      console.error('Agent chat stream connection failed:', err);
      setErrorMsg(`Stream connection failed: ${(err as Error).message}`);
      finalizeStream();
    });
  }, [finalizeStream]);

  // Reset state helper
  const resetState = useCallback(() => {
    setMessages([]);
    setIsStreaming(false);
    setStreamingBlocks([]);
    setErrorMsg(null);
    setInPlanMode(false);
    setSessionIdSync(null);
    setSessionTitle(hasProject ? t('chat.newSession') : 'New Session');
    setSessionList([]);
    setTokenInputs(0);
    setTokenOutputs(0);
    setQueueExpanded(true);
    pendingUserMessagesRef.current = [];
    setPendingUserMessages([]);
    setPendingUserQueueCount(0);
    blocksRef.current = [];
    fullTextRef.current = '';
    toolCallsRef.current = [];
    lastEventIdxRef.current = -1;
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = 0;
    }
    if (streamAbortRef.current) {
      streamAbortRef.current.abort();
      streamAbortRef.current = null;
    }
  }, [hasProject, t, setSessionIdSync]);

  // Initialize: load sessions and auto-select
  useEffect(() => {
    let cancelled = false;
    const token = ++initTokenRef.current;
    const isStale = () => cancelled || initTokenRef.current !== token;

    resetState();

    // In project mode without projectKey, nothing to load
    if (hasProject && !projectKey) return;

    // Plain mode with null initialSessionId -> new empty session
    if (!hasProject && initialSessionId === null) return;

    // Helper: reconnect to a running stream
    const reconnectRunning = (sid: string, statusData: {
      messages?: Array<{ role: 'user' | 'assistant'; content: string; contentBlocks?: ContentBlock[] }>;
      startedAt?: string;
    }) => {
      if (Array.isArray(statusData.messages) && statusData.messages.length > 0) {
        const restored: ChatMessage[] = statusData.messages.map(
          (m: { role: 'user' | 'assistant'; content: string; contentBlocks?: ContentBlock[] }, i: number) => ({
            id: `restored-${i}`,
            role: m.role,
            content: m.content,
            contentBlocks: m.contentBlocks,
            timestamp: '',
          }),
        );
        setMessages(restored);
      }
      markSessionRunning(sid, statusData.startedAt);
      setIsStreaming(true);
      blocksRef.current = [];
      fullTextRef.current = '';
      toolCallsRef.current = [];
      connectToStream(sid, 0);
    };

    (async () => {
      // ── Fast path: agents page with specific session (skip session list fetch) ──
      if (!hasProject && initialSessionId) {
        setSessionIdSync(initialSessionId);
        // Parallel: load session data + check status
        const [, statusRes] = await Promise.all([
          loadSessionData(initialSessionId, token),
          fetch(`/api/agent-chat/status?sessionId=${initialSessionId}`, { cache: 'no-store' }),
        ]);
        if (isStale()) return;
        try {
          const statusData = await statusRes.json();
          if (statusData.status === 'running') {
            reconnectRunning(initialSessionId, statusData);
          }
        } catch { /* ignore status parse failure */ }
        return;
      }

      // Standard path: butler/project mode; need session list
      const sessions: SessionListItem[] = await fetchSessionList(agent.id, projectKey);
      if (isStale()) return;

      if (sessions.length > 0) {
        // Auto-select latest
        const latest = sessions[0];
        setSessionIdSync(latest.id);
        setSessionTitle(latest.title);
        // Parallel: load session data + check status for latest
        const [, statusRes] = await Promise.all([
          loadSessionData(latest.id, token),
          fetch(`/api/agent-chat/status?sessionId=${latest.id}`, { cache: 'no-store' }),
        ]);
        if (isStale()) return;
        try {
          const statusData = await statusRes.json();
          if (statusData.status === 'running') {
            reconnectRunning(latest.id, statusData);
            return;
          }
        } catch { /* ignore */ }

        // If latest isn't running, check remaining sessions
        for (let i = 1; i < sessions.length; i++) {
          if (isStale()) return;
          const sid = sessions[i].id;
          const res = await fetch(`/api/agent-chat/status?sessionId=${sid}`, { cache: 'no-store' });
          const data = await res.json();
          if (!isStale() && data.status === 'running') {
            setSessionIdSync(sid);
            setSessionTitle(sessions[i].title);
            await loadSessionData(sid, token);
            if (isStale()) return;
            reconnectRunning(sid, data);
            break;
          }
        }
      }
    })();

    return () => {
      cancelled = true;
      if (initTokenRef.current === token) {
        initTokenRef.current += 1;
      }
      if (streamAbortRef.current) {
        streamAbortRef.current.abort();
        streamAbortRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.id, projectKey]);

  useEffect(() => {
    if (!sessionId || isStreaming || pendingUserQueueCount === 0) return;
    const timer = window.setTimeout(() => {
      if (sessionIdRef.current !== sessionId) return;
      if (isStreamingRef.current) return;
      flushQueuedUserMessage(sessionId, 0);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [sessionId, isStreaming, pendingUserQueueCount, flushQueuedUserMessage]);

  // Smart auto-scroll: pause when user scrolls up, resume when near bottom
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRafRef = useRef<number>(0);

  const handleChatScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 40;
    setAutoScroll(isNearBottom);
  }, []);

  useEffect(() => {
    if (!autoScroll) return;
    if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current);
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = 0;
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    });
  }, [messages, streamingBlocks, autoScroll]);

  // Send message
  const doSend = useCallback(async (text: string, images?: string[]) => {
    if (!text.trim() && (!images || images.length === 0)) return;
    if (isStreaming) return;
    if (hasProject && !projectKey) return;

    // Cancel background init loaders to avoid stale session data overriding active chat
    initTokenRef.current += 1;

    const imagesToSend = images ?? [];
    const imageAttachments = imagesToSend.map(imageAttachmentFromDataUrl);

    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      role: 'user',
      content: text.trim(),
      timestamp: new Date().toISOString(),
      images: imagesToSend.length > 0 ? imagesToSend : undefined,
    };

    setMessages((prev) => {
      // Fold duplicate: if the last message is an unanswered user message with identical content,
      // replace it instead of appending (handles manual resend after network/auth errors)
      const last = prev[prev.length - 1];
      if (last?.role === 'user' && last.content === userMsg.content) {
        return [...prev.slice(0, -1), userMsg];
      }
      return [...prev, userMsg];
    });
    setAutoScroll(true);
    setIsStreaming(true);
    blocksRef.current = [];
    fullTextRef.current = '';
    toolCallsRef.current = [];
    lastEventIdxRef.current = -1;
    setStreamingBlocks([]);

    setErrorMsg(null);

    // For new sessions: generate sessionId + update UI immediately (before fetch)
    let targetSessionId = sessionId;
    if (!targetSessionId) {
      targetSessionId = `agent-chat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const quickTitle = text.trim().slice(0, 10) || (hasProject ? t('chat.newSession') : 'New Session');
      setSessionIdSync(targetSessionId);
      setSessionTitle(quickTitle);
      // Insert into session list immediately so it appears in history
      const newItem: SessionListItem = {
        id: targetSessionId!,
        title: quickTitle,
        updatedAt: new Date().toISOString(),
      };
      setSessionList((prev) => upsertSessionListItem(prev, newItem));
      onSessionChange?.(newItem);
    }

    markSessionRunning(
      targetSessionId,
      new Date().toISOString(),
      text.trim().slice(0, 10) || sessionTitle,
    );

    try {
      // Expand /skill-name command into skill body before sending to backend.
      let messageToSend = text.trim();
      const slashMatch = messageToSend.match(/^\/(\S+)([\s\S]*)$/);
      if (slashMatch) {
        const skillName = slashMatch[1];
        const extraText = slashMatch[2].trim();
        try {
          const skillRes = await fetch(`/api/skills/${encodeURIComponent(skillName)}`);
          if (skillRes.ok) {
            const skillData = await skillRes.json() as { content?: string };
            const skillBody = (skillData.content ?? '').replace(/^---[\s\S]*?---\r?\n/, '').trim();
            if (skillBody) {
              messageToSend = extraText ? `${skillBody}\n\n${extraText}` : skillBody;
            }
          }
        } catch { /* keep original text if skill fetch fails */ }
      }

      const res = await fetch('/api/agent-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: agent.id,
          message: messageToSend,
          sessionId: targetSessionId,
          projectKey: projectKey ?? undefined,
          providerOverride: chatProvider,
          modelOverride: chatModel || undefined,
          effortOverride: chatProvider === 'openai' ? chatEffort : undefined,
          images: imageAttachments.length > 0 ? imageAttachments : undefined,
          initialTitle: text.trim().slice(0, 10) || undefined,
          config: (() => {
            // 将当前模型选择持久化到 session config（优先级最高）
            const configWithModel = {
              ...sessionConfig,
              provider: chatProvider,
              model: chatModel || undefined,
            };
            const hasAny = configWithModel.contextIds?.length || configWithModel.supplementaryPrompt?.trim() || configWithModel.provider || configWithModel.model;
            return hasAny ? configWithModel : undefined;
          })(),
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${res.status}`);
      }

      await res.json();
      if (pendingUserMessagesRef.current.length > 0) {
        persistPendingUserQueue(targetSessionId, pendingUserMessagesRef.current);
      }
      connectToStream(targetSessionId, 0);
    } catch (err) {
      const msg = (err as Error).message || 'Unknown error';
      console.error('Agent chat send failed:', msg);
      setErrorMsg(msg);
      setIsStreaming(false);
      clearSessionRunning(targetSessionId);
    }
  }, [agent.id, sessionId, isStreaming, hasProject, projectKey, chatProvider, chatModel, chatEffort, connectToStream, onSessionChange, t, sessionConfig, setSessionIdSync, persistPendingUserQueue, sessionTitle, markSessionRunning, clearSessionRunning]);

  // Keep doSendRef in sync (avoid stale closure in event listener)
  useEffect(() => {
    doSendRef.current = doSend;
  }, [doSend]);

  // Listen for AskUserQuestion answers dispatched via custom event.
  // If streaming is still in progress, queue the answer and send it
  // once the current turn finishes (via finalizeStream).
  useEffect(() => {
    const handler = (e: Event) => {
      // Only the visible panel should handle the answer (agents page mounts multiple hidden instances)
      if (scrollRef.current?.offsetParent === null) return;

      const answer = (e as CustomEvent<{ answer: string }>).detail?.answer;
      if (!answer) return;

      // If streaming is active, queue the answer bound to the current session
      if (isStreamingRef.current) {
        pendingAnswerRef.current = { answer, targetSessionId: sessionIdRef.current! };
      } else {
        doSendRef.current(answer);
      }
    };
    window.addEventListener('ask-user-answer', handler);
    return () => window.removeEventListener('ask-user-answer', handler);
  }, []);

  // Listen for toggle-session-config event (from parent page header)
  useEffect(() => {
    const handler = () => setShowConfig(v => !v);
    window.addEventListener('toggle-session-config', handler);
    return () => window.removeEventListener('toggle-session-config', handler);
  }, []);

  // Listen for toggle-folder-explorer event (from parent page header)
  useEffect(() => {
    const handler = () => setShowFolderExplorer(v => !v);
    window.addEventListener('toggle-folder-explorer', handler);
    return () => window.removeEventListener('toggle-folder-explorer', handler);
  }, []);

  // Listen for toggle-session-compress event (from parent page header)
  // Only respond if sessionId matches (prevents butler panel from also opening)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.sessionId && detail.sessionId !== sessionIdRef.current) return;
      if (scrollRef.current?.offsetParent === null) return;
      if (messages.length >= 6 && !isStreaming) setCompressDialogOpen(true);
    };
    window.addEventListener('toggle-session-compress', handler);
    return () => window.removeEventListener('toggle-session-compress', handler);
  }, [messages.length, isStreaming]);

  // ChatInput submit handler
  const handleChatInputSubmit = useCallback((text: string, images: string[], _files: Array<{ name: string; content: string }>) => {
    const hasPayload = !!text.trim() || images.length > 0;
    if (!hasPayload) return;

    // Allow user to continue submitting while streaming: queue and auto-send later.
    if (isStreamingRef.current && sessionIdRef.current) {
      const sid = sessionIdRef.current;
      replacePendingUserQueue([...pendingUserMessagesRef.current, {
        text,
        images: images.length > 0 ? images : undefined,
      }], { persist: true, sessionId: sid });
      return;
    }

    doSend(text, images);
  }, [doSend, replacePendingUserQueue]);

  const handleAbort = async () => {
    if (!sessionId) return;
    try {
      await fetch('/api/agent-chat/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
    } catch (err) {
      console.error('Failed to stop agent chat:', err);
    }
    if (streamAbortRef.current) {
      streamAbortRef.current.abort();
      streamAbortRef.current = null;
    }
    clearSessionRunning(sessionId);
    finalizeStream();
  };

  // Send a queued message immediately (interrupt current reply)
  const handleSendNow = useCallback(async (index: number) => {
    if (!sessionId) return;
    const item = pendingUserMessagesRef.current[index];
    if (!item) return;
    replacePendingUserQueue(
      pendingUserMessagesRef.current.filter((_, itemIndex) => itemIndex !== index),
      { persist: true, sessionId },
    );
    try {
      await fetch('/api/agent-chat/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
    } catch {
      // ignore
    }
    if (streamAbortRef.current) {
      streamAbortRef.current.abort();
      streamAbortRef.current = null;
    }
    finalizeStream();
    doSendRef.current(item.text, item.images);
  }, [sessionId, finalizeStream, replacePendingUserQueue]);

  // Remove a queued message without sending
  const handleRemoveFromQueue = useCallback((index: number) => {
    if (!sessionId) return;
    if (!pendingUserMessagesRef.current[index]) return;
    replacePendingUserQueue(
      pendingUserMessagesRef.current.filter((_, itemIndex) => itemIndex !== index),
      { persist: true, sessionId },
    );
  }, [sessionId, replacePendingUserQueue]);

  // Delete current session
  const handleDelete = async () => {
    if (isStreaming || !sessionId) return;
    try {
      await fetch(`/api/agent-chat/sessions?sessionId=${sessionId}`, { method: 'DELETE' });
    } catch {
      // ignore
    }
    setSessionList(prev => prev.filter(s => s.id !== sessionId));
    handleNewSession();
  };

  // Switch to a new (empty) session
  // Save session config
  const handleSaveConfig = useCallback(async (config: SessionConfig) => {
    setSessionConfig(config);
    // Sync model/provider to chat panel state if session config has them
    if (config.provider) {
      setChatProvider(config.provider);
      const cfgPreset = getProviderPreset(config.provider);
      const cfgOptionMap = new Map<string, string>();
      for (const m of cfgPreset.models) cfgOptionMap.set(m.id, m.label || m.id);
      if (config.model && !cfgOptionMap.has(config.model)) cfgOptionMap.set(config.model, config.model);
      const cfgOptions = Array.from(cfgOptionMap.entries()).map(([value, label]) => ({ value, label }));
      if (cfgOptions.length > 0) setChatModelOptions(cfgOptions);
      if (config.model) setChatModel(config.model);
    }
    // Persist to backend if session exists on disk
    if (sessionId) {
      try {
        await fetch(`/api/agent-chat/sessions/${sessionId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'updateConfig', config }),
        });
      } catch {
        // ignore - config is already in local state for next message
      }
    }
  }, [sessionId]);

  const handleNewSession = useCallback(() => {
    if (isStreaming) return;
    initTokenRef.current += 1;
    if (streamAbortRef.current) {
      streamAbortRef.current.abort();
      streamAbortRef.current = null;
    }
    setSessionIdSync(null);
    setSessionTitle(hasProject ? t('chat.newSession') : 'New Session');
    setMessages([]);
    setSessionConfig({});
    setShowConfig(false);
    setCompressDismissed(false);
    setParentSession(null);
    setChildSessions([]);
    setShowChildList(false);
    replacePendingUserQueue([]);
    setQueueExpanded(true);
    blocksRef.current = [];
    fullTextRef.current = '';
    toolCallsRef.current = [];
    // Reset model to agent default (session config cleared, fall back to agent/global defaults)
    if (agent.defaultProvider) {
      setChatProvider(agent.defaultProvider);
      const agentPreset = getProviderPreset(agent.defaultProvider);
      const agentOptions = agentPreset.models.map(m => ({ value: m.id, label: m.label || m.id }));
      if (agentOptions.length > 0) setChatModelOptions(agentOptions);
      if (agent.defaultModel) {
        setChatModel(agent.defaultModel);
      } else if (agentOptions.length > 0) {
        setChatModel(agentOptions[0].value);
      }
    }
  }, [isStreaming, hasProject, t, setSessionIdSync, agent, replacePendingUserQueue]);

  // Switch to an existing session
  const handleSwitchSession = useCallback(async (target: SessionListItem) => {
    if (isStreaming) return;
    initTokenRef.current += 1;
    const token = initTokenRef.current;
    if (streamAbortRef.current) {
      streamAbortRef.current.abort();
      streamAbortRef.current = null;
    }
    setSessionIdSync(target.id);
    setSessionTitle(target.title);
    setMessages([]);
    setSessionConfig({});
    setShowConfig(false);
    setCompressDismissed(false);
    setTokenInputs(0);
    setTokenOutputs(0);
    blocksRef.current = [];
    fullTextRef.current = '';
    toolCallsRef.current = [];
    // Clear any queued answer from the previous session's AskUserQuestion
    pendingAnswerRef.current = null;
    replacePendingUserQueue([]);
    setQueueExpanded(true);
    // Mark as read
    if (target.unreadCount) {
      setSessionList((prev) => patchSessionListItem(prev, target.id, { unreadCount: 0 }));
      fetch(`/api/agent-chat/sessions/${target.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'markAsRead' }),
      }).catch(() => {});
    }
    await loadSessionData(target.id, token);
  }, [isStreaming, loadSessionData, setSessionIdSync, replacePendingUserQueue]);

  const handleSaveAsKnowledge = useCallback((_messageId: string, content: string) => {
    setSaveDialogContent(content);
  }, []);

  // Compress: confirm handler (dialog persists changes internally)
  const handleCompressConfirm = useCallback((compressedMessages: ChatMessage[]) => {
    setMessages(compressedMessages);
    setCompressDialogOpen(false);
  }, []);

  // Delete a single message from the conversation
  const handleDeleteMessage = useCallback((messageId: string) => {
    setMessages(prev => prev.filter(m => m.id !== messageId));
  }, []);

  // Branch: create a new session from this message and switch to it.
  // Works even during streaming — aborts the current stream before switching.
  const handleBranch = useCallback(async (messageId: string) => {
    const currentSessionId = sessionIdRef.current;
    if (!currentSessionId) return;
    const currentMessages = messagesRef.current;
    const msgIndex = currentMessages.findIndex(m => m.id === messageId);
    if (msgIndex < 0) return;
    try {
      const res = await fetch('/api/agent-chat/sessions/branch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceSessionId: currentSessionId,
          branchAtIndex: msgIndex,
          frontendMessageCount: currentMessages.length,
        }),
      });
      if (!res.ok) return;
      const data = await res.json();
      const newItem: SessionListItem = {
        id: data.sessionId,
        title: data.title,
        updatedAt: new Date().toISOString(),
        unreadCount: 0,
      };
      setSessionList((prev) => upsertSessionListItem(prev, newItem));

      // Abort streaming if active so the session switch is not blocked
      if (streamAbortRef.current) {
        streamAbortRef.current.abort();
        streamAbortRef.current = null;
      }
      flushSync(() => {
        setIsStreaming(false);
        setStreamingBlocks([]);
        setInPlanMode(false);
      });
      blocksRef.current = [];
      fullTextRef.current = '';
      toolCallsRef.current = [];
      streamTargetSessionRef.current = null;
      finalizingRef.current = false;

      // Switch to the branched session inline (bypasses handleSwitchSession's
      // isStreaming guard which could silently skip the switch).
      initTokenRef.current += 1;
      const token = initTokenRef.current;
      setSessionIdSync(newItem.id);
      setSessionTitle(newItem.title);
      setMessages([]);
      setSessionConfig({});
      setShowConfig(false);
      setCompressDismissed(false);
      setTokenInputs(0);
      setTokenOutputs(0);
      pendingAnswerRef.current = null;
      await loadSessionData(newItem.id, token);

      // Notify parent to update sidebar and opened session tab
      onSessionChange?.(newItem);
    } catch {
      // ignore
    }
  }, [loadSessionData, setSessionIdSync, onSessionChange]);

  // Regenerate: remove the last assistant message and resend the last user message
  const handleRegenerate = useCallback(() => {
    if (isStreamingRef.current) return;
    setMessages(prev => {
      // Find the last user message
      const lastUserIdx = prev.reduce((acc, m, i) => (m.role === 'user' ? i : acc), -1);
      if (lastUserIdx === -1) return prev;
      const lastUserMsg = prev[lastUserIdx];
      // Remove all messages after (and including) the last assistant message after this user msg
      const trimmed = prev.slice(0, lastUserIdx + 1);
      // Re-send the user's message
      setTimeout(() => doSendRef.current(lastUserMsg.content), 0);
      // Remove the user msg too since doSend will re-add it
      return trimmed.slice(0, -1);
    });
  }, []);

  // Retry: resend the last user message (for failed sends)
  const handleRetry = useCallback(() => {
    if (isStreamingRef.current) return;
    const currentMessages = messagesRef.current;
    const lastUserMsg = [...currentMessages].reverse().find(m => m.role === 'user');
    if (!lastUserMsg) return;
    // Remove the failed user message and the error, then re-send
    setMessages(prev => prev.filter(m => m.id !== lastUserMsg.id));
    setErrorMsg(null);
    setTimeout(() => doSendRef.current(lastUserMsg.content), 0);
  }, []);

  // Compute the last assistant message ID (for regenerate button positioning)
  const lastAssistantId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') return messages[i].id;
    }
    return null;
  }, [messages]);

  // Whether to show guest picker in ChatInput
  const showGuestPicker = !!sessionId && !isStreaming && messages.length > 0;

  // Dismiss callbacks (stable references)
  const handleDismissKnowledge = useCallback(() => setKnowledgeDrafts([]), []);
  const handleDismissDocs = useCallback(() => setDocsSaved([]), []);
  const handleSelectGuest = useCallback((a: Agent) => setGuestAgent(a), []);

  // View plan from a chat bubble badge
  const handleViewPlan = useCallback((content: string) => {
    setPlanContent(content);
    setIsPlanOpen(true);
  }, []);

  // Open in-app file preview from a clickable path in chat messages
  const handleFileClick = useCallback((filePath: string) => {
    setPreviewFilePath(filePath);
  }, []);

  // Plan side panel element (reused across modes)
  const planPanel = planContent ? (
    <div
      className={`shrink-0 overflow-hidden border-l border-zinc-200 transition-[width] duration-200 ease-in-out dark:border-zinc-800 ${
        isPlanOpen ? 'w-[400px]' : 'w-0 border-l-0'
      }`}
    >
      <div className="h-full w-[400px]">
        <PlanViewerPanel content={planContent} onClose={() => setIsPlanOpen(false)} />
      </div>
    </div>
  ) : null;

  // ── Message list (shared between modes) ──
  const renderMessages = () => (
    <>
      {/* Auto-compress hint */}
      {messages.length > 20 && !compressDismissed && !isStreaming && (
        <div className="mb-2 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2 text-xs dark:border-amber-800 dark:bg-amber-950/30">
          <FileDown className="h-3.5 w-3.5 shrink-0 text-amber-500" />
          <span className="flex-1 text-amber-700 dark:text-amber-400">
            Session is getting long ({messages.length} messages). Compress history to keep context available.
          </span>
          <button
            onClick={() => setCompressDialogOpen(true)}
            className="rounded px-2 py-0.5 text-xs font-medium text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/50"
          >
            压缩
          </button>
          <button
            onClick={() => setCompressDismissed(true)}
            className="rounded px-2 py-0.5 text-xs text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            忽略
          </button>
        </div>
      )}

      {messages.map((msg) => (
        <ChatBubble
          key={msg.id}
          message={msg}
          showActions
          isStreaming={isStreaming}
          onSaveAsKnowledge={handleSaveAsKnowledge}
          onDelete={handleDeleteMessage}
          onRegenerate={handleRegenerate}
          onBranch={handleBranch}
          isLastAssistant={msg.id === lastAssistantId}
          onRetry={handleRetry}
          hasSendError={!!errorMsg && msg.role === 'user' && msg.id === messages[messages.length - 1]?.id}
          onViewPlan={handleViewPlan}
          onFileClick={handleFileClick}
        />
      ))}

      {isStreaming && streamingBlocks.length > 0 && (
        <ChatBubble
          message={streamingMessage}
          streamingBlocks={streamingBlocks}
          isStreaming
        />
      )}

      {isStreaming && streamingBlocks.length === 0 && (
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <Loader2 className="h-3 w-3 animate-spin" />
          {hasProject ? t('chat.thinking') : '思考中...'}
        </div>
      )}

      {inPlanMode && isStreaming && (
        <div className="flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs text-blue-600 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-400">
          <ClipboardList className="h-3.5 w-3.5" />
          <span>AI is planning...</span>
        </div>
      )}

      {errorMsg && !isStreaming && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400">
          {errorMsg}
        </div>
      )}
    </>
  );

  // ── Plain mode (agents page, no variant/projectKey) ──
  if (!hasProject) {
    return (
      <div className="flex h-full">
      <div className="flex h-full flex-1 flex-col min-w-0">
        {/* Messages + Queue overlay — relative wrapper so queue overlays messages only */}
        <div className="relative flex-1 min-h-0">
          <div
            ref={scrollRef}
            onScroll={handleChatScroll}
            className={`h-full space-y-3 overflow-y-auto p-4 ${isStreaming && pendingUserMessages.length > 0 ? 'pb-44' : ''}`}
          >
            {messages.length === 0 && !isStreaming ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-zinc-400">
                <Bot className="h-10 w-10 stroke-1" />
                <p className="text-sm">Send a message to {agent.name} to start chatting.</p>
              </div>
            ) : renderMessages()}
          </div>

          {/* Queue indicator — overlay on messages for true 镂空 (content shows through) */}
          {isStreaming && pendingUserMessages.length > 0 && (
            <div className="absolute bottom-0 left-0 right-0 z-10 px-6 pb-2 pointer-events-none">
            <div className="mx-auto w-96 pointer-events-auto">
              {queueExpanded ? (
                <>
                  <button
                    type="button"
                    onClick={() => updateQueueExpanded(false)}
                    className="flex w-full items-center justify-between gap-2 rounded-t-xl border border-b-0 border-blue-200/80 bg-blue-50/60 px-3 py-2 text-left text-xs font-medium text-blue-700 backdrop-blur-md transition-colors hover:bg-blue-50/80 dark:border-blue-800/80 dark:bg-blue-950/40 dark:text-blue-300 dark:hover:bg-blue-950/60"
                  >
                    <span className="flex items-center gap-1.5">
                      <Layers className="h-3.5 w-3.5" />
                      {pendingUserMessages.length} 条消息排队
                    </span>
                    <span className="flex items-center gap-1">
                      [收起]
                      <ChevronUp className="h-3.5 w-3.5" />
                    </span>
                  </button>
                  <div className="space-y-1.5 rounded-b-xl border border-blue-200/80 border-t-0 bg-white/70 px-3 py-2 backdrop-blur-md dark:border-blue-800/80 dark:bg-zinc-900/70">
                    {pendingUserMessages.map((m, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between gap-2 rounded-lg border border-blue-100/80 bg-white/50 px-2.5 py-1.5 backdrop-blur-sm dark:border-blue-800/60 dark:bg-zinc-800/40"
                      >
                        <span className="min-w-0 flex-1 truncate text-xs text-zinc-700 dark:text-zinc-300">
                          {i + 1}. {m.text.trim().slice(0, 80)}{m.text.length > 80 ? '…' : ''}
                        </span>
                        <div className="flex shrink-0 items-center gap-0.5">
                          <button
                            type="button"
                            onClick={() => handleSendNow(i)}
                            className="rounded p-1 text-blue-500 hover:bg-blue-100 hover:text-blue-600 dark:text-blue-400 dark:hover:bg-blue-900/50"
                            title="立即发送"
                          >
                            <ArrowUp className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRemoveFromQueue(i)}
                            className="rounded p-1 text-zinc-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/50"
                            title="从队列移除"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => updateQueueExpanded(true)}
                  className="flex w-full items-center justify-between gap-2 rounded-xl border border-blue-200/80 bg-blue-50/60 px-3 py-2 text-left text-xs font-medium text-blue-700 backdrop-blur-md transition-colors hover:bg-blue-50/80 dark:border-blue-800/80 dark:bg-blue-950/40 dark:text-blue-300 dark:hover:bg-blue-950/60"
                >
                  <span className="flex items-center gap-1.5">
                    <Layers className="h-3.5 w-3.5" />
                    {pendingUserMessages.length} 条消息排队
                  </span>
                  <span className="flex items-center gap-1">
                    [展开]
                    <ChevronDown className="h-3.5 w-3.5" />
                  </span>
              </button>
            )}
          </div>
        </div>
      )}
        </div>

        {/* Notifications */}
        {!isStreaming && (
          <ChatNotificationBanners
            knowledgeDrafts={knowledgeDrafts}
            docsSaved={docsSaved}
            onDismissKnowledge={handleDismissKnowledge}
            onDismissDocs={handleDismissDocs}
          />
        )}

        {/* Input area */}
        <div className="border-t border-zinc-200 p-3 dark:border-zinc-800">
          <ChatInput
            onSubmit={handleChatInputSubmit}
            onAbort={handleAbort}
            isStreaming={isStreaming}
            placeholder={`Send a message to ${agent.name}...`}
            providerOptions={providerOptions}
            providerValue={chatProvider}
            onProviderChange={(next) => setChatProvider(next as ProviderId)}
            modelProviderLabel={PROVIDER_LABELS[chatProvider]}
            modelOptions={chatModelOptions}
            modelValue={chatModel}
            onModelChange={setChatModel}
            effortLabel={chatProvider === 'openai' ? '推理档位' : undefined}
            effortOptions={chatProvider === 'openai' ? effortOptions : undefined}
            effortValue={chatProvider === 'openai' ? chatEffort : undefined}
            onEffortChange={chatProvider === 'openai' ? ((v) => setChatEffort(v as OpenAIReasoningEffort)) : undefined}
            guestAgents={guestAgents}
            showGuestPicker={showGuestPicker}
            onSelectGuest={handleSelectGuest}
            draftKey={sessionId ?? undefined}
            enableSlashCommands
            tokenInfo={{ promptEstimate, inputTokens: tokenInputs, outputTokens: tokenOutputs, contextWindow }}
          />
        </div>

        {/* Guest Agent Overlay */}
        {guestAgent && sessionId && (
          <GuestAgentOverlay
            agent={guestAgent}
            parentSessionId={sessionId}
            onClose={() => setGuestAgent(null)}
          />
        )}

        {/* Save as knowledge dialog */}
        {saveDialogContent !== null && (
          <SaveKnowledgeDialog
            content={saveDialogContent}
            onClose={() => setSaveDialogContent(null)}
          />
        )}

        {/* File preview overlay */}
        {previewFilePath && (
          <FilePreviewDialog
            filePath={previewFilePath}
            onClose={() => setPreviewFilePath(null)}
          />
        )}

        {/* Session compress dialog */}
        <SessionCompressDialog
          open={compressDialogOpen}
          onClose={() => setCompressDialogOpen(false)}
          sessionId={sessionId}
          messages={messages}
          onConfirm={handleCompressConfirm}
        />
      </div>
      {/* Right-side config drawer */}
      <div
        className={`shrink-0 overflow-hidden border-l border-zinc-200 transition-[width] duration-200 ease-in-out dark:border-zinc-800 ${
          showConfig ? 'w-[320px]' : 'w-0 border-l-0'
        }`}
      >
        <div className="h-full w-[320px]">
          <SessionConfigPanel
            sessionId={sessionId ?? '_new'}
            config={sessionConfig}
            onSave={handleSaveConfig}
            onClose={() => setShowConfig(false)}
            agent={agent}
            agentSystemPrompt={agent.systemPrompt}
            agentCapabilities={agent.capabilities}
          />
        </div>
      </div>
      {/* Right-side folder explorer */}
      <div
        className={`shrink-0 overflow-hidden border-l border-zinc-200 transition-[width] duration-200 ease-in-out dark:border-zinc-800 ${
          showFolderExplorer ? 'w-[280px]' : 'w-0 border-l-0'
        }`}
      >
        <div className="h-full w-[280px]">
          <FolderExplorerPanel onClose={() => setShowFolderExplorer(false)} />
        </div>
      </div>
      {planPanel}
      </div>
    );
  }

  // ── Project/Butler mode (sidebar or full) ──

  if (!projectKey) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-center">
        <p className="text-xs text-zinc-400">{t('projects.selectFirst')}</p>
      </div>
    );
  }

  // Chat area shared between sidebar and full modes
  const chatArea = (
    <div className="flex h-full">
    <div className="relative flex h-full flex-1 flex-col min-w-0">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-100 px-3 py-1.5 dark:border-zinc-800">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          {/* Parent session back button */}
          {parentSession && (
            <button
              onClick={() => router.push(buildSessionUrl(parentSession.agentId, parentSession.id))}
              className="flex items-center gap-0.5 shrink-0 text-xs text-blue-500 hover:text-blue-700 dark:hover:text-blue-300 mr-1"
              title={`Back to parent session: ${parentSession.title}`}
            >
              <ArrowLeft className="h-3 w-3" />
            </button>
          )}
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-blue-500" />
          {isFull ? (
            <span className="text-xs font-medium text-zinc-500 truncate">{sessionTitle}</span>
          ) : (
            <SessionDropdown
              sessionTitle={sessionTitle}
              sessions={sessionList}
              clockNow={sessionClockNow}
              currentSessionId={sessionId}
              isStreaming={isStreaming}
              onSwitch={handleSwitchSession}
              onNew={handleNewSession}
            />
          )}
          {/* 子会话指示器 */}
          {childSessions.length > 0 && (
            <div className="relative shrink-0 ml-1" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setShowChildList(false); }}>
              <button
                onClick={() => setShowChildList(v => !v)}
                className="flex items-center gap-0.5 text-xs text-violet-500 hover:text-violet-700 dark:hover:text-violet-300"
                title={`${childSessions.length} 个子会话`}
              >
                <GitFork className="h-3 w-3" />
                <span>{childSessions.length}</span>
              </button>
              {showChildList && (
                <div className="absolute left-0 top-full mt-1 z-50 min-w-[200px] max-w-[300px] rounded-md border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-800">
                  <div className="px-2 py-1.5 text-[10px] font-medium text-zinc-400 border-b border-zinc-100 dark:border-zinc-700">Child Sessions</div>
                  {childSessions.map(cs => (
                    <button
                      key={cs.id}
                      onClick={() => {
                        setShowChildList(false);
                        router.push(buildSessionUrl(cs.agentId, cs.id));
                      }}
                      className="block w-full text-left px-2 py-1.5 text-xs text-zinc-600 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-700 truncate"
                    >
                      {cs.title || 'Untitled Session'}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {/* Compress history */}
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-1.5 text-xs text-zinc-400 hover:text-blue-500 dark:hover:text-blue-400 disabled:opacity-30"
            onClick={() => setCompressDialogOpen(true)}
            disabled={isStreaming || messages.length < 6}
            title="压缩会话历史"
          >
            <FileDown className="h-3 w-3" />
          </Button>
          {/* Session config toggle */}
          <Button
            size="sm"
            variant="ghost"
            className={`h-6 px-1.5 text-xs transition-colors ${
              showConfig
                ? 'text-blue-500 dark:text-blue-400'
                : (sessionConfig.contextIds?.length || sessionConfig.supplementaryPrompt?.trim())
                  ? 'text-blue-400 dark:text-blue-500'
                  : 'text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300'
            }`}
            onClick={() => setShowConfig(v => !v)}
            title="会话配置"
          >
            <Settings className="h-3 w-3" />
          </Button>
          {!isFull && sessionId && (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-1.5 text-xs text-zinc-400 hover:text-red-500 dark:hover:text-red-400"
              onClick={handleDelete}
              disabled={isStreaming}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          )}
          {isFull ? (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-1.5 text-xs text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"
              onClick={() => router.push('/flows')}
            >
              <Minimize2 className="h-3 w-3" />
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-1.5 text-xs text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"
              onClick={() => router.push('/flows/butler')}
            >
              <Maximize2 className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>

      {/* Messages + Queue overlay */}
      <div className="relative flex-1 min-h-0">
        <div
          ref={scrollRef}
          onScroll={handleChatScroll}
          className={`h-full space-y-3 overflow-y-auto p-3 ${isStreaming && pendingUserMessages.length > 0 ? 'pb-44' : ''}`}
        >
        {/* 会话过长自动提示 */}
        {messages.length >= 20 && !compressDismissed && !isStreaming && (
          <div className="flex items-center justify-between rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
            <span>Session is getting long ({messages.length} messages). Consider compressing history.</span>
            <div className="flex items-center gap-1.5 ml-2 shrink-0">
              <button
                onClick={() => setCompressDialogOpen(true)}
                className="rounded bg-amber-600 px-2 py-0.5 text-white hover:bg-amber-700 dark:bg-amber-600 dark:hover:bg-amber-500"
              >
                压缩
              </button>
              <button
                onClick={() => setCompressDismissed(true)}
                className="text-amber-500 hover:text-amber-700 dark:hover:text-amber-300"
              >
                忽略
              </button>
            </div>
          </div>
        )}
        {messages.length === 0 && !isStreaming ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-zinc-400">
            <Sparkles className="h-8 w-8 stroke-1" />
            <p className="text-xs">{t('chat.plannerHint')}</p>
          </div>
        ) : renderMessages()}
        </div>

        {/* Queue indicator — overlay on messages for true 镂空 */}
        {isStreaming && pendingUserMessages.length > 0 && (
          <div className="absolute bottom-0 left-0 right-0 z-10 px-6 pb-2 pointer-events-none">
            <div className="mx-auto w-96 pointer-events-auto">
            {queueExpanded ? (
              <>
                <button
                  type="button"
                  onClick={() => updateQueueExpanded(false)}
                  className="flex w-full items-center justify-between gap-2 rounded-t-xl border border-b-0 border-blue-200/80 bg-blue-50/60 px-3 py-2 text-left text-xs font-medium text-blue-700 backdrop-blur-md transition-colors hover:bg-blue-50/80 dark:border-blue-800/80 dark:bg-blue-950/40 dark:text-blue-300 dark:hover:bg-blue-950/60"
                >
                  <span className="flex items-center gap-1.5">
                    <Layers className="h-3.5 w-3.5" />
                    {pendingUserMessages.length} 条消息排队
                  </span>
                  <span className="flex items-center gap-1">
                    [收起]
                    <ChevronUp className="h-3.5 w-3.5" />
                  </span>
                </button>
                <div className="space-y-1.5 rounded-b-xl border border-blue-200/80 border-t-0 bg-white/70 px-3 py-2 backdrop-blur-md dark:border-blue-800/80 dark:bg-zinc-900/70">
                  {pendingUserMessages.map((m, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between gap-2 rounded-lg border border-blue-100/80 bg-white/50 px-2.5 py-1.5 backdrop-blur-sm dark:border-blue-800/60 dark:bg-zinc-800/40"
                    >
                      <span className="min-w-0 flex-1 truncate text-xs text-zinc-700 dark:text-zinc-300">
                        {i + 1}. {m.text.trim().slice(0, 80)}{m.text.length > 80 ? '…' : ''}
                      </span>
                      <div className="flex shrink-0 items-center gap-0.5">
                        <button
                          type="button"
                          onClick={() => handleSendNow(i)}
                          className="rounded p-1 text-blue-500 hover:bg-blue-100 hover:text-blue-600 dark:text-blue-400 dark:hover:bg-blue-900/50"
                          title="立即发送"
                        >
                          <ArrowUp className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemoveFromQueue(i)}
                          className="rounded p-1 text-zinc-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/50"
                          title="从队列移除"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <button
                type="button"
                onClick={() => updateQueueExpanded(true)}
                className="flex w-full items-center justify-between gap-2 rounded-xl border border-blue-200/80 bg-blue-50/60 px-3 py-2 text-left text-xs font-medium text-blue-700 backdrop-blur-md transition-colors hover:bg-blue-50/80 dark:border-blue-800/80 dark:bg-blue-950/40 dark:text-blue-300 dark:hover:bg-blue-950/60"
              >
                <span className="flex items-center gap-1.5">
                  <Layers className="h-3.5 w-3.5" />
                  {pendingUserMessages.length} 条消息排队
                </span>
                <span className="flex items-center gap-1">
                  [展开]
                  <ChevronDown className="h-3.5 w-3.5" />
                </span>
              </button>
            )}
          </div>
        </div>
      )}
      </div>

      {/* Input area */}
      <div className="border-t border-zinc-100 p-2 dark:border-zinc-800">
        <ChatInput
          onSubmit={handleChatInputSubmit}
          onAbort={handleAbort}
          isStreaming={isStreaming}
          placeholder={t('chat.plannerPlaceholder')}
          minHeight={isFull ? '120px' : '200px'}
          fullWidth
          providerOptions={providerOptions}
          providerValue={chatProvider}
          onProviderChange={(next) => setChatProvider(next as ProviderId)}
          modelProviderLabel={PROVIDER_LABELS[chatProvider]}
          modelOptions={chatModelOptions}
          modelValue={chatModel}
          onModelChange={setChatModel}
          effortLabel={chatProvider === 'openai' ? '推理档位' : undefined}
          effortOptions={chatProvider === 'openai' ? effortOptions : undefined}
          effortValue={chatProvider === 'openai' ? chatEffort : undefined}
          onEffortChange={chatProvider === 'openai' ? ((v) => setChatEffort(v as OpenAIReasoningEffort)) : undefined}
          guestAgents={guestAgents}
          showGuestPicker={showGuestPicker}
          onSelectGuest={handleSelectGuest}
          draftKey={sessionId ?? undefined}
          enableSlashCommands
          tokenInfo={{ promptEstimate, inputTokens: tokenInputs, outputTokens: tokenOutputs, contextWindow }}
        />
      </div>

      {/* Notifications */}
      {!isStreaming && (
        <ChatNotificationBanners
          knowledgeDrafts={knowledgeDrafts}
          docsSaved={docsSaved}
          onDismissKnowledge={handleDismissKnowledge}
          onDismissDocs={handleDismissDocs}
          className="mx-2 mb-1"
        />
      )}

      {/* Guest Agent Overlay */}
      {guestAgent && sessionId && (
        <GuestAgentOverlay
          agent={guestAgent}
          parentSessionId={sessionId}
          onClose={() => setGuestAgent(null)}
        />
      )}

      {/* Save as knowledge dialog */}
      {saveDialogContent !== null && (
        <SaveKnowledgeDialog
          content={saveDialogContent}
          onClose={() => setSaveDialogContent(null)}
        />
      )}

      {/* File preview overlay */}
      {previewFilePath && (
        <FilePreviewDialog
          filePath={previewFilePath}
          onClose={() => setPreviewFilePath(null)}
        />
      )}

      {/* Session compress dialog */}
      <SessionCompressDialog
        open={compressDialogOpen}
        onClose={() => setCompressDialogOpen(false)}
        sessionId={sessionId}
        messages={messages}
        onConfirm={handleCompressConfirm}
      />
    </div>
    {/* Right-side config drawer */}
    <div
      className={`shrink-0 overflow-hidden border-l border-zinc-200 transition-[width] duration-200 ease-in-out dark:border-zinc-800 ${
        showConfig ? 'w-[320px]' : 'w-0 border-l-0'
      }`}
    >
      <div className="h-full w-[320px]">
        <SessionConfigPanel
          sessionId={sessionId ?? '_new'}
          config={sessionConfig}
          onSave={handleSaveConfig}
          onClose={() => setShowConfig(false)}
          agent={agent}
        />
      </div>
    </div>
    {planPanel}
    </div>
  );

  // Full mode: session sidebar + chat area
  if (isFull) {
    return (
      <div className="flex h-full w-full">
        {/* Session sidebar */}
        <div className="flex w-64 shrink-0 flex-col border-r border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950">
          <div className="flex items-center justify-between border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
            <span className="text-sm font-medium text-zinc-500">{t('chat.conversations')}</span>
            <button
              onClick={handleNewSession}
              disabled={isStreaming}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-blue-600 hover:bg-zinc-200 dark:text-blue-400 dark:hover:bg-zinc-800"
            >
              <Plus className="h-3 w-3" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {sessionList.map(s => (
              <button
                key={s.id}
                onClick={() => handleSwitchSession(s)}
                className={`flex w-full items-center gap-2 px-3 py-2.5 text-sm transition-colors border-l-2 ${
                  s.id === sessionId
                    ? 'border-l-blue-500 bg-blue-50 font-medium text-zinc-900 dark:border-l-blue-400 dark:bg-blue-950/40 dark:text-zinc-100'
                    : 'border-l-transparent text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900'
                }`}
              >
                <MessageSquare className={`h-3.5 w-3.5 shrink-0 ${s.id === sessionId ? 'text-blue-500 dark:text-blue-400' : ''}`} />
                <span className="truncate flex-1 text-left">{s.title}</span>
                {s.isRunning ? (
                  <span className="shrink-0 rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium leading-none text-blue-700 dark:bg-blue-950/70 dark:text-blue-300">
                    {formatSessionElapsed(s.runningStartedAt, sessionClockNow)}
                  </span>
                ) : s.isAwaiting ? (
                  <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium leading-none text-amber-700 dark:bg-amber-950/70 dark:text-amber-300">
                    ⏳
                  </span>
                ) : !!s.unreadCount && s.unreadCount > 0 && (
                  <span className="flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-medium leading-none text-white">
                    {s.unreadCount > 99 ? '99+' : s.unreadCount}
                  </span>
                )}
              </button>
            ))}
            {sessionList.length === 0 && (
              <div className="px-3 py-4 text-center text-xs text-zinc-400">
                {t('chat.noConversations')}
              </div>
            )}
          </div>
        </div>

        {/* Chat area */}
        <div className="flex-1 min-w-0">
          {chatArea}
        </div>
      </div>
    );
  }

  // Sidebar mode
  return chatArea;
}


