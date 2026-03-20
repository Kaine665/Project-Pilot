'use client';

import { useState, useEffect, useRef, useCallback, useMemo, useReducer, startTransition } from 'react';
import { Bot, Sparkles, PanelRight, Settings } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/routing';
import { ChatInput } from '@/components/chat-input';
import { ChatNotificationBanners } from '@/components/chat-notification-banners';
import { useNotificationManager } from '@/hooks/use-notification-manager';
import { useModelConfig } from '@/hooks/use-model-config';
import { SaveKnowledgeDialog } from '@/components/save-knowledge-dialog';
import { GuestAgentOverlay } from '@/components/guest-agent-overlay';
import { SessionConfigPanel } from '@/components/session-config-panel';
import { PlanViewerPanel } from '@/components/plan-viewer-panel';
import { ActionContentPanel } from '@/components/action-content-panel';
import type { ParsedActionTag } from '@/lib/action-tag-parser';
import { SessionCompressDialog } from '@/components/session-compress-dialog';
import { FilePreviewDialog } from '@/components/file-preview-dialog';
import { FolderExplorerPanel } from '@/components/folder-explorer-panel';
import { RuntimePanel } from '@/components/runtime-panel';
import { useProject } from '@/components/project-context';
import type { SessionNavLink } from '@/components/agent-session-utils';
import { buildSessionUrl } from '@/components/agent-session-utils';
import { PROVIDER_REGISTRY } from '@/lib/provider-registry';
import { imageAttachmentFromDataUrl } from '@/lib/image-assets';
import type { Agent, ProviderId, OpenAIReasoningEffort } from '@/types';
import type { PendingUserQueueItem, PendingUserQueueState, SessionConfig } from '@/types/agent-chat';
import type { ChatMessage, ChatToolCall, ContentBlock } from '@/types';

