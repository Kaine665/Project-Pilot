'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Loader2, Maximize2, Minimize2, Bot, Sparkles, Plus, MessageSquare, Trash2, Settings, FileDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { ChatBubble } from '@/components/chat-bubble';
import { ChatInput } from '@/components/chat-input';
import { ChatNotificationBanners } from '@/components/chat-notification-banners';
import { SaveKnowledgeDialog } from '@/components/save-knowledge-dialog';
import { SessionDropdown } from '@/components/session-dropdown';
import { GuestAgentOverlay } from '@/components/guest-agent-overlay';
import { SessionConfigPanel } from '@/components/session-config-panel';
import { PlanViewerPanel } from '@/components/plan-viewer-panel';
import { SessionCompressDialog } from '@/components/session-compress-dialog';
import { PROVIDER_REGISTRY, getProviderPreset } from '@/lib/provider-registry';
import type { Agent, ProviderId, OpenAIReasoningEffort } from '@/types';
import type { SessionConfig } from '@/types/agent-chat';
import type { ChatMessage, ChatToolCall, ChatSSEEvent, ContentBlock } from '@/types';

// Session list item (no messages)
export interface SessionListItem {
  id: string;
  title: string;
  updatedAt: string;
  unreadCount?: number;
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

// Strip <session-title> tags from display text (fallback cleanup)
function stripSessionTitleTag(text: string): string {
  return text.replace(/<session-title>[\s\S]*?<\/session-title>\s*/, '');
}

/**
 * Streaming filter for <session-title> tags.
 * Buffers partial tag content and strips completed tags from display text.
 * Returns only the text that should be shown to the user.
 */
function createSessionTitleFilter() {
  let buffer = '';              // accumulates text inside (or possibly part of) a tag
  let insideTag = false;        // true when we've seen <session-title> and are waiting for </session-title>
  let partialOpen = '';         // accumulates a partial opening tag like "<ses" or "<session-ti"

  const OPEN_TAG = '<session-title>';
  const CLOSE_TAG = '</session-title>';

  return (chunk: string): string => {
    let output = '';
    let i = 0;

    while (i < chunk.length) {
      const ch = chunk[i];

      if (insideTag) {
        // Inside <session-title>..., looking for </session-title>
        buffer += ch;
        if (buffer.endsWith(CLOSE_TAG)) {
          // Complete tag found — discard entire buffer
          buffer = '';
          insideTag = false;
          // Also strip any trailing whitespace/newlines
          i++;
          while (i < chunk.length && (chunk[i] === '\n' || chunk[i] === '\r' || chunk[i] === ' ')) {
            i++;
          }
          continue;
        }
        i++;
        continue;
      }

      if (partialOpen) {
        // We had a partial match for <session-title>
        partialOpen += ch;
        if (OPEN_TAG.startsWith(partialOpen)) {
          // Still a valid prefix — keep buffering
          if (partialOpen === OPEN_TAG) {
            // Full open tag matched!
            insideTag = true;
            buffer = '';
            partialOpen = '';
          }
          i++;
          continue;
        }
        // Not a match — flush the buffered partial as normal output
        output += partialOpen;
        partialOpen = '';
        i++;
        continue;
      }

      if (ch === '<') {
        // Potential start of <session-title>
        partialOpen = '<';
        i++;
        continue;
      }

      output += ch;
      i++;
    }

    return output;
  };
}

export function AgentChatPanel({
  agent,
  initialSessionId,
  onSessionChange,
  variant,
  projectKey,
}: AgentChatPanelProps) {
  const t = useTranslations();
  const router = useRouter();
  const hasProject = !!variant && !!projectKey;
  const isFull = variant === 'full';

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingBlocks, setStreamingBlocks] = useState<ContentBlock[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Session management
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionList, setSessionList] = useState<SessionListItem[]>([]);
  const [sessionTitle, setSessionTitle] = useState(hasProject ? t('chat.newSession') : '新会话');

