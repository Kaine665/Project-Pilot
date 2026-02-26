'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Send, Loader2, Maximize2, Minimize2, Square, Bot, Sparkles, ChevronDown, Plus, MessageSquare, Trash2, X, UserPlus, Paperclip, BookMarked } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { ChatBubble } from '@/components/chat-bubble';
import { GuestAgentOverlay } from '@/components/guest-agent-overlay';
import type { Agent } from '@/types';
import type { ChatMessage, ChatToolCall, ChatSSEEvent, ContentBlock } from '@/types';

interface AgentChatPanelProps {
  agent: Agent;
  /** undefined = auto-select latest; null = new empty session; string = load specific session */
  initialSessionId?: string | null;
  /** Called when sessions are created or updated (for parent to refresh sidebar) */
  onSessionChange?: () => void;
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

// Session list item (no messages)
interface SessionListItem {
  id: string;
  title: string;
  updatedAt: string;
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
  const [input, setInput] = useState('');
  const [pendingImages, setPendingImages] = useState<string[]>([]); // base64 data URLs
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingBlocks, setStreamingBlocks] = useState<ContentBlock[]>([]);
  // ── 错误必须可见 ──
  // doSend / connectToStream / stream error 事件都可能失败，
  // 此前只 console.error 导致用户看到"管家不理我"。
  // 所有错误路径必须 setErrorMsg，UI 层渲染红色提示条。
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingFiles, setPendingFiles] = useState<Array<{ name: string; content: string }>>([]);

  // Session management
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionList, setSessionList] = useState<SessionListItem[]>([]);
  const [sessionTitle, setSessionTitle] = useState(hasProject ? t('chat.newSession') : '新会话');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Guest Agent（旁听 Agent）
  const [guestAgent, setGuestAgent] = useState<Agent | null>(null);
  const [guestAgents, setGuestAgents] = useState<Agent[]>([]);
  const [guestPickerOpen, setGuestPickerOpen] = useState(false);

  // Knowledge draft notifications (auto-path)
  const [knowledgeDrafts, setKnowledgeDrafts] = useState<Array<{ entryId: string; label: string }>>([]);

  // Save as knowledge dialog (manual path)
  const [saveDialog, setSaveDialog] = useState<{ open: boolean; content: string }>({ open: false, content: '' });
  const [saveForm, setSaveForm] = useState<{ label: string; description: string; format: 'text' | 'json' | 'markdown' }>({ label: '', description: '', format: 'text' });
  const [savingKnowledge, setSavingKnowledge] = useState(false);

  const streamAbortRef = useRef<AbortController | null>(null);
  const blocksRef = useRef<ContentBlock[]>([]);
  const rafIdRef = useRef<number>(0);
  const fullTextRef = useRef('');
  const toolCallsRef = useRef<ChatToolCall[]>([]);
  const lastEventIdxRef = useRef<number>(-1);
  const finalizingRef = useRef(false);
  const sessionIdRef = useRef<string | null>(null);

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

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    if (dropdownOpen) {
      document.addEventListener('mousedown', handler);
      return () => document.removeEventListener('mousedown', handler);
    }
  }, [dropdownOpen]);

  // Fetch session list
  const fetchSessionList = useCallback(async (agentId: string, pk?: string | null) => {
    try {
      let url = `/api/agent-chat/sessions?agentId=${agentId}`;
      if (pk) url += `&projectKey=${pk}`;
      const res = await fetch(url, { cache: 'no-store' });
      const data = await res.json();
      setSessionList(data.sessions ?? []);
      return data.sessions ?? [];
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
        (m: { role: 'user' | 'assistant'; content: string }, i: number) => ({
          id: `restored-${i}`,
          role: m.role,
          content: m.content,
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

    // Refresh session list to get AI-generated title
    fetchSessionList(agent.id, projectKey).then((sessions: SessionListItem[]) => {
      const current = sessions.find((s: SessionListItem) => s.id === sessionIdRef.current);
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
      const sessionsToCheck = (!hasProject && initialSessionId)
        ? sessions.filter(s => s.id === initialSessionId)
        : sessions;

      for (const s of sessionsToCheck) {
        const statusRes = await fetch(`/api/agent-chat/status?sessionId=${s.id}`, { cache: 'no-store' });
        const statusData = await statusRes.json();
        if (!cancelled && statusData.status === 'running') {
          setSessionId(s.id);
          setSessionTitle(s.title);
          if (Array.isArray(statusData.messages) && statusData.messages.length > 0) {
            const restored: ChatMessage[] = statusData.messages.map(
              (m: { role: 'user' | 'assistant'; content: string }, i: number) => ({
                id: `restored-${i}`,
                role: m.role,
                content: m.content,
                timestamp: '',
              }),
            );
            setMessages(restored);
          }
          setIsStreaming(true);
          blocksRef.current = [];
          fullTextRef.current = '';
          toolCallsRef.current = [];
          connectToStream(s.id, 0);
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

  // Auto-scroll
  const scrollRafRef = useRef<number>(0);
  useEffect(() => {
    if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current);
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = 0;
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    });
  }, [messages, streamingBlocks]);

  // Send message
  const doSend = useCallback(async (text: string) => {
    if (!text.trim() && pendingImages.length === 0) return;
    if (isStreaming) return;
    if (hasProject && !projectKey) return;

    // Capture images before clearing state
    const imagesToSend = [...pendingImages];
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
    setInput('');
    setPendingImages([]);
    setIsStreaming(true);
    blocksRef.current = [];
    fullTextRef.current = '';
    toolCallsRef.current = [];
    lastEventIdxRef.current = -1;
    setStreamingBlocks([]);

    setErrorMsg(null);

    try {
      const res = await fetch('/api/agent-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: agent.id,
          message: text.trim(),
          sessionId: sessionId ?? undefined,
          projectKey: projectKey ?? undefined,
          images: imageAttachments.length > 0 ? imageAttachments : undefined,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${res.status}`);
      }

      const data = await res.json();

      // New session created — capture the sessionId
      if (!sessionId && data.sessionId) {
        setSessionId(data.sessionId);
        setSessionTitle(hasProject ? t('chat.newSession') : '新会话');
        onSessionChange?.();
      }

      connectToStream(data.sessionId, 0);
    } catch (err) {
      const msg = (err as Error).message || 'Unknown error';
      console.error('Agent chat send failed:', msg);
      setErrorMsg(msg);
      setIsStreaming(false);
    }
  }, [agent.id, sessionId, isStreaming, pendingImages, hasProject, projectKey, connectToStream, onSessionChange, t]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    Array.from(e.target.files ?? []).forEach(file => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const text = (ev.target?.result as string) ?? '';
        setPendingFiles(prev => [...prev, { name: file.name, content: text }]);
      };
      reader.readAsText(file);
    });
    e.target.value = '';
  };

  const handleSubmit = () => {
    const fileParts = pendingFiles.map(f => `📎 **${f.name}**\n\`\`\`\n${f.content}\n\`\`\``);
    const fullText = fileParts.length > 0
      ? (input.trim() ? `${input.trim()}\n\n---\n${fileParts.join('\n\n')}` : fileParts.join('\n\n'))
      : input;
    setPendingFiles([]);
    doSend(fullText);
  };

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
  const handleNewSession = () => {
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
  };

  // Switch to an existing session
  const handleSwitchSession = async (target: SessionListItem) => {
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
    setDropdownOpen(false);
    await loadSessionData(target.id);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleSaveAsKnowledge = (_messageId: string, content: string) => {
    setSaveForm({ label: '', description: '', format: 'text' });
    setSaveDialog({ open: true, content });
  };

  const handleSaveKnowledgeSubmit = async () => {
    if (!saveForm.label.trim() || !saveForm.description.trim()) return;
    setSavingKnowledge(true);
    try {
      const now = new Date().toISOString();
      const id = `ctx-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const extMap = { json: 'json', markdown: 'md', text: 'txt' };
      const fileName = `knowledge-${id}.${extMap[saveForm.format]}`;
      await fetch('/api/context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: saveForm.label.trim(),
          description: saveForm.description.trim(),
          fileName,
          format: saveForm.format,
          content: saveDialog.content,
          producedAt: now,
        }),
      });
      setSaveDialog({ open: false, content: '' });
    } catch { /* ignore */ }
    setSavingKnowledge(false);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  };

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData.items);
    const imageItems = items.filter(item => item.type.startsWith('image/'));
    if (imageItems.length === 0) return;
    e.preventDefault();
    for (const item of imageItems) {
      const file = item.getAsFile();
      if (!file) continue;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const dataUrl = ev.target?.result as string;
        setPendingImages(prev => prev.length >= 5 ? prev : [...prev, dataUrl]);
      };
      reader.readAsDataURL(file);
    }
  }, []);

  // ── Plain mode (agents page, no variant/projectKey) ──
  if (!hasProject) {
    return (
      <div className="relative flex h-full flex-col">
        {/* Messages */}
        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
          {messages.length === 0 && !isStreaming ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-zinc-400">
              <Bot className="h-10 w-10 stroke-1" />
              <p className="text-sm">向 {agent.name} 发送消息开始对话</p>
            </div>
          ) : (
            <>
              {messages.map((msg) => (
                <ChatBubble
                  key={msg.id}
                  message={msg}
                  showActions={!isStreaming}
                  onSaveAsKnowledge={handleSaveAsKnowledge}
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
                  思考中...
                </div>
              )}

              {errorMsg && !isStreaming && (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400">
                  {errorMsg}
                </div>
              )}
            </>
          )}
        </div>

        {/* Knowledge draft notification */}
        {knowledgeDrafts.length > 0 && !isStreaming && (
          <div className="mx-3 mb-2 flex items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs dark:border-amber-800/50 dark:bg-amber-900/15">
            <div className="flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
              <BookMarked className="h-3 w-3 shrink-0" />
              <span>Agent 已保存 {knowledgeDrafts.length} 条知识草稿，待确认</span>
            </div>
            <button
              onClick={() => setKnowledgeDrafts([])}
              className="shrink-0 text-amber-400 hover:text-amber-600 dark:text-amber-600 dark:hover:text-amber-400"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}

        {/* Input area */}
        <div className="border-t border-zinc-200 p-3 dark:border-zinc-800">
          <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileSelect} />
          {/* Toolbar: attach file + summon guest, one line */}
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1 rounded-full border border-zinc-200 px-2 py-0.5 text-xs text-zinc-400 hover:border-zinc-300 hover:text-zinc-600 transition-colors dark:border-zinc-700 dark:text-zinc-500 dark:hover:border-zinc-600 dark:hover:text-zinc-300"
            >
              <Paperclip className="h-2.5 w-2.5" />
              附加文件
            </button>
            {sessionId && !isStreaming && messages.length > 0 && guestAgents.length > 0 && (
              <>
                <button
                  onClick={() => setGuestPickerOpen(v => !v)}
                  className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs transition-colors ${
                    guestPickerOpen
                      ? 'border border-amber-300 bg-amber-100 text-amber-700 dark:border-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                      : 'border border-zinc-200 text-zinc-400 hover:border-amber-200 hover:text-amber-600 dark:border-zinc-700 dark:text-zinc-500 dark:hover:border-amber-800 dark:hover:text-amber-400'
                  }`}
                >
                  <UserPlus className="h-2.5 w-2.5" />
                  {t('chat.summonGuest')}
                </button>
                {guestPickerOpen && guestAgents.map(a => (
                  <button
                    key={a.id}
                    onClick={() => { setGuestAgent(a); setGuestPickerOpen(false); }}
                    className="flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50/50 px-2 py-0.5 text-xs text-amber-700 transition-colors hover:bg-amber-100 dark:border-amber-800/40 dark:bg-amber-950/20 dark:text-amber-300 dark:hover:bg-amber-900/30"
                  >
                    {a.name}
                  </button>
                ))}
              </>
            )}
            {pendingFiles.map((f, i) => (
              <span key={i} className="flex items-center gap-1 rounded-full bg-zinc-100 pl-2.5 pr-1.5 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                {f.name}
                <button onClick={() => setPendingFiles(prev => prev.filter((_, j) => j !== i))} className="ml-0.5 rounded-full p-0.5 hover:bg-zinc-200 dark:hover:bg-zinc-700">
                  <X className="h-2.5 w-2.5" />
                </button>
              </span>
            ))}
          </div>
          {pendingImages.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {pendingImages.map((img, i) => (
                <div key={i} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img} alt="" className="h-16 w-16 rounded object-cover border border-zinc-200 dark:border-zinc-700" />
                  <button
                    onClick={() => setPendingImages(prev => prev.filter((_, j) => j !== i))}
                    className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-zinc-800 text-white dark:bg-zinc-200 dark:text-zinc-900"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={`向 ${agent.name} 发送消息...`}
              rows={1}
              className="flex-1 resize-none rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm outline-none transition-colors focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-500"
              style={{ minHeight: '40px', maxHeight: '200px' }}
            />
            {isStreaming ? (
              <button
                onClick={handleAbort}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-red-500 text-white hover:bg-red-600 transition-colors"
                title="停止"
              >
                <Square className="h-4 w-4" />
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={!input.trim() && pendingImages.length === 0 && pendingFiles.length === 0}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-zinc-900 text-white hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                title="发送"
              >
                <Send className="h-4 w-4" />
              </button>
            )}
          </div>
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
        {saveDialog.open && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
            <div className="mx-4 w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-5 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <BookMarked className="h-4 w-4 text-zinc-500" />
                  <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">存为知识</span>
                </div>
                <button onClick={() => setSaveDialog({ open: false, content: '' })} className="text-zinc-400 hover:text-zinc-600">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs text-zinc-500">标题 *</label>
                  <input
                    type="text"
                    value={saveForm.label}
                    onChange={e => setSaveForm(f => ({ ...f, label: e.target.value }))}
                    placeholder="如：数据库表结构"
                    className="w-full rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 dark:focus:border-zinc-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-zinc-500">描述 * （帮助 AI 决定何时读取）</label>
                  <input
                    type="text"
                    value={saveForm.description}
                    onChange={e => setSaveForm(f => ({ ...f, description: e.target.value }))}
                    placeholder="如：包含所有表名、字段类型和关联关系"
                    className="w-full rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 dark:focus:border-zinc-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-zinc-500">格式</label>
                  <div className="flex gap-2">
                    {(['text', 'markdown', 'json'] as const).map(fmt => (
                      <button
                        key={fmt}
                        onClick={() => setSaveForm(f => ({ ...f, format: fmt }))}
                        className={`rounded px-3 py-1 text-xs transition-colors ${
                          saveForm.format === fmt
                            ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                            : 'border border-zinc-200 text-zinc-500 hover:border-zinc-300 dark:border-zinc-700 dark:hover:border-zinc-600'
                        }`}
                      >
                        {fmt}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  onClick={() => setSaveDialog({ open: false, content: '' })}
                  className="rounded-md px-3 py-1.5 text-sm text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  取消
                </button>
                <button
                  onClick={handleSaveKnowledgeSubmit}
                  disabled={!saveForm.label.trim() || !saveForm.description.trim() || savingKnowledge}
                  className="flex items-center gap-1.5 rounded-md bg-zinc-900 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                >
                  {savingKnowledge ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BookMarked className="h-3.5 w-3.5" />}
                  保存
                </button>
              </div>
            </div>
          </div>
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
        <div className="relative flex items-center gap-1.5 min-w-0 flex-1" ref={!isFull ? dropdownRef : undefined}>
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-blue-500" />
          {isFull ? (
            <span className="text-xs font-medium text-zinc-500 truncate">{sessionTitle}</span>
          ) : (
            <>
              <button
                onClick={() => setDropdownOpen(v => !v)}
                className="flex items-center gap-1 min-w-0 text-xs font-medium text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors"
              >
                <span className="truncate">{sessionTitle}</span>
                <ChevronDown className={`h-3 w-3 shrink-0 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
              </button>
              {dropdownOpen && (
                <div className="absolute left-0 top-full mt-1 z-50 w-64 rounded-md border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
                  <div className="flex items-center justify-between border-b border-zinc-100 px-2.5 py-1.5 dark:border-zinc-800">
                    <span className="text-xs font-medium text-zinc-400">{t('chat.conversations')}</span>
                    <button
                      onClick={() => { handleNewSession(); setDropdownOpen(false); }}
                      disabled={isStreaming}
                      className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-blue-600 hover:bg-zinc-100 dark:text-blue-400 dark:hover:bg-zinc-800"
                    >
                      <Plus className="h-3 w-3" />
                      {t('chat.newSession')}
                    </button>
                  </div>
                  <div className="max-h-64 overflow-y-auto py-1">
                    {sessionList.map(s => (
                      <button
                        key={s.id}
                        onClick={() => { handleSwitchSession(s); }}
                        className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-xs transition-colors ${
                          s.id === sessionId
                            ? 'bg-blue-50 font-medium text-zinc-900 dark:bg-blue-950/40 dark:text-zinc-100'
                            : 'text-zinc-600 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-800'
                        }`}
                      >
                        <MessageSquare className={`h-3 w-3 shrink-0 ${s.id === sessionId ? 'text-blue-500 dark:text-blue-400' : ''}`} />
                        <span className="truncate">{s.title}</span>
                      </button>
                    ))}
                    {sessionList.length === 0 && (
                      <div className="px-2.5 py-2 text-center text-xs text-zinc-400">
                        {t('chat.noConversations')}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
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
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-3">
        {messages.length === 0 && !isStreaming ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-zinc-400">
            <Sparkles className="h-8 w-8 stroke-1" />
            <p className="text-xs">{t('chat.plannerHint')}</p>
          </div>
        ) : (
          <>
            {messages.map((msg) => (
              <ChatBubble
                key={msg.id}
                message={msg}
                showActions={!isStreaming}
                onSaveAsKnowledge={handleSaveAsKnowledge}
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
                {t('chat.thinking')}
              </div>
            )}

            {errorMsg && !isStreaming && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400">
                {errorMsg}
              </div>
            )}
          </>
        )}
      </div>

      {/* Input area */}
      <div className="border-t border-zinc-100 p-2 dark:border-zinc-800">
        <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileSelect} />
        {/* Toolbar: attach file + summon guest, one line */}
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1 rounded-full border border-zinc-200 px-2 py-0.5 text-xs text-zinc-400 hover:border-zinc-300 hover:text-zinc-600 transition-colors dark:border-zinc-700 dark:text-zinc-500 dark:hover:border-zinc-600 dark:hover:text-zinc-300"
          >
            <Paperclip className="h-2.5 w-2.5" />
            附加文件
          </button>
          {sessionId && !isStreaming && messages.length > 0 && guestAgents.length > 0 && (
            <>
              <button
                onClick={() => setGuestPickerOpen(v => !v)}
                className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs transition-colors ${
                  guestPickerOpen
                    ? 'border border-amber-300 bg-amber-100 text-amber-700 dark:border-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                    : 'border border-zinc-200 text-zinc-400 hover:border-amber-200 hover:text-amber-600 dark:border-zinc-700 dark:text-zinc-500 dark:hover:border-amber-800 dark:hover:text-amber-400'
                }`}
              >
                <UserPlus className="h-2.5 w-2.5" />
                {t('chat.summonGuest')}
              </button>
              {guestPickerOpen && guestAgents.map(a => (
                <button
                  key={a.id}
                  onClick={() => { setGuestAgent(a); setGuestPickerOpen(false); }}
                  className="flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50/50 px-2 py-0.5 text-xs text-amber-700 transition-colors hover:bg-amber-100 dark:border-amber-800/40 dark:bg-amber-950/20 dark:text-amber-300 dark:hover:bg-amber-900/30"
                >
                  {a.name}
                </button>
              ))}
            </>
          )}
          {pendingFiles.map((f, i) => (
            <span key={i} className="flex items-center gap-1 rounded-full bg-zinc-100 pl-2.5 pr-1.5 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
              {f.name}
              <button onClick={() => setPendingFiles(prev => prev.filter((_, j) => j !== i))} className="ml-0.5 rounded-full p-0.5 hover:bg-zinc-200 dark:hover:bg-zinc-700">
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          ))}
        </div>
        {pendingImages.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {pendingImages.map((img, i) => (
              <div key={i} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img} alt="" className="h-16 w-16 rounded object-cover border border-zinc-200 dark:border-zinc-700" />
                <button
                  onClick={() => setPendingImages(prev => prev.filter((_, j) => j !== i))}
                  className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-zinc-800 text-white dark:bg-zinc-200 dark:text-zinc-900"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </div>
            ))}
          </div>
        )}
        <textarea
          ref={textareaRef}
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={t('chat.plannerPlaceholder')}
          style={{ minHeight: isFull ? '120px' : '200px' }}
          className="w-full resize-none rounded-md border border-zinc-200 bg-white px-2.5 py-2 text-sm outline-none transition-colors focus:border-zinc-400 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-500"
        />
      </div>

      {/* Knowledge draft notification */}
      {knowledgeDrafts.length > 0 && !isStreaming && (
        <div className="mx-2 mb-1 flex items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs dark:border-amber-800/50 dark:bg-amber-900/15">
          <div className="flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
            <BookMarked className="h-3 w-3 shrink-0" />
            <span>Agent 保存了 {knowledgeDrafts.length} 条知识草稿，前往上下文页面确认</span>
          </div>
          <button onClick={() => setKnowledgeDrafts([])} className="shrink-0 text-amber-400 hover:text-amber-600">
            <X className="h-3 w-3" />
          </button>
        </div>
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
      {saveDialog.open && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-5 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <BookMarked className="h-4 w-4 text-zinc-500" />
                <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">存为知识</span>
              </div>
              <button onClick={() => setSaveDialog({ open: false, content: '' })} className="text-zinc-400 hover:text-zinc-600">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs text-zinc-500">标题 *</label>
                <input
                  type="text"
                  value={saveForm.label}
                  onChange={e => setSaveForm(f => ({ ...f, label: e.target.value }))}
                  placeholder="如：数据库表结构"
                  className="w-full rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 dark:focus:border-zinc-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-zinc-500">描述 * （帮助 AI 决定何时读取）</label>
                <input
                  type="text"
                  value={saveForm.description}
                  onChange={e => setSaveForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="如：包含所有表名、字段类型和关联关系"
                  className="w-full rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 dark:focus:border-zinc-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-zinc-500">格式</label>
                <div className="flex gap-2">
                  {(['text', 'markdown', 'json'] as const).map(fmt => (
                    <button
                      key={fmt}
                      onClick={() => setSaveForm(f => ({ ...f, format: fmt }))}
                      className={`rounded px-3 py-1 text-xs transition-colors ${
                        saveForm.format === fmt
                          ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                          : 'border border-zinc-200 text-zinc-500 hover:border-zinc-300 dark:border-zinc-700 dark:hover:border-zinc-600'
                      }`}
                    >
                      {fmt}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setSaveDialog({ open: false, content: '' })}
                className="rounded-md px-3 py-1.5 text-sm text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                取消
              </button>
              <button
                onClick={handleSaveKnowledgeSubmit}
                disabled={!saveForm.label.trim() || !saveForm.description.trim() || savingKnowledge}
                className="flex items-center gap-1.5 rounded-md bg-zinc-900 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
              >
                {savingKnowledge ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BookMarked className="h-3.5 w-3.5" />}
                保存
              </button>
            </div>
          </div>
        </div>
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
                <span className="truncate">{s.title}</span>
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
