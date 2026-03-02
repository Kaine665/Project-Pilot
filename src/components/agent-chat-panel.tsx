'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Loader2, Maximize2, Minimize2, Bot, Sparkles, Plus, MessageSquare, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { ChatBubble } from '@/components/chat-bubble';
import { ChatInput } from '@/components/chat-input';
import { ChatNotificationBanners } from '@/components/chat-notification-banners';
import { SaveKnowledgeDialog } from '@/components/save-knowledge-dialog';
import { SessionDropdown } from '@/components/session-dropdown';
import { GuestAgentOverlay } from '@/components/guest-agent-overlay';
import type { Agent } from '@/types';
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

// Strip <session-title> tags from display text
function stripSessionTitleTag(text: string): string {
  return text.replace(/<session-title>[\s\S]*?<\/session-title>\s*/, '');
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

  // Guest Agent（旁听 Agent）
  const [guestAgent, setGuestAgent] = useState<Agent | null>(null);
  const [guestAgents, setGuestAgents] = useState<Agent[]>([]);

  // Knowledge draft notifications (auto-path)
  const [knowledgeDrafts, setKnowledgeDrafts] = useState<Array<{ entryId: string; label: string }>>([]);

  // Design doc saved notifications (auto-path)
  const [docsSaved, setDocsSaved] = useState<Array<{ docId: string; title: string; projectKey: string }>>([]);

  // Save as knowledge dialog
  const [saveDialogContent, setSaveDialogContent] = useState<string | null>(null);

  const streamAbortRef = useRef<AbortController | null>(null);
  const blocksRef = useRef<ContentBlock[]>([]);
  const rafIdRef = useRef<number>(0);
  const fullTextRef = useRef('');
  const toolCallsRef = useRef<ChatToolCall[]>([]);
  const lastEventIdxRef = useRef<number>(-1);
  const finalizingRef = useRef(false);
  const sessionIdRef = useRef<string | null>(null);
  const doSendRef = useRef<(text: string, images?: string[]) => void>(() => {});

  // Keep ref in sync
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

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

  // Load a session's full data (messages)
  const loadSessionData = useCallback(async (sid: string) => {
    try {
      const res = await fetch(`/api/agent-chat/sessions/${sid}`, { cache: 'no-store' });
      if (!res.ok) return;
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

    const fullText = fullTextRef.current;
    const toolCalls = toolCallsRef.current;
    const blocks = blocksRef.current;

    if (fullText || toolCalls.length > 0) {
      const cleanedText = stripSessionTitleTag(fullText);
      const assistantMsg: ChatMessage = {
        id: `msg-${Date.now()}`,
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
  }, [agent.id, projectKey, fetchSessionList, onSessionChange]);

  // Connect to SSE stream
  const connectToStream = useCallback((targetSessionId: string, since: number) => {
    if (streamAbortRef.current) {
      streamAbortRef.current.abort();
    }

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
      await new Promise(r => setTimeout(r, 50));
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
    resetState();

    // In project mode without projectKey, nothing to load
    if (hasProject && !projectKey) return;

    // Plain mode with null initialSessionId → new empty session
    if (!hasProject && initialSessionId === null) return;

    let cancelled = false;

    (async () => {
      const sessions: SessionListItem[] = await fetchSessionList(agent.id, projectKey);
      if (cancelled) return;

      if (!hasProject && initialSessionId) {
        // Load the specific session requested by parent (agents page)
        const target = sessions.find(s => s.id === initialSessionId);
        setSessionId(initialSessionId);
        setSessionTitle(target?.title ?? '会话');
        await loadSessionData(initialSessionId);
      } else if (sessions.length > 0) {
        // Auto-select latest
        const latest = sessions[0];
        setSessionId(latest.id);
        setSessionTitle(latest.title);
        await loadSessionData(latest.id);
      }

      // Check if a run is still live in memory
      const sessionIdsToCheck = (!hasProject && initialSessionId)
        ? [initialSessionId]
        : sessions.map(s => s.id);

      for (const sid of sessionIdsToCheck) {
        const statusRes = await fetch(`/api/agent-chat/status?sessionId=${sid}`, { cache: 'no-store' });
        const statusData = await statusRes.json();
        if (!cancelled && statusData.status === 'running') {
          const title = sessions.find(s => s.id === sid)?.title ?? '会话';
          setSessionId(sid);
          setSessionTitle(title);
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

    const imagesToSend = images ?? [];
    const imageAttachments = imagesToSend.map(url => {
      const [header, data] = url.split(',');
      const mediaType = header.match(/data:([^;]+)/)?.[1] ?? 'image/png';
      return { mediaType, data };
    });

    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: text.trim(),
      timestamp: new Date().toISOString(),
      images: imagesToSend.length > 0 ? imagesToSend : undefined,
    };

    setMessages((prev) => [...prev, userMsg]);
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
          images: imageAttachments.length > 0 ? imageAttachments : undefined,
          initialTitle: text.trim().slice(0, 10) || undefined,
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
  }, [agent.id, sessionId, isStreaming, hasProject, projectKey, connectToStream, onSessionChange, t]);

  // Keep doSendRef in sync (avoid stale closure in event listener)
  useEffect(() => {
    doSendRef.current = doSend;
  }, [doSend]);

  // Listen for AskUserQuestion answers dispatched via custom event
  useEffect(() => {
    const handler = (e: Event) => {
      const answer = (e as CustomEvent<{ answer: string }>).detail?.answer;
      if (answer) {
        doSendRef.current(answer);
      }
    };
    window.addEventListener('ask-user-answer', handler);
    return () => window.removeEventListener('ask-user-answer', handler);
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
  const handleNewSession = useCallback(() => {
    if (isStreaming) return;
    if (streamAbortRef.current) {
      streamAbortRef.current.abort();
      streamAbortRef.current = null;
    }
    setSessionId(null);
    setSessionTitle(hasProject ? t('chat.newSession') : '新会话');
    setMessages([]);
    blocksRef.current = [];
    fullTextRef.current = '';
    toolCallsRef.current = [];
  }, [isStreaming, hasProject, t]);

  // Switch to an existing session
  const handleSwitchSession = useCallback(async (target: SessionListItem) => {
    if (isStreaming) return;
    if (streamAbortRef.current) {
      streamAbortRef.current.abort();
      streamAbortRef.current = null;
    }
    setSessionId(target.id);
    setSessionTitle(target.title);
    setMessages([]);
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
    await loadSessionData(target.id);
  }, [isStreaming, loadSessionData]);

  const handleSaveAsKnowledge = useCallback((_messageId: string, content: string) => {
    setSaveDialogContent(content);
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

  // ── Message list (shared between modes) ──
  const renderMessages = () => (
    <>
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
      <div className="relative flex h-full flex-col">
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
            guestAgents={guestAgents}
            showGuestPicker={showGuestPicker}
            onSelectGuest={handleSelectGuest}
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
    <div className="relative flex h-full flex-col">
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

      {/* Messages */}
      <div ref={scrollRef} onScroll={handleChatScroll} className="flex-1 space-y-3 overflow-y-auto p-3">
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
          guestAgents={guestAgents}
          showGuestPicker={showGuestPicker}
          onSelectGuest={handleSelectGuest}
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