  // Provider / model routing
  const [chatProvider, setChatProvider] = useState<ProviderId>('anthropic');
  const [chatModel, setChatModel] = useState('claude-sonnet-4-5-20250929');
  const [chatModelOptions, setChatModelOptions] = useState<ModelSelectOption[]>([
    { value: 'claude-sonnet-4-5-20250929', label: 'Claude Sonnet 4.5' },
  ]);
  const [chatEffort, setChatEffort] = useState<OpenAIReasoningEffort>('xhigh');

  // Guest Agent（旁听 Agent）
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

  // Plan viewer
  const [planContent, setPlanContent] = useState<string | null>(null);
  const [isPlanOpen, setIsPlanOpen] = useState(false);

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
  const pendingAnswerRef = useRef<string | null>(null);

  // Keep refs in sync
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    isStreamingRef.current = isStreaming;
  }, [isStreaming]);

  // Stable streaming message object
  const streamingMessage = useMemo<ChatMessage>(() => ({
    id: 'streaming',
    role: 'assistant',
    content: '',
    timestamp: '',
  }), []);

  // Load guest agent candidates (chat-mode agents, excluding current agent)
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/agents', { cache: 'no-store' });
        const data = await res.json();
        const available = (data.agents ?? []).filter(
          (a: Agent) => !a.archived && a.executionMode !== 'task' && a.id !== agent.id,
        );
        setGuestAgents(available);
      } catch {
        // ignore
      }
    })();
  }, [agent.id]);

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

  // Load provider/model from global settings
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
        setChatProvider(loadedProvider);
        setChatModelOptions(options);
        setChatModel(selected);
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
  }, []);

  // Update model options when provider changes (+ fetch OpenAI catalog)
  useEffect(() => {
    let cancelled = false;
    const preset = getProviderPreset(chatProvider);
    const options = preset.models.map((m) => ({ value: m.id, label: m.label || m.id }));

    if (chatProvider === 'openai') {
      // Fetch dynamic OpenAI model catalog
      (async () => {
        try {
          const res = await fetch('/api/settings/openai-models', { cache: 'no-store' });
          const data = await res.json();
          if (cancelled) return;
          if (res.ok && data?.ok && Array.isArray(data.models)) {
            const knownIds = new Set(options.map((o) => o.value));
            for (const r of data.models) {
              if (r && typeof r === 'object' && typeof r.id === 'string') {
                const id = r.id.trim();
                if (id && !knownIds.has(id)) {
                  options.push({ value: id, label: typeof r.displayName === 'string' ? r.displayName : id });
                  knownIds.add(id);
                }
              }
            }
          }
        } catch {
          // ignore — fallback to static models
        }
        if (!cancelled) {
          setChatModelOptions(options);
          if (!options.some((o) => o.value === chatModel)) {
            setChatModel(options[0]?.value || '');
          }
        }
      })();
    } else {
      if (options.length > 0) {
        setChatModelOptions(options);
        if (!options.some((o) => o.value === chatModel)) {
          setChatModel(options[0].value);
        }
      }
    }
    return () => { cancelled = true; };
  }, [chatProvider]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch session list
  const fetchSessionList = useCallback(async (agentId: string, pk?: string | null) => {
    try {
      let url = `/api/agent-chat/sessions?agentId=${agentId}`;
      if (pk) url += `&projectKey=${pk}`;
      const res = await fetch(url, { cache: 'no-store' });
      const data = await res.json();
      const remote: SessionListItem[] = data.sessions ?? [];
      // Merge: keep optimistically-inserted local sessions that backend doesn't know about yet
      setSessionList(prev => {
        const remoteIds = new Set(remote.map(s => s.id));
        const localOnly = prev.filter(s => !remoteIds.has(s.id));
        return [...localOnly, ...remote];
      });
      return remote;
    } catch {
      return [];
    }
  }, []);

  // Load a session's full data (messages + config)
  const loadSessionData = useCallback(async (sid: string, token?: number) => {
    try {
      const res = await fetch(`/api/agent-chat/sessions/${sid}`, { cache: 'no-store' });
      if (!res.ok) return;
      if (token !== undefined && initTokenRef.current !== token) return;
      const data = await res.json();
      const restored: ChatMessage[] = (data.messages ?? []).map(
        (m: { role: 'user' | 'assistant'; content: string; contentBlocks?: ContentBlock[] }, i: number) => ({
          id: `restored-${i}`,
          role: m.role,
          content: m.content,
          contentBlocks: m.contentBlocks,
          timestamp: '',
        }),
      );
      setMessages(restored);
      setSessionTitle(data.title ?? '新会话');
      setSessionConfig(data.config ?? {});
    } catch {
      // ignore
    }
  }, []);

  // Finalize streaming → commit assistant message
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

    setIsStreaming(false);
    setStreamingBlocks([]);
    blocksRef.current = [];
    fullTextRef.current = '';
    toolCallsRef.current = [];
    lastEventIdxRef.current = -1;
    streamAbortRef.current = null;
    streamTargetSessionRef.current = null;
    finalizingRef.current = false;

    // Mark current session as read (user was watching the stream)
    const currentSid = sessionIdRef.current;
    if (currentSid) {
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

    // Auto-send queued AskUserQuestion answer from the previous turn
    const pendingAnswer = pendingAnswerRef.current;
    pendingAnswerRef.current = null;
    if (pendingAnswer) {
      setTimeout(() => doSendRef.current(pendingAnswer), 300);
    }
  }, [agent.id, projectKey, fetchSessionList, onSessionChange]);

  // Connect to SSE stream
  const connectToStream = useCallback((targetSessionId: string, since: number) => {
    if (streamAbortRef.current) {
      streamAbortRef.current.abort();
    }

    // Track which session this stream belongs to
    streamTargetSessionRef.current = targetSessionId;

    const abort = new AbortController();
    streamAbortRef.current = abort;
    const titleFilter = createSessionTitleFilter();

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
              // Filter out <session-title>...</session-title> from display
              const displayText = titleFilter(event.text);
              if (displayText) {
                const lastBlock = blocks[blocks.length - 1];
                if (lastBlock && lastBlock.type === 'text') {
                  lastBlock.text += displayText;
                } else {
                  blocks.push({ type: 'text', text: displayText });
                }
                chunkHasDisplayEvents = true;
              }
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

              // Detect Write to .claude/plans/ → capture plan content
              if (event.toolName === 'Write') {
                try {
                  const parsed = typeof event.input === 'string' ? JSON.parse(event.input) : event.input;
                  if (parsed?.file_path?.includes('.claude/plans/')) {
                    setPlanContent(parsed.content);
                    setIsPlanOpen(true);
                  }
                } catch { /* ignore parse errors */ }
              }
              break;
            }

            case 'tool_use_end': {
              const tc = toolCallsRef.current.find((t) => t.id === event.id);
              if (tc) {
                tc.output = event.output;
                tc.status = event.status;
                chunkHasDisplayEvents = true;
              }
              break;
            }

            case 'session_title_set':
              setSessionTitle(event.title);
              setSessionList(prev => prev.map(s =>
                s.id === targetSessionId ? { ...s, title: event.title } : s,
              ));
              onSessionChange?.();
              break;

            case 'knowledge_draft_created':
              setKnowledgeDrafts(prev => [...prev, { entryId: event.entryId, label: event.label }]);
              break;

            case 'doc_created':
              setDocsSaved(prev => [...prev, { docId: event.docId, title: event.title, projectKey: event.projectKey }]);
              break;

            case 'error':
              console.error('Agent chat stream error:', event.message);
              setErrorMsg(event.message ?? 'Stream error');
              break;

            case 'done':
              break;
          }
        }

        if (chunkHasDisplayEvents) {
          setStreamingBlocks([...blocksRef.current]);
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
    setSessionId(null);
    setSessionTitle(hasProject ? t('chat.newSession') : '新会话');
    setSessionList([]);
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
  }, [hasProject, t]);

  // Initialize: load sessions and auto-select
  useEffect(() => {
    let cancelled = false;
    const token = ++initTokenRef.current;
    const isStale = () => cancelled || initTokenRef.current !== token;

    resetState();

    // In project mode without projectKey, nothing to load
    if (hasProject && !projectKey) return;

    // Plain mode with null initialSessionId → new empty session
    if (!hasProject && initialSessionId === null) return;

    (async () => {
      const sessions: SessionListItem[] = await fetchSessionList(agent.id, projectKey);
      if (isStale()) return;

      if (!hasProject && initialSessionId) {
        // Load the specific session requested by parent (agents page)
        const target = sessions.find(s => s.id === initialSessionId);
        sessionIdRef.current = initialSessionId;
        setSessionId(initialSessionId);
        setSessionTitle(target?.title ?? '会话');
        await loadSessionData(initialSessionId, token);
        if (isStale()) return;
      } else if (sessions.length > 0) {
        // Auto-select latest
        const latest = sessions[0];
        sessionIdRef.current = latest.id;
        setSessionId(latest.id);
        setSessionTitle(latest.title);
        await loadSessionData(latest.id, token);
        if (isStale()) return;
      }

      // Check if a run is still live in memory
      const sessionIdsToCheck = (!hasProject && initialSessionId)
        ? [initialSessionId]
        : sessions.map(s => s.id);

      for (const sid of sessionIdsToCheck) {
        if (isStale()) return;
        const statusRes = await fetch(`/api/agent-chat/status?sessionId=${sid}`, { cache: 'no-store' });
        const statusData = await statusRes.json();
        if (!isStale() && statusData.status === 'running') {
          const title = sessions.find(s => s.id === sid)?.title ?? '会话';
          sessionIdRef.current = sid;
          setSessionId(sid);
          setSessionTitle(title);
          await loadSessionData(sid, token);
          if (isStale()) return;
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
          setIsStreaming(true);
          blocksRef.current = [];
          fullTextRef.current = '';
          toolCallsRef.current = [];
          connectToStream(sid, 0);
          break;
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
    const imageAttachments = imagesToSend.map(url => {
      const [header, data] = url.split(',');
      const mediaType = header.match(/data:([^;]+)/)?.[1] ?? 'image/png';
      return { mediaType, data };
    });

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
      const quickTitle = text.trim().slice(0, 10) || (hasProject ? t('chat.newSession') : '新会话');
      setSessionId(targetSessionId);
      setSessionTitle(quickTitle);
      // Insert into session list immediately so it appears in history
      const newItem: SessionListItem = {
        id: targetSessionId!,
        title: quickTitle,
        updatedAt: new Date().toISOString(),
      };
      setSessionList(prev => [newItem, ...prev]);
      onSessionChange?.(newItem);
    }

    try {
      const res = await fetch('/api/agent-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: agent.id,
          message: text.trim(),
          sessionId: targetSessionId,
          projectKey: projectKey ?? undefined,
          providerOverride: chatProvider,
          modelOverride: chatModel || undefined,
          effortOverride: chatProvider === 'openai' ? chatEffort : undefined,
          images: imageAttachments.length > 0 ? imageAttachments : undefined,
          initialTitle: text.trim().slice(0, 10) || undefined,
          config: (sessionConfig.contextIds?.length || sessionConfig.supplementaryPrompt?.trim())
            ? sessionConfig : undefined,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${res.status}`);
      }

      await res.json();
      connectToStream(targetSessionId, 0);
    } catch (err) {
      const msg = (err as Error).message || 'Unknown error';
      console.error('Agent chat send failed:', msg);
      setErrorMsg(msg);
      setIsStreaming(false);
    }
  }, [agent.id, sessionId, isStreaming, hasProject, projectKey, chatProvider, chatModel, chatEffort, connectToStream, onSessionChange, t, sessionConfig]);

  // Keep doSendRef in sync (avoid stale closure in event listener)
  useEffect(() => {
    doSendRef.current = doSend;
  }, [doSend]);

  // Listen for AskUserQuestion answers dispatched via custom event.
  // If streaming is still in progress, queue the answer and send it
  // once the current turn finishes (via finalizeStream).
  useEffect(() => {
    const handler = (e: Event) => {
      const answer = (e as CustomEvent<{ answer: string }>).detail?.answer;
      if (!answer) return;

      // If streaming is active, queue the answer for later
      if (isStreamingRef.current) {
        pendingAnswerRef.current = answer;
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

  // ChatInput submit handler
  const handleChatInputSubmit = useCallback((text: string, images: string[], _files: Array<{ name: string; content: string }>) => {
    doSend(text, images);
  }, [doSend]);

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
    finalizeStream();
  };

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
    setShowConfig(false);
    // Persist to backend if session exists on disk
    if (sessionId) {
      try {
        await fetch(`/api/agent-chat/sessions/${sessionId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'updateConfig', config }),
        });
      } catch {
        // ignore — config is already in local state for next message
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
    setSessionId(null);
    setSessionTitle(hasProject ? t('chat.newSession') : '新会话');
    setMessages([]);
    setSessionConfig({});
    setShowConfig(false);
    setCompressDismissed(false);
    blocksRef.current = [];
    fullTextRef.current = '';
    toolCallsRef.current = [];
  }, [isStreaming, hasProject, t]);

  // Switch to an existing session
  const handleSwitchSession = useCallback(async (target: SessionListItem) => {
    if (isStreaming) return;
    initTokenRef.current += 1;
    const token = initTokenRef.current;
    if (streamAbortRef.current) {
      streamAbortRef.current.abort();
      streamAbortRef.current = null;
    }
    setSessionId(target.id);
    setSessionTitle(target.title);
    setMessages([]);
    setSessionConfig({});
    setShowConfig(false);
    setCompressDismissed(false);
    blocksRef.current = [];
    fullTextRef.current = '';
    toolCallsRef.current = [];
    // Mark as read
    if (target.unreadCount) {
      setSessionList(prev => prev.map(s => s.id === target.id ? { ...s, unreadCount: 0 } : s));
      fetch(`/api/agent-chat/sessions/${target.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'markAsRead' }),
      }).catch(() => {});
    }
    await loadSessionData(target.id, token);
  }, [isStreaming, loadSessionData]);

  const handleSaveAsKnowledge = useCallback((_messageId: string, content: string) => {
    setSaveDialogContent(content);
  }, []);

  // Compress: confirm handler
  const handleCompressConfirm = useCallback((compressedMessages: ChatMessage[]) => {
    setMessages(compressedMessages);
    setCompressDialogOpen(false);
    // TODO: 未来需要调 API 持久化压缩后的消息
  }, []);

  // Delete a single message from the conversation
  const handleDeleteMessage = useCallback((messageId: string) => {
    setMessages(prev => prev.filter(m => m.id !== messageId));
  }, []);

  // Regenerate: remove the last assistant message and resend the last user message
  const handleRegenerate = useCallback(() => {
    if (isStreaming) return;
    setMessages(prev => {
      // Find the last user message
      const lastUserIdx = prev.reduce((acc, m, i) => (m.role === 'user' ? i : acc), -1);
      if (lastUserIdx === -1) return prev;
      const lastUserMsg = prev[lastUserIdx];
      // Remove all messages after (and including) the last assistant message after this user msg
      const trimmed = prev.slice(0, lastUserIdx + 1);
      // Re-send the user's message
      setTimeout(() => doSend(lastUserMsg.content), 0);
      // Remove the user msg too since doSend will re-add it
      return trimmed.slice(0, -1);
    });
  }, [isStreaming, doSend]);

  // Retry: resend the last user message (for failed sends)
  const handleRetry = useCallback(() => {
    if (isStreaming) return;
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
    if (!lastUserMsg) return;
    // Remove the failed user message and the error, then re-send
    setMessages(prev => prev.filter(m => m.id !== lastUserMsg.id));
    setErrorMsg(null);
    setTimeout(() => doSend(lastUserMsg.content), 0);
  }, [isStreaming, messages, doSend]);

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
      {/* 自动压缩提示条 */}
      {messages.length > 20 && !compressDismissed && !isStreaming && (
        <div className="mb-2 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2 text-xs dark:border-amber-800 dark:bg-amber-950/30">
          <FileDown className="h-3.5 w-3.5 shrink-0 text-amber-500" />
          <span className="flex-1 text-amber-700 dark:text-amber-400">
            会话较长（{messages.length}条消息），建议压缩历史以延长上下文
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
          showActions={!isStreaming}
          onSaveAsKnowledge={handleSaveAsKnowledge}
          onDelete={handleDeleteMessage}
          onRegenerate={handleRegenerate}
          isLastAssistant={msg.id === lastAssistantId}
          onRetry={handleRetry}
          hasSendError={!!errorMsg && msg.role === 'user' && msg.id === messages[messages.length - 1]?.id}
          onViewPlan={handleViewPlan}
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
      <div className="relative flex h-full flex-1 flex-col min-w-0">
        {/* Session Config Panel (collapsible, toggled from parent page header) */}
        {showConfig && (
          <div className="border-b border-zinc-100 dark:border-zinc-800 max-h-[50%] overflow-hidden">
            <SessionConfigPanel
              sessionId={sessionId ?? '_new'}
              config={sessionConfig}
              onSave={handleSaveConfig}
              onClose={() => setShowConfig(false)}
            />
          </div>
        )}

        {/* Messages */}
        <div ref={scrollRef} onScroll={handleChatScroll} className="flex-1 space-y-3 overflow-y-auto p-4">
          {messages.length === 0 && !isStreaming ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-zinc-400">
              <Bot className="h-10 w-10 stroke-1" />
              <p className="text-sm">向 {agent.name} 发送消息开始对话</p>
            </div>
          ) : renderMessages()}
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
            placeholder={`向 ${agent.name} 发送消息...`}
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

        {/* Session compress dialog */}
        <SessionCompressDialog
          open={compressDialogOpen}
          onClose={() => setCompressDialogOpen(false)}
          messages={messages}
          onConfirm={handleCompressConfirm}
        />
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
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-blue-500" />
          {isFull ? (
            <span className="text-xs font-medium text-zinc-500 truncate">{sessionTitle}</span>
          ) : (
            <SessionDropdown
              sessionTitle={sessionTitle}
              sessions={sessionList}
              currentSessionId={sessionId}
              isStreaming={isStreaming}
              onSwitch={handleSwitchSession}
              onNew={handleNewSession}
            />
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

      {/* Session Config Panel (collapsible) */}
      {showConfig && (
        <div className="border-b border-zinc-100 dark:border-zinc-800 max-h-[50%] overflow-hidden">
          <SessionConfigPanel
            sessionId={sessionId ?? '_new'}
            config={sessionConfig}
            onSave={handleSaveConfig}
            onClose={() => setShowConfig(false)}
          />
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} onScroll={handleChatScroll} className="flex-1 space-y-3 overflow-y-auto p-3">
        {/* 会话过长自动提示 */}
        {messages.length >= 20 && !compressDismissed && !isStreaming && (
          <div className="flex items-center justify-between rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
            <span>会话较长（{messages.length} 条消息），建议压缩历史以延长上下文</span>
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

      {/* Session compress dialog */}
      <SessionCompressDialog
        open={compressDialogOpen}
        onClose={() => setCompressDialogOpen(false)}
        messages={messages}
        onConfirm={handleCompressConfirm}
      />
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
                {s.id !== sessionId && !!s.unreadCount && s.unreadCount > 0 && (
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
