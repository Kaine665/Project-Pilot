'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Send, Loader2, Trash2, Square, Sparkles, ChevronDown, Plus, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ChatBubble } from '@/components/chat-bubble';
import { SuggestionCard } from '@/components/suggestion-card';
import type { ChatMessage, ChatToolCall, ChatSSEEvent, ContentBlock } from '@/types';
import type { PlannerSuggestion } from '@/types/planner';

interface PlannerChatPanelProps {
  projectKey: string | null;
}

type IndexedSSEEvent = ChatSSEEvent & { _idx: number };

// Strip <session-title> tags from display text
function stripSessionTitleTag(text: string): string {
  return text.replace(/<session-title>[\s\S]*?<\/session-title>\s*/, '');
}

// Extract json:flow-suggestion blocks from text
function extractSuggestions(text: string): PlannerSuggestion[] | null {
  const match = text.match(/```json:flow-suggestion\s*\n([\s\S]*?)```/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1].trim());
    const suggestions = parsed.suggestions;
    if (!Array.isArray(suggestions)) return null;
    return suggestions.map((s: Record<string, unknown>, i: number) => ({
      ...s,
      id: `sug-${Date.now()}-${i}`,
      applied: false,
    })) as PlannerSuggestion[];
  } catch {
    return null;
  }
}

// Message type extended with suggestions
interface PlannerMessage extends ChatMessage {
  suggestions?: PlannerSuggestion[];
}

// Session list item (no messages)
interface SessionListItem {
  id: string;
  title: string;
  updatedAt: string;
}

