'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Send, Loader2, Square, ArrowLeft, UserPlus } from 'lucide-react';
import { useTranslations } from '@/client/i18n/use-translations';
import { ChatBubble } from '@/components/chat-bubble';
import type { Agent } from '@/types';
import type { ChatMessage, ChatToolCall, AgentEvent, ContentBlock } from '@/types';

type IndexedSSEEvent = AgentEvent & { _idx: number };

// 向后兼容：旧 AI 回复中可能仍含标签
function stripSessionTitleTag(text: string): string {
  return text.replace(/<session-title>[\s\S]*?<\/session-title>\s*/, '');
}

interface GuestAgentOverlayProps {
  /** The guest agent to chat with */
  agent: Agent;
  /** The host session ID to import turns from */
  parentSessionId: string;
  /** Close the overlay */
  onClose: () => void;
}

export function GuestAgentOverlay({
  agent,
  parentSessionId,
  onClose,
}: GuestAgentOverlayProps) {
  const t = useTranslations();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingBlocks, setStreamingBlocks] = useState<ContentBlock[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [guestSessionId, setGuestSessionId] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const streamAbortRef = useRef<AbortController | null>(null);
  const blocksRef = useRef<ContentBlock[]>([]);
  const fullTextRef = useRef('');
  const toolCallsRef = useRef<ChatToolCall[]>([]);
  const finalizingRef = useRef(false);
  const guestSessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    guestSessionIdRef.current = guestSessionId;
  }, [guestSessionId]);

  // Focus textarea on mount
  useEffect(() => {
    setTimeout(() => textareaRef.current?.focus(), 100);
  }, []);

  const streamingMessage = useMemo<ChatMessage>(() => ({
    id: 'guest-streaming',
    role: 'assistant',
    content: '',
    timestamp: '',
  }), []);

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

  // Finalize streaming
  const finalizeStream = useCallback(() => {
    if (finalizingRef.current) return;
    finalizingRef.current = true;

    const fullText = fullTextRef.current;
    const toolCalls = toolCallsRef.current;
    const blocks = blocksRef.current;

    if (fullText || toolCalls.length > 0) {
      const cleanedText = stripSessionTitleTag(fullText);
      const assistantMsg: ChatMessage = {
        id: `guest-msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        role: 'assistant',
        content: cleanedText,
        timestamp: new Date().toISOString(),
        toolCalls: toolCalls.length > 0 ? [...toolCalls] : undefined,
        contentBlocks: blocks.length > 0 ? [...blocks] : undefined,
      };
      setMessages(prev => [...prev, assistantMsg]);
    }

    setIsStreaming(false);
    setStreamingBlocks([]);
    blocksRef.current = [];
    fullTextRef.current = '';
    toolCallsRef.current = [];
    streamAbortRef.current = null;
    finalizingRef.current = false;
  }, []);

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

          const event = raw as unknown as AgentEvent;

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
            case 'thinking_delta': {
              const lastThink = blocks[blocks.length - 1];
              if (lastThink && lastThink.type === 'thinking') {
                lastThink.text += event.text;
              } else {
                blocks.push({ type: 'thinking', text: event.text });
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
              const tc = toolCallsRef.current.find((tc2) => tc2.id === event.id);
              if (tc) {
                tc.output = event.output;
                tc.status = event.status;
                chunkHasDisplayEvents = true;
              }
              break;
            }
            case 'error':
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

      await new Promise(r => setTimeout(r, 50));
      finalizeStream();
    }).catch((err) => {
      if ((err as Error).name === 'AbortError') return;
      setErrorMsg(`Stream connection failed: ${(err as Error).message}`);
      finalizeStream();
    });
  }, [finalizeStream]);

  // Send message to guest agent
  const doSend = useCallback(async (text: string) => {
    if (!text.trim() || isStreaming) return;

    const userMsg: ChatMessage = {
      id: `guest-msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      role: 'user',
      content: text.trim(),
      timestamp: new Date().toISOString(),
    };

    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setAutoScroll(true);
    setIsStreaming(true);
    blocksRef.current = [];
    fullTextRef.current = '';
    toolCallsRef.current = [];
    setStreamingBlocks([]);
    setErrorMsg(null);

    try {
      const res = await fetch('/api/agent-chat/guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: agent.id,
          message: text.trim(),
          parentSessionId,
          guestSessionId: guestSessionId ?? undefined,
          importedTurns: 'all',
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${res.status}`);
      }

      const data = await res.json();

      if (!guestSessionId && data.sessionId) {
        setGuestSessionId(data.sessionId);
      }

      connectToStream(data.sessionId, 0);
    } catch (err) {
      const msg = (err as Error).message || 'Unknown error';
      setErrorMsg(msg);
      setIsStreaming(false);
    }
  }, [agent.id, isStreaming, parentSessionId, guestSessionId, connectToStream]);

  const handleSubmit = () => doSend(input);

  const handleAbort = async () => {
    const sid = guestSessionIdRef.current;
    if (!sid) return;
    try {
      await fetch('/api/agent-chat/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: sid }),
      });
    } catch {
      // ignore
    }
    if (streamAbortRef.current) {
      streamAbortRef.current.abort();
      streamAbortRef.current = null;
    }
    finalizeStream();
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

  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-white dark:bg-zinc-900">
      {/* Header with amber accent */}
      <div className="flex items-center justify-between border-b border-amber-200 bg-amber-50/50 px-3 py-1.5 dark:border-amber-800/40 dark:bg-amber-950/20">
        <div className="flex items-center gap-1.5 min-w-0">
          <UserPlus className="h-3.5 w-3.5 shrink-0 text-amber-500" />
          <span className="text-xs font-medium text-amber-700 dark:text-amber-300 truncate">
            {t('chat.guestLabel')}: {agent.name}
          </span>
        </div>
        <button
          onClick={() => {
            if (streamAbortRef.current) {
              streamAbortRef.current.abort();
              streamAbortRef.current = null;
            }
            onClose();
          }}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-amber-600 hover:bg-amber-100 dark:text-amber-400 dark:hover:bg-amber-900/30 transition-colors"
          title={t('chat.backToHost')}
        >
          <ArrowLeft className="h-3 w-3" />
          {t('chat.backToHost')}
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} onScroll={handleChatScroll} className="flex-1 space-y-3 overflow-y-auto p-3">
        {messages.length === 0 && !isStreaming ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-zinc-400">
            <UserPlus className="h-8 w-8 stroke-1 text-amber-400" />
            <p className="text-xs">
              向 {agent.name} 提问，它已获得主会话的对话记录作为参考
            </p>
          </div>
        ) : (
          <>
            {messages.map(msg => (
              <ChatBubble key={msg.id} message={msg} />
            ))}

            {isStreaming && streamingBlocks.length > 0 && (
              <ChatBubble
                message={streamingMessage}
                streamingBlocks={streamingBlocks}
                isStreaming
              />
            )}

            {isStreaming && streamingBlocks.length === 0 && (
              <div className="flex items-center gap-2 text-xs text-amber-500">
                <Loader2 className="h-3 w-3 animate-spin" />
                {t('chat.guestThinking')}
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
      <div className="border-t border-amber-200/50 p-2 dark:border-amber-800/30">
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={`向 ${agent.name} 提问...`}
            rows={1}
            className="flex-1 resize-none rounded-md border border-amber-200 bg-white px-2.5 py-2 text-sm outline-none transition-colors focus:border-amber-400 dark:border-amber-800/40 dark:bg-zinc-900 dark:focus:border-amber-500"
            style={{ minHeight: '40px', maxHeight: '200px' }}
          />
          {isStreaming ? (
            <button
              onClick={handleAbort}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-red-500 text-white hover:bg-red-600 transition-colors"
              title={t('actions.stopGenerating')}
            >
              <Square className="h-4 w-4" />
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={!input.trim()}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              title={t('actions.submit')}
            >
              <Send className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