import type { AgentChatPanelProps, IndexedSSEEvent } from './types';
import { PROVIDER_LABELS, stripSessionTitleTag, clonePendingQueueItems } from './types';
import { chatReducer, chatInitialState } from './chat-reducer';
import { sessionReducer, upsertSessionListItem, patchSessionListItem } from './session-reducer';
import type { SessionState } from './session-reducer';
import { ChatMessageList } from './chat-message-list';
import { ChatQueueOverlay } from './chat-queue-overlay';
import { ChatScrollTimeline } from './chat-scroll-timeline';
import { ChatSessionHeader } from './chat-session-header';
import { ChatSessionSidebar } from './chat-session-sidebar';
import { TaskCardBanner } from './task-card-banner';
import { AgentChatPanelView } from './agent-chat-panel-view';
import { buildCacheKey } from './agent-session-cache';
import { usePanelCacheSnapshot } from './use-panel-cache-snapshot';
import { useSessionBootstrap } from './use-session-bootstrap';

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

  // Cache key for surviving SPA route changes
  const cacheKey = useMemo(
    () => buildCacheKey(agent.id, projectKey, initialSessionId),
    [agent.id, projectKey, initialSessionId],
  );

  // Resolve project path for folder explorer
  const { projects } = useProject();
  const projectPath = useMemo(() => {
    if (!projectKey) return undefined;
    const entry = projects.find(p => p.key === projectKey);
    return entry?.path ?? undefined;
  }, [projectKey, projects]);

  // Insert file path reference into chat input via CustomEvent
  const handleInsertFilePath = useCallback((filePath: string) => {
    window.dispatchEvent(new CustomEvent('pp:insert-text', { detail: { text: filePath } }));
  }, []);

  // Initialize notification manager
  const { notifyCompletion } = useNotificationManager();

  const [chat, chatDispatch] = useReducer(chatReducer, chatInitialState);
  const { messages, isStreaming, streamingBlocks, errorMsg, inPlanMode, tokenInputs, tokenOutputs } = chat;
  const scrollRef = useRef<HTMLDivElement>(null);

  // Session management
  const defaultSessionTitle = hasProject ? t('chat.newSession') : 'New Session';
  const [session, sessionDispatch] = useReducer(sessionReducer, {
    id: null,
    title: defaultSessionTitle,
    list: [],
    config: {},
    parentSession: null,
    childSessions: [],
    showChildList: false,
  } satisfies SessionState);
  const { id: sessionId, title: sessionTitle, list: sessionList, config: sessionConfig, parentSession, childSessions, showChildList } = session;
  const [sessionClockNow, setSessionClockNow] = useState(() => Date.now());

  // Provider / model routing (extracted to useModelConfig hook)
  const modelConfig = useModelConfig(agent, projectKey, cachedSettings);
  const { provider: chatProvider, model: chatModel, options: chatModelOptions, effort: chatEffort, contextWindow, promptEstimate } = modelConfig;
  const setChatProvider = modelConfig.setProvider;
  const setChatModel = modelConfig.setModel;
  const setChatEffort = modelConfig.setEffort;

  // Guest Agent (observer)
  const [guestAgent, setGuestAgent] = useState<Agent | null>(null);
  const [guestAgents, setGuestAgents] = useState<Agent[]>([]);

  // Knowledge draft notifications (auto-path)
  const [knowledgeDrafts, setKnowledgeDrafts] = useState<Array<{ entryId: string; label: string }>>([]);

  // Design doc saved notifications (auto-path)
  const [docsSaved, setDocsSaved] = useState<Array<{ docId: string; title: string; projectKey: string }>>([]);

  // Topic completion detection
  const [topicCompletion, setTopicCompletion] = useState<{ completed: boolean; confidence: number; summary: string } | null>(null);

  // Task card
  const [taskCard, setTaskCard] = useState<import('@/lib/task-card-store').TaskCard | null>(null);

  // Session checkpoint notification
  const [checkpointSaved, setCheckpointSaved] = useState(false);
  const checkpointRef = useRef<import('@/types/agent-chat').SessionCheckpoint | null>(null);

  // Save as knowledge dialog
  const [saveDialogContent, setSaveDialogContent] = useState<string | null>(null);

  // Session compression
  const [compressDialogOpen, setCompressDialogOpen] = useState(false);
  const [compressDismissed, setCompressDismissed] = useState(false);

  // Session config
  const [showConfig, setShowConfig] = useState(false);
  const [showFolderExplorer, setShowFolderExplorer] = useState(false);
  const [showRuntimePanel, setShowRuntimePanel] = useState(false);
  const [currentMessageId, setCurrentMessageId] = useState<string | null>(null);

  // Plan viewer
  const [planContent, setPlanContent] = useState<string | null>(null);
  const [isPlanOpen, setIsPlanOpen] = useState(false);

  // Action content panel (right-side preview for action tags)
  const [actionPreviewTag, setActionPreviewTag] = useState<ParsedActionTag | null>(null);
  const [isActionPanelOpen, setIsActionPanelOpen] = useState(false);

  // File preview
  const [previewFilePath, setPreviewFilePath] = useState<string | null>(null);

  // SSE-reported contextWindow override
  const [sseContextWindow, setSseContextWindow] = useState<number | null>(null);
  const effectiveContextWindow = sseContextWindow ?? contextWindow;

  const streamAbortRef = useRef<AbortController | null>(null);
  const blocksRef = useRef<ContentBlock[]>([]);
  const rafIdRef = useRef<number>(0);
  const fullTextRef = useRef('');
  const toolCallsRef = useRef<ChatToolCall[]>([]);
  const lastEventIdxRef = useRef<number>(-1);
  const finalizingRef = useRef(false);
  const streamTargetSessionRef = useRef<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const sessionTitleRef = useRef<string>(defaultSessionTitle);
  const initTokenRef = useRef(0);
  const doSendRef = useRef<(text: string, images?: string[]) => void>(() => {});
  const isStreamingRef = useRef(false);
  const messagesRef = useRef<ChatMessage[]>([]);
  const pendingAnswerRef = useRef<{ answer: string; targetSessionId: string } | null>(null);
  const pendingUserMessagesRef = useRef<PendingUserQueueItem[]>([]);
  const [pendingUserQueueCount, setPendingUserQueueCount] = useState(0);
  const [pendingUserMessages, setPendingUserMessages] = useState<PendingUserQueueItem[]>([]);
  const [queueExpanded, setQueueExpanded] = useState(true);

  // Sync sessionId to both reducer state and ref atomically
  const setSessionIdSync = useCallback((id: string | null) => {
    sessionDispatch({ type: 'SET_ID', id });
    sessionIdRef.current = id;
  }, []);

  useEffect(() => {
    isStreamingRef.current = chat.isStreaming;
  }, [chat.isStreaming]);

  useEffect(() => {
    messagesRef.current = chat.messages;
  }, [chat.messages]);

  // Keep sessionTitleRef in sync so finalizeStream can read it without being a dep (avoids useSessionBootstrap loop)
  useEffect(() => {
    sessionTitleRef.current = sessionTitle;
  }, [sessionTitle]);

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

  // Cache panel state on unmount (SPA navigation) so we can restore instantly on remount.
  // Backend runner is NOT stopped — the user is still in the app and may come back.
  // The beforeunload handler below handles actual page/tab close.
  usePanelCacheSnapshot({
    cacheKey,
    sessionIdRef,
    isStreamingRef,
    showConfig,
    showFolderExplorer,
    showRuntimePanel,
    queueExpanded,
  });

  useEffect(() => {
    return () => {
      // Disconnect SSE (frontend only) - backend keeps running
      streamAbortRef.current?.abort();
      pendingAnswerRef.current = null;
      pendingUserMessagesRef.current = [];
    };
  }, []);

  // Stop backend runner only when the browser tab/window is actually closing.
  useEffect(() => {
    const handleBeforeUnload = () => {
      const sid = sessionIdRef.current;
      if (sid && isStreamingRef.current) {
        fetch('/api/agent-chat/stop', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: sid }),
          keepalive: true,
        }).catch(() => {});
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
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

  // Load guest agent candidates
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

  // Fetch session list
  const fetchSessionList = useCallback(async (agentId: string, pk?: string | null) => {
    try {
      let url = `/api/agent-chat/sessions?agentId=${agentId}`;
      if (pk) url += `&projectKey=${pk}`;
      const res = await fetch(url, { cache: 'no-store' });
      const data = await res.json();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const remote: import('./types').SessionListItem[] = (data.sessions ?? []).map((s: any) => ({
        ...s,
        isAwaiting: s.execution?.status === 'awaiting' || undefined,
      }));
      sessionDispatch({ type: 'MERGE_LIST', remote });
      return remote;
    } catch {
      return [];
    }
  }, []);

  const markSessionRunning = useCallback((targetSessionId: string, startedAt?: string, title?: string) => {
    const now = new Date().toISOString();
    const runStart = startedAt ?? now;
    sessionDispatch({ type: 'UPDATE_LIST', updater: (prev) => {
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
    } });
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
    unreadCount?: number;
    title?: string;
  }) => {
    const ts = opts?.updatedAt ?? new Date().toISOString();
    const extraPatch: Partial<import('./types').SessionListItem> = {
      updatedAt: ts,
      isRunning: false,
      isAwaiting: undefined,
      runningStartedAt: undefined,
    };
    if (opts?.unreadCount !== undefined) {
      extraPatch.unreadCount = opts.unreadCount;
    }
    sessionDispatch({ type: 'UPDATE_LIST', updater: (prev) => patchSessionListItem(prev, targetSessionId, extraPatch) });
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
    sessionDispatch({ type: 'SET_NAV', parent: null, children: [] });

    let loadedParent: SessionNavLink | null = null;
    if (parentSid) {
      try {
        const res = await fetch(`/api/agent-chat/sessions/${parentSid}`, { cache: 'no-store' });
        if (res.ok) {
          const ps = await res.json();
          loadedParent = { id: ps.id, title: ps.title, agentId: ps.agentId };
        }
      } catch { /* ignore */ }
    }

    let loadedChildren: SessionNavLink[] = [];
    try {
      const res = await fetch(`/api/agent-chat/sessions/${sid}/children`, { cache: 'no-store' });
      if (res.ok) {
        const { children } = await res.json();
        if (Array.isArray(children) && children.length > 0) {
          loadedChildren = children.map((c: { id: string; title: string; agentId: string }) => ({
            id: c.id, title: c.title, agentId: c.agentId,
          }));
        }
      }
    } catch { /* ignore */ }

    sessionDispatch({ type: 'SET_NAV', parent: loadedParent, children: loadedChildren });
  }, []);

  // Load a session's full data (messages + config)
  const loadSessionData = useCallback(async (sid: string, token?: number) => {
    try {
      const res = await fetch(`/api/agent-chat/sessions/${sid}`, { cache: 'no-store' });
      if (!res.ok) return;
      if (token !== undefined && initTokenRef.current !== token) return;
      const data = await res.json();
      let messages: Array<{
        role: 'user' | 'assistant';
        content: string;
        images?: string[];
        contentBlocks?: ContentBlock[];
      }> = data.messages ?? [];

      // Defensive: if disk data ends with a user message, check in-memory status
      if (messages.length > 0 && messages[messages.length - 1].role === 'user') {
        try {
          const snapshotRes = await fetch(
            `/api/agent-chat/runtime-snapshot?sessionId=${sid}`,
            { cache: 'no-store' },
          );
          if (snapshotRes.ok) {
            const snapshotData = await snapshotRes.json();
            if (
              snapshotData.available
              && Array.isArray(snapshotData.messages)
              && snapshotData.messages.length > messages.length
            ) {
              messages = snapshotData.messages;
            }
          }
        } catch { /* ignore fallback failure */ }
      }

      const restored: ChatMessage[] = messages.map(
        (m: { role: 'user' | 'assistant'; content: string; images?: string[]; contentBlocks?: ContentBlock[] }, i: number) => ({
          id: `restored-${i}`,
          role: m.role,
          content: m.content,
          images: m.images,
          contentBlocks: m.contentBlocks,
          timestamp: '',
        }),
      );
      chatDispatch({ type: 'SET_MESSAGES', messages: restored });
      sessionDispatch({ type: 'SET_TITLE', title: data.title ?? 'New Session' });
      const loadedConfig = data.config ?? {};
      sessionDispatch({ type: 'SET_CONFIG', config: loadedConfig });
      const loadedQueueState = data.pendingUserQueue as PendingUserQueueState | undefined;
      const loadedQueue = Array.isArray(loadedQueueState?.items)
        ? clonePendingQueueItems(loadedQueueState.items)
        : [];
      replacePendingUserQueue(loadedQueue);
      setQueueExpanded(loadedQueueState?.expanded !== false);
      modelConfig.applySessionConfig(loadedConfig);
      loadSessionNavLinks(sid, data.parentSessionId);

      // Load task card
      try {
        const cardRes = await fetch(`/api/agent-chat/sessions/${sid}/task-card`, { cache: 'no-store' });
        if (cardRes.ok) {
          const cardData = await cardRes.json();
          setTaskCard(cardData.card ?? null);
        }
      } catch { /* ignore task card load failure */ }
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

    const streamTarget = streamTargetSessionRef.current;
    const isStaleStream = streamTarget !== null && streamTarget !== sessionIdRef.current;

    const fullText = fullTextRef.current;
    const toolCalls = toolCallsRef.current;
    const blocks = blocksRef.current;

    chatDispatch({ type: 'STREAM_END' });

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
      chatDispatch({ type: 'APPEND_MESSAGE', message: assistantMsg });
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
      clearSessionRunning(streamTarget, { unreadCount: 1 });
    } else if (currentSid) {
      clearSessionRunning(currentSid);
      fetch(`/api/agent-chat/sessions/${currentSid}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'markAsRead' }),
      }).catch(() => {});
    }

    fetchSessionList(agent.id, projectKey).then((sessions) => {
      const current = sessions.find((s) => s.id === currentSid);
      if (current) {
        sessionDispatch({ type: 'SET_TITLE', title: current.title });
      }
    });

    onSessionChange?.();
    setTimeout(() => { onSessionChange?.(); }, 2000);

    // Auto-send queued AskUserQuestion answer
    const pending = pendingAnswerRef.current;
    pendingAnswerRef.current = null;
    if (pending && pending.targetSessionId === sessionIdRef.current) {
      setTimeout(() => {
        if (pending.targetSessionId === sessionIdRef.current && scrollRef.current?.offsetParent !== null) {
          doSendRef.current(pending.answer);
        }
      }, 300);
      return;
    }

    if (currentSid) {
      flushQueuedUserMessage(currentSid);
    }

    // Send completion notification
    const completedSid = isStaleStream ? streamTarget : currentSid;
    if (completedSid && (fullText || toolCalls.length > 0)) {
      notifyCompletion({
        agentName: agent.name || agent.id,
        sessionId: completedSid,
        sessionTitle: sessionTitleRef.current || 'Untitled Session',
        navigateToSession: () => {
          const sessionUrl = buildSessionUrl(agent.id, completedSid);
          router.push(sessionUrl);
        },
      }).catch(err => console.error('通知发送失败:', err));
    }
  }, [agent.id, agent.name, projectKey, fetchSessionList, onSessionChange, flushQueuedUserMessage, router, notifyCompletion]);

  // Connect to SSE stream
  const connectToStream = useCallback((targetSessionId: string, since: number) => {
    if (streamAbortRef.current) {
      streamAbortRef.current.abort();
    }

    streamTargetSessionRef.current = targetSessionId;

    const abort = new AbortController();
    streamAbortRef.current = abort;

    // Stale connection detection: if no data (including heartbeat) received
    // within 45s, abort and let the catch handler attempt reconnect.
    let lastDataTime = Date.now();
    const staleCheckInterval = setInterval(() => {
      if (Date.now() - lastDataTime > 45_000) {
        clearInterval(staleCheckInterval);
        console.warn(`[SSE] No data for 45s on session ${targetSessionId}, aborting stale connection`);
        abort.abort();
      }
    }, 10_000);

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

        // Update stale timer on every chunk (including SSE heartbeat comments)
        lastDataTime = Date.now();

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

          const event = raw as unknown as import('@/types').ChatSSEEvent;

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
              if (event.toolName === 'EnterPlanMode') {
                chatDispatch({ type: 'PLAN_STARTED' });
              }
              break;
            }

            case 'tool_use_end': {
              const tc = toolCallsRef.current.find((t) => t.id === event.id);
              if (tc) {
                tc.output = event.output;
                tc.status = event.status;
                chunkHasDisplayEvents = true;

                if (tc.toolName === 'ExitPlanMode') {
                  chatDispatch({ type: 'PLAN_FINISHED' });
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
              sessionDispatch({ type: 'SET_TITLE', title: event.title });
              sessionDispatch({ type: 'UPDATE_LIST', updater: (prev) => patchSessionListItem(prev, targetSessionId, {
                title: event.title,
                updatedAt: new Date().toISOString(),
              }) });
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

            case 'checkpoint_saved':
              checkpointRef.current = event.checkpoint;
              setCheckpointSaved(true);
              break;

            case 'token_usage':
              chatDispatch({ type: 'STREAM_TOKENS', input: event.inputTokens, output: event.outputTokens, final: event.final });
              if (event.contextWindow && event.contextWindow > 0) setSseContextWindow(event.contextWindow);
              break;

            case 'error':
              console.error('Agent chat stream error:', event.message);
              chatDispatch({ type: 'STREAM_ERROR', message: event.message ?? 'Stream error' });
              break;

            case 'topic_completion':
              if (event.completed) {
                setTopicCompletion({ completed: event.completed, confidence: event.confidence, summary: event.summary });
              }
              break;

            case 'task_card_updated':
              setTaskCard(event.card);
              break;

            case 'awaiting_sub_agents':
              sessionDispatch({ type: 'UPDATE_LIST', updater: (prev) =>
                prev.map((s) =>
                  s.id === streamTargetSessionRef.current
                    ? { ...s, isRunning: false, isAwaiting: true, runningStartedAt: undefined }
                    : s,
                ),
              });
              break;

            case 'done':
              // AI response is complete. Finalize the streaming UI immediately so the
              // user sees the response without waiting for satellite tasks to finish.
              // The SSE connection stays open until 'stream_end' (emitted after all
              // satellite tasks complete) — this lets events like 'task_card_updated'
              // arrive and update the UI in real-time.
              if (rafIdRef.current) {
                cancelAnimationFrame(rafIdRef.current);
                rafIdRef.current = 0;
              }
              finalizeStream();
              break;

            case 'stream_end':
              // All satellite tasks have completed. The sidecar will close the SSE
              // connection after emitting this event. No UI action needed here —
              // finalizeStream() was already called on 'done'.
              break;
          }
        }

        if (chunkHasDisplayEvents && !rafIdRef.current) {
          rafIdRef.current = requestAnimationFrame(() => {
            rafIdRef.current = 0;
            startTransition(() => {
              chatDispatch({ type: 'STREAM_BLOCKS', blocks: [...blocksRef.current] });
            });
          });
        }
      }

      clearInterval(staleCheckInterval);
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = 0;
      }
      finalizeStream();
    }).catch((err) => {
      clearInterval(staleCheckInterval);

      if ((err as Error).name === 'AbortError') {
        // Abort may come from handleAbort's fallback force-close OR stale connection detection.
        // Check if backend is still running — if so, reconnect instead of giving up.
        if (isStreamingRef.current && sessionIdRef.current === targetSessionId) {
          fetch(`/api/agent-chat/status?sessionId=${targetSessionId}`, { cache: 'no-store' })
            .then(r => r.json())
            .then(data => {
              if (data.status === 'running' && sessionIdRef.current === targetSessionId) {
                console.info(`[SSE] Backend still running for ${targetSessionId}, reconnecting from idx ${lastEventIdxRef.current + 1}`);
                connectToStream(targetSessionId, lastEventIdxRef.current + 1);
              } else {
                finalizeStream();
              }
            })
            .catch(() => finalizeStream());
          return;
        }
        if (isStreamingRef.current) finalizeStream();
        return;
      }
      console.error('Agent chat stream connection failed:', err);
      chatDispatch({ type: 'STREAM_ERROR', message: `Stream connection failed: ${(err as Error).message}` });
      finalizeStream();
    });
  }, [finalizeStream]);

  // Reset state helper
  const resetState = useCallback(() => {
    chatDispatch({ type: 'RESET' });
    setSessionIdSync(null);
    sessionDispatch({ type: 'RESET', defaultTitle: hasProject ? t('chat.newSession') : 'New Session' });
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

  useSessionBootstrap({
    agentId: agent.id,
    projectKey,
    initialSessionId,
    hasProject,
    cacheKey,
    initTokenRef,
    streamAbortRef,
    setShowConfig,
    setShowFolderExplorer,
    setShowRuntimePanel,
    setQueueExpanded,
    resetState,
    fetchSessionList,
    setSessionIdSync,
    loadSessionData,
    sessionDispatch,
    markSessionRunning,
    chatDispatch,
    blocksRef,
    fullTextRef,
    toolCallsRef,
    connectToStream,
  });

  useEffect(() => {
    if (!sessionId || isStreaming || pendingUserQueueCount === 0) return;
    const timer = window.setTimeout(() => {
      if (sessionIdRef.current !== sessionId) return;
      if (isStreamingRef.current) return;
      flushQueuedUserMessage(sessionId, 0);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [sessionId, isStreaming, pendingUserQueueCount, flushQueuedUserMessage]);

  // Smart auto-scroll
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRafRef = useRef<number>(0);
  const updateActiveMessageId = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;

    const nodes = Array.from(container.querySelectorAll<HTMLElement>('[data-chat-message-id]'));
    if (nodes.length === 0) {
      setCurrentMessageId(null);
      return;
    }

    const anchorY = container.getBoundingClientRect().top + Math.min(96, container.clientHeight * 0.25);
    let nextMessageId = nodes[nodes.length - 1]?.dataset.chatMessageId ?? null;
    let bestAbove = -Infinity;
    let bestBelow = Infinity;

    for (const node of nodes) {
      const messageId = node.dataset.chatMessageId;
      if (!messageId) continue;
      const offset = node.getBoundingClientRect().top - anchorY;
      if (offset <= 0 && offset > bestAbove) {
        bestAbove = offset;
        nextMessageId = messageId;
      } else if (bestAbove === -Infinity && offset > 0 && offset < bestBelow) {
        bestBelow = offset;
        nextMessageId = messageId;
      }
    }

    setCurrentMessageId((prev) => (prev === nextMessageId ? prev : nextMessageId));
  }, []);

  const handleChatScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 40;
    setAutoScroll(isNearBottom);
    updateActiveMessageId();
  }, [updateActiveMessageId]);

  useEffect(() => {
    if (!autoScroll) return;
    if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current);
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = 0;
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
      updateActiveMessageId();
    });
  }, [messages, streamingBlocks, autoScroll, updateActiveMessageId]);

  useEffect(() => {
    const rafId = requestAnimationFrame(() => {
      updateActiveMessageId();
    });
    return () => cancelAnimationFrame(rafId);
  }, [messages, streamingBlocks, isStreaming, updateActiveMessageId]);

  const handleSelectTimelineMessage = useCallback((messageId: string) => {
    const container = scrollRef.current;
    if (!container) return;

    const target = Array.from(container.querySelectorAll<HTMLElement>('[data-chat-message-id]'))
      .find((node) => node.dataset.chatMessageId === messageId);

    if (!target) return;

    setAutoScroll(false);
    setCurrentMessageId(messageId);
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });

    target.classList.add('ring-2', 'ring-blue-400', 'ring-offset-2', 'ring-offset-white', 'dark:ring-offset-zinc-950');
    window.setTimeout(() => {
      target.classList.remove('ring-2', 'ring-blue-400', 'ring-offset-2', 'ring-offset-white', 'dark:ring-offset-zinc-950');
    }, 1400);
  }, []);

  // Send message
  const doSend = useCallback(async (text: string, images?: string[]) => {
    if (!text.trim() && (!images || images.length === 0)) return;
    if (isStreaming) return;
    if (hasProject && !projectKey) return;

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

    chatDispatch({ type: 'UPDATE_MESSAGES', updater: (prev) => {
      const last = prev[prev.length - 1];
      if (last?.role === 'user' && last.content === userMsg.content) {
        return [...prev.slice(0, -1), userMsg];
      }
      return [...prev, userMsg];
    } });
    setAutoScroll(true);
    chatDispatch({ type: 'SEND_START' });
    blocksRef.current = [];
    fullTextRef.current = '';
    toolCallsRef.current = [];
    lastEventIdxRef.current = -1;

    let targetSessionId = sessionId;
    if (!targetSessionId) {
      targetSessionId = `agent-chat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const quickTitle = text.trim().slice(0, 10) || (hasProject ? t('chat.newSession') : 'New Session');
      setSessionIdSync(targetSessionId);
      sessionDispatch({ type: 'SET_TITLE', title: quickTitle });
      const newItem: import('./types').SessionListItem = {
        id: targetSessionId!,
        title: quickTitle,
        updatedAt: new Date().toISOString(),
      };
      sessionDispatch({ type: 'UPDATE_LIST', updater: (prev) => upsertSessionListItem(prev, newItem) });
      onSessionChange?.(newItem);
    }

    markSessionRunning(
      targetSessionId,
      new Date().toISOString(),
      text.trim().slice(0, 10) || sessionTitle,
    );

    try {
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
      chatDispatch({ type: 'STREAM_ERROR', message: msg });
      chatDispatch({ type: 'STREAM_END' });
      clearSessionRunning(targetSessionId);
    }
  }, [agent.id, sessionId, isStreaming, hasProject, projectKey, chatProvider, chatModel, chatEffort, connectToStream, onSessionChange, t, sessionConfig, setSessionIdSync, persistPendingUserQueue, sessionTitle, markSessionRunning, clearSessionRunning]);

  useEffect(() => {
    doSendRef.current = doSend;
  }, [doSend]);

  // Listen for AskUserQuestion answers
  useEffect(() => {
    const handler = (e: Event) => {
      if (scrollRef.current?.offsetParent === null) return;
      const answer = (e as CustomEvent<{ answer: string }>).detail?.answer;
      if (!answer) return;
      if (isStreamingRef.current) {
        pendingAnswerRef.current = { answer, targetSessionId: sessionIdRef.current! };
      } else {
        doSendRef.current(answer);
      }
    };
    window.addEventListener('ask-user-answer', handler);
    return () => window.removeEventListener('ask-user-answer', handler);
  }, []);

  // Listen for toggle-session-config event
  useEffect(() => {
    const handler = () => setShowConfig(v => !v);
    window.addEventListener('toggle-session-config', handler);
    return () => window.removeEventListener('toggle-session-config', handler);
  }, []);

  // Listen for toggle-folder-explorer event
  useEffect(() => {
    const handler = () => setShowFolderExplorer(v => !v);
    window.addEventListener('toggle-folder-explorer', handler);
    return () => window.removeEventListener('toggle-folder-explorer', handler);
  }, []);

  // Listen for toggle-runtime-panel event
  useEffect(() => {
    const handler = () => setShowRuntimePanel(v => !v);
    window.addEventListener('toggle-runtime-panel', handler);
    return () => window.removeEventListener('toggle-runtime-panel', handler);
  }, []);

  // Listen for toggle-session-compress event
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

    // Send stop to backend — it now waits for finalizeRun (up to 8s) before responding.
    // The backend stop causes the SSE stream to end naturally (emit 'done' → res.end()),
    // which triggers finalizeStream() via the normal reader-done path.
    try {
      await fetch('/api/agent-chat/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
    } catch (err) {
      console.error('Failed to stop agent chat:', err);
    }

    // After stop returns, the stream should have closed naturally already.
    // If for any reason it hasn't (timeout, network issue), force-close it.
    if (streamAbortRef.current) {
      streamAbortRef.current.abort();
      streamAbortRef.current = null;
    }
    // Ensure UI state is cleaned up even if finalizeStream was already called by the stream.
    if (isStreamingRef.current) {
      clearSessionRunning(sessionId);
      finalizeStream();
    }
  };

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
    if (isStreamingRef.current) {
      finalizeStream();
    }
    // Defer doSend to next tick so React has time to process STREAM_END
    // and update isStreaming to false — otherwise doSend's guard rejects the call.
    setTimeout(() => doSendRef.current(item.text, item.images), 0);
  }, [sessionId, finalizeStream, replacePendingUserQueue]);

  const handleRemoveFromQueue = useCallback((index: number) => {
    if (!sessionId) return;
    if (!pendingUserMessagesRef.current[index]) return;
    replacePendingUserQueue(
      pendingUserMessagesRef.current.filter((_, itemIndex) => itemIndex !== index),
      { persist: true, sessionId },
    );
  }, [sessionId, replacePendingUserQueue]);

  const handleDelete = async () => {
    if (isStreaming || !sessionId) return;
    try {
      await fetch(`/api/agent-chat/sessions?sessionId=${sessionId}`, { method: 'DELETE' });
    } catch {
      // ignore
    }
    sessionDispatch({ type: 'UPDATE_LIST', updater: prev => prev.filter(s => s.id !== sessionId) });
    handleNewSession();
  };

  const handleSaveConfig = useCallback(async (config: SessionConfig) => {
    sessionDispatch({ type: 'SET_CONFIG', config });
    modelConfig.applySessionConfig(config);
    if (sessionId) {
      try {
        await fetch(`/api/agent-chat/sessions/${sessionId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'updateConfig', config }),
        });
      } catch {
        // ignore
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
    sessionDispatch({ type: 'NEW', defaultTitle: hasProject ? t('chat.newSession') : 'New Session' });
    sessionIdRef.current = null;
    chatDispatch({ type: 'SET_MESSAGES', messages: [] });
    setShowConfig(false);
    setCompressDismissed(false);
    setTaskCard(null);
    replacePendingUserQueue([]);
    setQueueExpanded(true);
    blocksRef.current = [];
    fullTextRef.current = '';
    toolCallsRef.current = [];
    modelConfig.resetToAgentDefaults(agent);
  }, [isStreaming, hasProject, t, setSessionIdSync, agent, replacePendingUserQueue]);

  const handleResumeCheckpoint = useCallback(() => {
    const checkpoint = checkpointRef.current;
    if (!checkpoint) return;
    const resumeMsg = `请续接之前的工作。以下是工作检查点：\n\n${checkpoint.rawContent}\n\n请直接从"下一步"开始继续，无需重新探索已知信息。`;
    handleNewSession();
    setCheckpointSaved(false);
    checkpointRef.current = null;
    setTimeout(() => { doSendRef.current(resumeMsg); }, 0);
  }, [handleNewSession]);

  const handleDismissCheckpoint = useCallback(() => {
    setCheckpointSaved(false);
    checkpointRef.current = null;
  }, []);

  const handleSwitchSession = useCallback(async (target: import('./types').SessionListItem) => {
    if (isStreaming) return;
    initTokenRef.current += 1;
    const token = initTokenRef.current;
    if (streamAbortRef.current) {
      streamAbortRef.current.abort();
      streamAbortRef.current = null;
    }
    sessionDispatch({ type: 'SELECT', id: target.id, title: target.title });
    sessionIdRef.current = target.id;
    chatDispatch({ type: 'RESET' });
    setShowConfig(false);
    setCompressDismissed(false);
    blocksRef.current = [];
    fullTextRef.current = '';
    toolCallsRef.current = [];
    pendingAnswerRef.current = null;
    replacePendingUserQueue([]);
    setQueueExpanded(true);
    if (target.unreadCount) {
      sessionDispatch({ type: 'UPDATE_LIST', updater: (prev) => patchSessionListItem(prev, target.id, { unreadCount: 0 }) });
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

  const handleCompressConfirm = useCallback((compressedMessages: ChatMessage[]) => {
    chatDispatch({ type: 'SET_MESSAGES', messages: compressedMessages });
    setCompressDialogOpen(false);
  }, []);

  const handleDeleteMessage = useCallback((messageId: string) => {
    chatDispatch({ type: 'UPDATE_MESSAGES', updater: prev => prev.filter(m => m.id !== messageId) });
  }, []);

  const handleEditMessage = useCallback(async (messageId: string, nextContent: string) => {
    const currentMessages = messagesRef.current;
    const messageIndex = currentMessages.findIndex((message) => message.id === messageId);
    if (messageIndex < 0) return false;

    const targetMessage = currentMessages[messageIndex];
    if (!targetMessage || targetMessage.role !== 'user') return false;

    const normalizedContent = nextContent.trim();
    if (!normalizedContent && (!targetMessage.images || targetMessage.images.length === 0)) {
      return false;
    }

    const applyLocalUpdate = () => {
      chatDispatch({
        type: 'UPDATE_MESSAGES',
        updater: (prev) => prev.map((message) => {
          if (message.id !== messageId) return message;
          return {
            ...message,
            content: normalizedContent,
            contentBlocks: message.contentBlocks?.some((block) => block.type === 'text')
              ? [{ type: 'text', text: normalizedContent }]
              : message.contentBlocks,
          };
        }),
      });
    };

    const currentSessionId = sessionIdRef.current;
    if (!currentSessionId) {
      applyLocalUpdate();
      return true;
    }

    try {
      const response = await fetch(`/api/agent-chat/sessions/${currentSessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'updateUserMessage',
          messageIndex,
          frontendMessageCount: currentMessages.length,
          content: normalizedContent,
        }),
      });
      if (!response.ok) return false;
      applyLocalUpdate();
      return true;
    } catch {
      return false;
    }
  }, []);

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
      const newItem: import('./types').SessionListItem = {
        id: data.sessionId,
        title: data.title,
        updatedAt: new Date().toISOString(),
        unreadCount: 0,
      };
      sessionDispatch({ type: 'UPDATE_LIST', updater: (prev) => upsertSessionListItem(prev, newItem) });

      if (streamAbortRef.current) {
        streamAbortRef.current.abort();
        streamAbortRef.current = null;
      }
      chatDispatch({ type: 'RESET' });
      blocksRef.current = [];
      fullTextRef.current = '';
      toolCallsRef.current = [];
      streamTargetSessionRef.current = null;
      finalizingRef.current = false;

      initTokenRef.current += 1;
      const token = initTokenRef.current;
      sessionDispatch({ type: 'SELECT', id: newItem.id, title: newItem.title });
      sessionIdRef.current = newItem.id;
      setShowConfig(false);
      setCompressDismissed(false);
      pendingAnswerRef.current = null;
      await loadSessionData(newItem.id, token);

      onSessionChange?.(newItem);
    } catch {
      // ignore
    }
  }, [loadSessionData, setSessionIdSync, onSessionChange]);

  const handleRegenerate = useCallback(() => {
    if (isStreamingRef.current) return;
    chatDispatch({ type: 'UPDATE_MESSAGES', updater: prev => {
      const lastUserIdx = prev.reduce((acc, m, i) => (m.role === 'user' ? i : acc), -1);
      if (lastUserIdx === -1) return prev;
      const lastUserMsg = prev[lastUserIdx];
      const trimmed = prev.slice(0, lastUserIdx + 1);
      setTimeout(() => doSendRef.current(lastUserMsg.content), 0);
      return trimmed.slice(0, -1);
    } });
  }, []);

  const handleRetry = useCallback(() => {
    if (isStreamingRef.current) return;
    const currentMessages = messagesRef.current;
    const lastUserMsg = [...currentMessages].reverse().find(m => m.role === 'user');
    if (!lastUserMsg) return;
    chatDispatch({ type: 'UPDATE_MESSAGES', updater: prev => prev.filter(m => m.id !== lastUserMsg.id) });
    chatDispatch({ type: 'CLEAR_ERROR' });
    setTimeout(() => doSendRef.current(lastUserMsg.content), 0);
  }, []);

  // Whether to show guest picker in ChatInput
  const showGuestPicker = !!sessionId && !isStreaming && messages.length > 0;

  // Dismiss callbacks (stable references)
  const handleDismissKnowledge = useCallback(() => setKnowledgeDrafts([]), []);
  const handleDismissDocs = useCallback(() => setDocsSaved([]), []);
  const handleScrollToAction = useCallback((actionType: string) => {
    const el = document.querySelector(`[data-action-type="${actionType}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // 短暂高亮闪烁提示
      el.classList.add('ring-2', 'ring-offset-1', 'ring-yellow-400');
      setTimeout(() => el.classList.remove('ring-2', 'ring-offset-1', 'ring-yellow-400'), 1500);
    }
  }, []);
  const handleDismissTopicCompletion = useCallback(() => setTopicCompletion(null), []);
  const handleSelectGuest = useCallback((a: Agent) => setGuestAgent(a), []);

  const handleViewPlan = useCallback((content: string) => {
    setPlanContent(content);
    setIsPlanOpen(true);
  }, []);

  const handleActionPreview = useCallback((tag: ParsedActionTag) => {
    setActionPreviewTag(tag);
    setIsActionPanelOpen(true);
    // Close plan panel if open to avoid overlap
    setIsPlanOpen(false);
  }, []);

  const handleActionReject = useCallback((_tag: ParsedActionTag) => {
    // For now, just visual — future: call API to undo the action
  }, []);

  const handleActionRestore = useCallback((_tag: ParsedActionTag) => {
    // For now, just visual — future: call API to re-execute the action
  }, []);

  const handleFileClick = useCallback((filePath: string) => {
    setPreviewFilePath(filePath);
  }, []);

  // ── Shared UI pieces ──

  const thinkingText = hasProject ? t('chat.thinking') : '思考中...';

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

  const actionPanel = actionPreviewTag ? (
    <div
      className={`shrink-0 overflow-hidden border-l border-zinc-200 transition-[width] duration-200 ease-in-out dark:border-zinc-800 ${
        isActionPanelOpen ? 'w-[400px]' : 'w-0 border-l-0'
      }`}
    >
      <div className="h-full w-[400px]">
        <ActionContentPanel tag={actionPreviewTag} onClose={() => setIsActionPanelOpen(false)} />
      </div>
    </div>
  ) : null;

  const chatInputProps = {
    onSubmit: handleChatInputSubmit,
    onAbort: handleAbort,
    isStreaming,
    providerOptions,
    providerValue: chatProvider,
    onProviderChange: (next: string) => setChatProvider(next as ProviderId),
    modelProviderLabel: PROVIDER_LABELS[chatProvider],
    modelOptions: chatModelOptions,
    modelValue: chatModel,
    onModelChange: setChatModel,
    effortLabel: chatProvider === 'openai' ? '推理档位' : undefined,
    effortOptions: chatProvider === 'openai' ? effortOptions : undefined,
    effortValue: chatProvider === 'openai' ? chatEffort : undefined,
    onEffortChange: chatProvider === 'openai' ? ((v: string) => setChatEffort(v as OpenAIReasoningEffort)) : undefined,
    guestAgents,
    showGuestPicker,
    onSelectGuest: handleSelectGuest,
    draftKey: sessionId ?? undefined,
    enableSlashCommands: true,
    tokenInfo: { promptEstimate, inputTokens: tokenInputs, outputTokens: tokenOutputs, contextWindow: effectiveContextWindow },
  };

  const notificationBanners = !isStreaming ? (
    <ChatNotificationBanners
      knowledgeDrafts={knowledgeDrafts}
      docsSaved={docsSaved}
      topicCompletion={topicCompletion}
      onDismissKnowledge={handleDismissKnowledge}
      onDismissDocs={handleDismissDocs}
      onDismissTopicCompletion={handleDismissTopicCompletion}
      onScrollToAction={handleScrollToAction}
      checkpointSaved={checkpointSaved}
      onResumeCheckpoint={handleResumeCheckpoint}
      onDismissCheckpoint={handleDismissCheckpoint}
    />
  ) : null;

  const dialogs = (
    <>
      {guestAgent && sessionId && (
        <GuestAgentOverlay
          agent={guestAgent}
          parentSessionId={sessionId}
          onClose={() => setGuestAgent(null)}
        />
      )}
      {saveDialogContent !== null && (
        <SaveKnowledgeDialog
          content={saveDialogContent}
          onClose={() => setSaveDialogContent(null)}
        />
      )}
      {previewFilePath && (
        <FilePreviewDialog
          filePath={previewFilePath}
          onClose={() => setPreviewFilePath(null)}
        />
      )}
      <SessionCompressDialog
        open={compressDialogOpen}
        onClose={() => setCompressDialogOpen(false)}
        sessionId={sessionId}
        messages={messages}
        onConfirm={handleCompressConfirm}
      />
    </>
  );

  const configDrawer = (
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
          {...(!hasProject ? { agentSystemPrompt: agent.systemPrompt, agentCapabilities: agent.capabilities } : {})}
        />
      </div>
    </div>
  );

  const runtimeDrawer = (
    <div
      className={`shrink-0 overflow-hidden border-l border-zinc-200 transition-[width] duration-200 ease-in-out dark:border-zinc-800 ${
        showRuntimePanel ? 'w-[300px]' : 'w-0 border-l-0'
      }`}
    >
      <div className="h-full w-[300px]">
        <RuntimePanel
          agent={agent}
          sessionConfig={sessionConfig}
          onSaveConfig={handleSaveConfig}
          onClose={() => setShowRuntimePanel(false)}
        />
      </div>
    </div>
  );

  const messageListProps = {
    messages,
    isStreaming,
    streamingBlocks,
    streamingMessage,
    errorMsg,
    inPlanMode,
    thinkingText,
    onSaveAsKnowledge: handleSaveAsKnowledge,
    onDelete: handleDeleteMessage,
    onRegenerate: handleRegenerate,
    onBranch: handleBranch,
    onEdit: handleEditMessage,
    onRetry: handleRetry,
    onViewPlan: handleViewPlan,
    onFileClick: handleFileClick,
    onCompressOpen: () => setCompressDialogOpen(true),
    onCompressDismiss: () => setCompressDismissed(true),
    enableUserMessageEdit: !hasProject,
    showUserMessageBranch: hasProject,
    onActionPreview: handleActionPreview,
    onActionReject: handleActionReject,
    onActionRestore: handleActionRestore,
  };

  const plainToolbar = (
    <div className="flex items-center justify-end gap-0.5 border-b border-zinc-100 px-3 py-1.5 dark:border-zinc-800">
      <button
        type="button"
        onClick={() => setShowConfig(v => !v)}
        className={`p-1 rounded transition-colors ${
          showConfig
            ? 'text-blue-500 dark:text-blue-400'
            : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300'
        }`}
      >
        <Settings className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={() => setShowRuntimePanel(v => !v)}
        className={`p-1 rounded transition-colors ${
          showRuntimePanel
            ? 'text-blue-500 dark:text-blue-400'
            : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300'
        }`}
      >
        <PanelRight className="h-3.5 w-3.5" />
      </button>
    </div>
  );

  const plainEmptyState = (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-zinc-400">
      <Bot className="h-10 w-10 stroke-1" />
      <p className="text-sm">Send a message to {agent.name} to start chatting.</p>
    </div>
  );

  const plainMessageList = (
    <ChatMessageList
      {...messageListProps}
      showCompressHint={messages.length > 20 && !compressDismissed && !isStreaming}
    />
  );

  const plainInput = (
    <div className="border-t border-zinc-200 p-3 dark:border-zinc-800">
      <ChatInput
        {...chatInputProps}
        placeholder={`Send a message to ${agent.name}...`}
      />
    </div>
  );

  const projectHeader = (
    <ChatSessionHeader
      isFull={isFull}
      sessionId={sessionId}
      sessionTitle={sessionTitle}
      sessionList={sessionList}
      sessionClockNow={sessionClockNow}
      sessionConfig={sessionConfig}
      isStreaming={isStreaming}
      showConfig={showConfig}
      parentSession={parentSession}
      childSessions={childSessions}
      showChildList={showChildList}
      messages={messages}
      sessionDispatch={sessionDispatch}
      onSwitchSession={handleSwitchSession}
      onNewSession={handleNewSession}
      onDelete={handleDelete}
      onToggleConfig={() => setShowConfig(v => !v)}
      onCompressOpen={() => setCompressDialogOpen(true)}
      showRuntimePanel={showRuntimePanel}
      onToggleRuntimePanel={() => setShowRuntimePanel(v => !v)}
    />
  );

  const projectTaskBanner = taskCard ? <TaskCardBanner card={taskCard} /> : null;

  const projectEmptyState = (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-zinc-400">
      <Sparkles className="h-8 w-8 stroke-1" />
      <p className="text-xs">{t('chat.plannerHint')}</p>
    </div>
  );

  const projectMessageList = (
    <ChatMessageList
      {...messageListProps}
      showCompressHint={messages.length >= 20 && !compressDismissed && !isStreaming}
    />
  );

  const projectInput = (
    <div className="border-t border-zinc-100 p-2 dark:border-zinc-800">
      <ChatInput
        {...chatInputProps}
        placeholder={t('chat.plannerPlaceholder')}
        minHeight={isFull ? '120px' : '200px'}
        fullWidth
      />
    </div>
  );

  const queueOverlay = (
    <ChatQueueOverlay
      pendingMessages={pendingUserMessages}
      expanded={queueExpanded}
      onToggleExpanded={updateQueueExpanded}
      onSendNow={handleSendNow}
      onRemove={handleRemoveFromQueue}
    />
  );

  const timeline = (
    <ChatScrollTimeline
      messages={messages}
      isStreaming={isStreaming}
      streamingBlocks={streamingBlocks}
      currentMessageId={currentMessageId}
      onSelectMessage={handleSelectTimelineMessage}
    />
  );

  const folderExplorer = (
    <div
      className={`shrink-0 overflow-hidden border-l border-zinc-200 transition-[width] duration-200 ease-in-out dark:border-zinc-800 ${
        showFolderExplorer ? 'w-[280px]' : 'w-0 border-l-0'
      }`}
    >
      <div className="h-full w-[280px]">
        <FolderExplorerPanel
          onClose={() => setShowFolderExplorer(false)}
          onInsertPath={handleInsertFilePath}
          initialPath={projectPath}
        />
      </div>
    </div>
  );

  const sidebar = (
    <ChatSessionSidebar
      sessionList={sessionList}
      currentSessionId={sessionId}
      sessionClockNow={sessionClockNow}
      isStreaming={isStreaming}
      onSwitchSession={handleSwitchSession}
      onNewSession={handleNewSession}
    />
  );

  return (
    <AgentChatPanelView
      hasProject={hasProject}
      isFull={isFull}
      projectKey={projectKey}
      selectProjectHint={t('projects.selectFirst')}
      scrollRef={scrollRef}
      onChatScroll={handleChatScroll}
      hasPendingQueue={isStreaming && pendingUserMessages.length > 0}
      plainScrollClassName="px-4 py-4 pr-24"
      projectScrollClassName="px-3 py-3 pr-22"
      plainToolbar={plainToolbar}
      showPlainEmptyState={messages.length === 0 && !isStreaming}
      plainEmptyState={plainEmptyState}
      plainMessageList={plainMessageList}
      plainInput={plainInput}
      projectHeader={projectHeader}
      projectTaskBanner={projectTaskBanner}
      showProjectEmptyState={messages.length === 0 && !isStreaming}
      projectEmptyState={projectEmptyState}
      projectMessageList={projectMessageList}
      projectInput={projectInput}
      timeline={timeline}
      queueOverlay={queueOverlay}
      notificationBanners={notificationBanners}
      dialogs={dialogs}
      configDrawer={configDrawer}
      runtimeDrawer={runtimeDrawer}
      folderExplorer={folderExplorer}
      planPanel={planPanel}
      actionPanel={actionPanel}
      sidebar={sidebar}
    />
  );
}