export function PlannerChatPanel({ projectKey }: PlannerChatPanelProps) {
  const [messages, setMessages] = useState<PlannerMessage[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingBlocks, setStreamingBlocks] = useState<ContentBlock[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Session management
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionList, setSessionList] = useState<SessionListItem[]>([]);
  const [sessionTitle, setSessionTitle] = useState('新会话');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

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

  // Fetch session list for project
  const fetchSessionList = useCallback(async (pk: string) => {
    try {
      const res = await fetch(`/api/planner/sessions?projectKey=${pk}`, { cache: 'no-store' });
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
      const res = await fetch(`/api/planner/sessions/${sid}`, { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      const restored: PlannerMessage[] = (data.messages ?? []).map(
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

  // Reset when projectKey changes — load session list and auto-select latest
  useEffect(() => {
    setMessages([]);
    setIsStreaming(false);
    setStreamingBlocks([]);
    setSessionId(null);
    setSessionTitle('新会话');
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

    if (!projectKey) return;
    let cancelled = false;

    (async () => {
      const sessions: SessionListItem[] = await fetchSessionList(projectKey);
      if (cancelled) return;

      if (sessions.length > 0) {
        const latest = sessions[0]; // sorted by updatedAt desc
        setSessionId(latest.id);
        setSessionTitle(latest.title);
        await loadSessionData(latest.id);
      }

      // Also check if a run is still live in memory for any session
      // (e.g. streaming was happening when user navigated away)
      if (sessions.length > 0) {
        for (const s of sessions) {
          const statusRes = await fetch(`/api/planner/status?sessionId=${s.id}`, { cache: 'no-store' });
          const statusData = await statusRes.json();
          if (!cancelled && statusData.status === 'running') {
            // Switch to the running session
            setSessionId(s.id);
            setSessionTitle(s.title);
            // Restore in-memory messages if available
            if (Array.isArray(statusData.messages) && statusData.messages.length > 0) {
              const restored: PlannerMessage[] = statusData.messages.map(
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
      }
    })();

    return () => {
      cancelled = true;
      if (streamAbortRef.current) {
        streamAbortRef.current.abort();
        streamAbortRef.current = null;
      }
    };
  }, [projectKey]);

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
      const suggestions = extractSuggestions(cleanedText);
      const assistantMsg: PlannerMessage = {
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content: cleanedText,
        timestamp: new Date().toISOString(),
        toolCalls: toolCalls.length > 0 ? [...toolCalls] : undefined,
        contentBlocks: blocks.length > 0 ? [...blocks] : undefined,
        suggestions: suggestions ?? undefined,
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
    if (projectKey) {
      fetchSessionList(projectKey).then((sessions: SessionListItem[]) => {
        const current = sessions.find((s: SessionListItem) => s.id === sessionIdRef.current);
        if (current) {
          setSessionTitle(current.title);
        }
      });
    }
  }, [projectKey, fetchSessionList]);

  // Connect to SSE stream
  const connectToStream = useCallback((targetSessionId: string, since: number) => {
    if (streamAbortRef.current) {
      streamAbortRef.current.abort();
    }

    const abort = new AbortController();
    streamAbortRef.current = abort;

    fetch(`/api/planner/stream?sessionId=${targetSessionId}&since=${since}`, {
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

            case 'error':
              console.error('Planner stream error:', event.message);
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
      console.error('Planner stream connection failed:', err);
      finalizeStream();
    });
  }, [finalizeStream]);

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
    if (!text.trim() || isStreaming || !projectKey) return;

    const userMsg: PlannerMessage = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: text.trim(),
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsStreaming(true);
    blocksRef.current = [];
    fullTextRef.current = '';
    toolCallsRef.current = [];
    lastEventIdxRef.current = -1;
    setStreamingBlocks([]);

    try {
      const res = await fetch('/api/planner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectKey,
          message: text.trim(),
          sessionId: sessionId ?? undefined,
        }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || `HTTP ${res.status}`);
      }

      const data = await res.json();

      // New session created — capture the sessionId
      if (!sessionId && data.sessionId) {
        setSessionId(data.sessionId);
        setSessionTitle('新会话');
      }

      connectToStream(data.sessionId, 0);
    } catch (err) {
      console.error('Planner send failed:', err);
      setIsStreaming(false);
    }
  }, [projectKey, sessionId, isStreaming, connectToStream]);

  const handleSubmit = () => doSend(input);

  const handleAbort = async () => {
    if (!sessionId) return;
    try {
      await fetch('/api/planner/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
    } catch (err) {
      console.error('Failed to stop planner:', err);
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
      await fetch(`/api/planner/sessions?sessionId=${sessionId}`, { method: 'DELETE' });
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
    setSessionTitle('新会话');
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

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  };

  const handleSuggestionApplied = (suggestionId: string) => {
    setMessages(prev => prev.map(msg => {
      if (!msg.suggestions) return msg;
      return {
        ...msg,
        suggestions: msg.suggestions.map(s =>
          s.id === suggestionId ? { ...s, applied: true } : s
        ),
      };
    }));
  };

  if (!projectKey) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-center">
        <p className="text-xs text-zinc-400">先选择一个项目</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header — session switcher */}
      <div className="flex items-center justify-between border-b border-zinc-100 px-3 py-1.5 dark:border-zinc-800">
        <div ref={dropdownRef} className="relative flex items-center gap-1.5 min-w-0 flex-1">
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-blue-500" />
          <button
            onClick={() => setDropdownOpen(v => !v)}
            className="flex items-center gap-1 text-xs font-medium text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 min-w-0 transition-colors"
          >
            <span className="truncate max-w-[180px]">{sessionTitle}</span>
            <ChevronDown className={`h-3 w-3 shrink-0 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
          </button>

          {dropdownOpen && (
            <div className="absolute left-0 top-full z-50 mt-1 w-64 rounded-md border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
              {/* New session */}
              <button
                onClick={() => { handleNewSession(); setDropdownOpen(false); }}
                className="flex w-full items-center gap-2 px-3 py-2 text-xs text-blue-600 hover:bg-zinc-50 dark:text-blue-400 dark:hover:bg-zinc-800"
              >
                <Plus className="h-3 w-3" />
                新建会话
              </button>
              {sessionList.length > 0 && (
                <>
                  <div className="border-t border-zinc-100 dark:border-zinc-800" />
                  <div className="max-h-[200px] overflow-y-auto">
                    {sessionList.map(s => (
                      <button
                        key={s.id}
                        onClick={() => handleSwitchSession(s)}
                        className={`flex w-full items-center gap-2 px-3 py-2 text-xs transition-colors ${
                          s.id === sessionId
                            ? 'bg-zinc-100 font-medium text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
                            : 'text-zinc-600 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-800'
                        }`}
                      >
                        <MessageSquare className="h-3 w-3 shrink-0" />
                        <span className="truncate">{s.title}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-1.5 text-xs text-zinc-400 hover:text-red-500"
          onClick={handleDelete}
          disabled={isStreaming || (!sessionId && messages.length === 0)}
          title="删除会话"
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-3">
        {messages.length === 0 && !isStreaming ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-zinc-400">
            <Sparkles className="h-8 w-8 stroke-1" />
            <p className="text-xs">描述你想做什么，AI 帮你规划任务结构</p>
          </div>
        ) : (
          <>
            {messages.map((msg) => (
              <div key={msg.id}>
                <ChatBubble message={msg} />
                {/* Render suggestions inline after the message */}
                {msg.suggestions && msg.suggestions.length > 0 && (
                  <div className="ml-8 mt-1 space-y-1.5">
                    {msg.suggestions.map((sug) => (
                      <SuggestionCard
                        key={sug.id}
                        suggestion={sug}
                        projectKey={projectKey}
                        onApplied={handleSuggestionApplied}
                      />
                    ))}
                  </div>
                )}
              </div>
            ))}

            {/* Streaming message */}
            {isStreaming && streamingBlocks.length > 0 && (
              <ChatBubble
                message={streamingMessage}
                streamingBlocks={streamingBlocks}
                isStreaming
              />
            )}

            {/* Waiting indicator */}
            {isStreaming && streamingBlocks.length === 0 && (
              <div className="flex items-center gap-2 text-xs text-zinc-400">
                <Loader2 className="h-3 w-3 animate-spin" />
                思考中...
              </div>
            )}
          </>
        )}
      </div>

      {/* Input area */}
      <div className="border-t border-zinc-100 p-2 dark:border-zinc-800">
        <div className="flex items-end gap-1.5">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="描述你想做什么..."
            rows={1}
            className="flex-1 resize-none rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-xs outline-none transition-colors focus:border-zinc-400 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-500"
          />
          {isStreaming ? (
            <Button
              size="sm"
              variant="destructive"
              onClick={handleAbort}
              className="h-7 px-2"
              title="停止"
            >
              <Square className="h-3 w-3 fill-current" />
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={!input.trim()}
              className="h-7 px-2"
            >
              <Send className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
