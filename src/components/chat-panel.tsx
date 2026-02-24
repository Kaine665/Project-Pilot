'use client';

import { useState, useEffect, useRef, useCallback, useImperativeHandle, forwardRef } from 'react';
import { Send, Loader2, Trash2, Square } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { ChatBubble } from '@/components/chat-bubble';
import { DangerWarning } from '@/components/danger-warning';
import type { ChatMessage, ChatToolCall, ChatSSEEvent, ContentBlock, TaskUnderstanding, TaskResult, SessionPhase, DangerLevel } from '@/types';

export interface ChatPanelHandle {
  sendMessage: (text: string) => void;
}

interface ChatPanelProps {
  taskId: string;
  taskTitle?: string;
  conversationId?: string;
  isFirstConversation?: boolean;
  phase?: SessionPhase;
  onPlanExtracted?: (planId: string) => void;
  onUnderstandingExtracted?: (understanding: TaskUnderstanding) => void;
  onResultExtracted?: (result: TaskResult) => void;
  onPhaseChanged?: (phase: SessionPhase) => void;
  onBranchCreated?: (branch: string) => void;
  onBranchMerged?: (branch: string, targetBranch: string) => void;
  onClearAll?: () => void;
  onStreamDone?: () => void;
  onBranch?: (messageId: string) => void;
}

const getPhaseLabel = (phase: SessionPhase, t: (key: string) => string): { text: string; color: string } => {
  const labels = {
    branching: { text: t('chat.createBranch'), color: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400' },
    understanding: { text: t('chat.phases.understanding'), color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
    planning: { text: t('chat.phases.planning'), color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
    executing: { text: t('chat.phases.executing'), color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
    summarizing: { text: t('chat.phases.summarizing'), color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' },
  };
  return labels[phase];
};

// Module-level draft storage: survives component unmount/remount across task switches
const draftMap = new Map<string, string>();

// Stable message object for streaming bubble (module-level: no props/state dependency)
const STREAMING_MESSAGE: ChatMessage = {
  id: 'streaming',
  role: 'assistant',
  content: '',
  timestamp: '',
};

// ── SSE event with index sideband ──
type IndexedSSEEvent = ChatSSEEvent & { _idx: number };

export const ChatPanel = forwardRef<ChatPanelHandle, ChatPanelProps>(
  function ChatPanel({ taskId, taskTitle, conversationId, isFirstConversation, phase, onPlanExtracted, onUnderstandingExtracted, onResultExtracted, onPhaseChanged, onBranchCreated, onBranchMerged, onClearAll, onStreamDone, onBranch }, ref) {
    const t = useTranslations();
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const draftKey = conversationId ? `${taskId}:${conversationId}` : taskId;
    const [input, setInput] = useState(() => draftMap.get(draftKey) ?? '');
    const [isStreaming, setIsStreaming] = useState(false);
    const [streamingBlocks, setStreamingBlocks] = useState<ContentBlock[]>([]);
    const [loadingHistory, setLoadingHistory] = useState(true);
    const [isInterrupted, setIsInterrupted] = useState(false);
    const [isRecovering, setIsRecovering] = useState(false);
    const [dangerWarnings, setDangerWarnings] = useState<Array<{
      id: string; command: string; reason: string; level: DangerLevel;
    }>>([]);
    const scrollRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // Stream connection abort (only disconnects the SSE reader, does NOT kill the backend process)
    const streamAbortRef = useRef<AbortController | null>(null);

    // POST request abort — cancelled on taskId change to prevent stale doSend from continuing
    const sendAbortRef = useRef<AbortController | null>(null);

    // Streaming accumulation refs
    const blocksRef = useRef<ContentBlock[]>([]);
    const rafIdRef = useRef<number>(0);
    const fullTextRef = useRef('');
    const toolCallsRef = useRef<ChatToolCall[]>([]);
    const extractedPlanIdRef = useRef<string | undefined>(undefined);

    // Auto-retry: store pending retry message from backend
    const pendingRetryRef = useRef<string | null>(null);
    // User interrupt: store message to send after current stream finalizes
    const pendingUserMsgRef = useRef<string | null>(null);
    const doSendRef = useRef<(text: string) => void>(() => {});

    // Guard against double finalization
    const finalizingRef = useRef(false);
    // Phase 0 → understanding transition flag
    const branchingJustCompletedRef = useRef(false);
    // Auto-start guard (moved up so finalizeStream can access it)
    const autoStartedRef = useRef<string | null>(null);

    // ── Shared reset for streaming refs (used by finalizeStream, doSend, taskId change) ──
    const resetStreamingRefs = useCallback(() => {
      blocksRef.current = [];
      fullTextRef.current = '';
      toolCallsRef.current = [];
      extractedPlanIdRef.current = undefined;
      setStreamingBlocks([]);
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = 0;
      }
    }, []);

    // ── Finalize streaming → commit assistant message to messages state ──
    // Defined BEFORE connectToStream so it can be a proper dependency.
    const finalizeStream = useCallback(() => {
      if (finalizingRef.current) return;
      finalizingRef.current = true;

      // Phase 0 just completed → discard transient messages, reset auto-start
      if (branchingJustCompletedRef.current) {
        branchingJustCompletedRef.current = false;
        autoStartedRef.current = null;
        setMessages([]);
        setIsStreaming(false);
        resetStreamingRefs();
        streamAbortRef.current = null;
        finalizingRef.current = false;
        return;
      }

      const fullText = fullTextRef.current;
      const toolCalls = toolCallsRef.current;
      const blocks = blocksRef.current;
      const extractedPlanId = extractedPlanIdRef.current;

      if (fullText || toolCalls.length > 0) {
        const assistantMsg: ChatMessage = {
          id: `msg-${Date.now()}`,
          role: 'assistant',
          content: fullText,
          timestamp: new Date().toISOString(),
          toolCalls: toolCalls.length > 0 ? [...toolCalls] : undefined,
          contentBlocks: blocks.length > 0 ? [...blocks] : undefined,
          extractedPlanId,
        };
        setMessages((prev) => [...prev, assistantMsg]);
      }

      setIsStreaming(false);
      resetStreamingRefs();
      streamAbortRef.current = null;
      finalizingRef.current = false;
      onStreamDone?.();

      // User's pending message takes priority over auto-retry
      const pendingMsg = pendingUserMsgRef.current;
      pendingUserMsgRef.current = null;
      if (pendingMsg) {
        pendingRetryRef.current = null;
        setTimeout(() => doSendRef.current(pendingMsg), 300);
        return;
      }

      // Auto-retry: if backend requested a retry, send the retry message
      const retryMsg = pendingRetryRef.current;
      pendingRetryRef.current = null;
      if (retryMsg) {
        setTimeout(() => doSendRef.current(retryMsg), 500);
      }
    }, [resetStreamingRefs, onStreamDone]);

    // ── Connect to SSE stream ──
    // Reusable: called from doSend (fresh start) and from useEffect (reconnect)
    const connectToStream = useCallback((targetTaskId: string) => {
      // Abort any existing connection first to prevent duplicate streams
      if (streamAbortRef.current) {
        streamAbortRef.current.abort();
      }

      const abort = new AbortController();
      streamAbortRef.current = abort;

      fetch(`/api/ai-chat/stream?taskId=${targetTaskId}&since=0`, {
        signal: abort.signal,
        cache: 'no-store',
      }).then(async (res) => {
        if (!res.ok || !res.body) {
          throw new Error(`HTTP ${res.status}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        const blocks = blocksRef.current;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // Parse SSE lines
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

            // Strip sideband field to get clean ChatSSEEvent
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

              case 'plan_extracted':
                extractedPlanIdRef.current = event.planId;
                onPlanExtracted?.(event.planId);
                break;

              case 'understanding_extracted':
                onUnderstandingExtracted?.(event.understanding);
                break;

              case 'result_extracted':
                onResultExtracted?.(event.result);
                break;

              case 'phase_changed':
                // Phase 0 → understanding: reset auto-start so understanding kicks off
                if (phase === 'branching' && event.phase === 'understanding') {
                  branchingJustCompletedRef.current = true;
                }
                onPhaseChanged?.(event.phase);
                break;

              case 'branch_created':
                onBranchCreated?.(event.branch);
                break;

              case 'branch_merged':
                onBranchMerged?.(event.branch, event.targetBranch);
                break;

              case 'dangerous_tool_warning':
                setDangerWarnings(prev => [...prev, {
                  id: event.toolCallId,
                  command: event.command,
                  reason: event.reason,
                  level: event.level,
                }]);
                break;

              case 'retry_needed':
                pendingRetryRef.current = event.retryMessage;
                break;

              case 'error':
                console.error('Chat stream error:', event.message);
                break;

              case 'done':
                break;
            }
          }

          // Flush blocks after each reader chunk (direct state update).
          if (chunkHasDisplayEvents) {
            setStreamingBlocks([...blocksRef.current]);
          }
        }

        // Stream ended → cancel any pending rAF, then delay finalizeStream
        // so React has a chance to render the last streaming blocks.
        if (rafIdRef.current) {
          cancelAnimationFrame(rafIdRef.current);
          rafIdRef.current = 0;
        }
        await new Promise(r => setTimeout(r, 50));
        finalizeStream();

      }).catch((err) => {
        if ((err as Error).name === 'AbortError') {
          // Frontend-initiated disconnect (page switch, unmount)
          // Process still runs in backend. Don't finalize — we'll reconnect.
          return;
        }
        console.error('Stream connection failed:', err);
        finalizeStream();
      });
    }, [onPlanExtracted, onUnderstandingExtracted, onResultExtracted, onPhaseChanged, onBranchCreated, onBranchMerged, finalizeStream]);

    // ── Reset & load history + check for running process on taskId/conversationId change ──
    useEffect(() => {
      // Reset streaming state from the previous task/conversation
      setIsStreaming(false);
      resetStreamingRefs();
      pendingRetryRef.current = null;
      pendingUserMsgRef.current = null;
      finalizingRef.current = false;

      setLoadingHistory(true);
      setMessages([]);
      setIsInterrupted(false);
      setDangerWarnings([]);
      setIsRecovering(false);

      const historyAbort = new AbortController();
      let cancelled = false;

      (async () => {
        try {
          // Step 1: Load conversation history
          const convParam = conversationId ? `&conversationId=${conversationId}` : '';
          const historyRes = await fetch(`/api/ai-chat?taskId=${taskId}${convParam}`, {
            signal: historyAbort.signal,
            cache: 'no-store',
          });
          if (historyRes.ok) {
            const historyData = await historyRes.json();
            if (!cancelled) {
              setMessages(historyData.messages ?? []);
              setLoadingHistory(false);
            }
          } else if (!cancelled) {
            setLoadingHistory(false);
          }

          // Step 2: Check if a process is running for this task
          const statusRes = await fetch(`/api/ai-chat/status?taskId=${taskId}`, {
            signal: historyAbort.signal,
            cache: 'no-store',
          });
          if (!statusRes.ok) return;
          const statusData = await statusRes.json();

          if (!cancelled && statusData.status === 'running' && !streamAbortRef.current) {
            // Only reconnect if the running process belongs to THIS conversation
            const runConvId = statusData.conversationId;
            if (!conversationId || runConvId === conversationId) {
              setIsStreaming(true);
              resetStreamingRefs();
              connectToStream(taskId);
            }
          } else if (!cancelled && statusData.status === 'none') {
            // No active process — check if this session was interrupted
            try {
              const recoveryRes = await fetch('/api/recovery', {
                signal: historyAbort.signal,
                cache: 'no-store',
              });
              if (recoveryRes.ok) {
                const { interrupted } = await recoveryRes.json();
                const match = interrupted?.find((i: { taskId: string }) => i.taskId === taskId);
                if (!cancelled) setIsInterrupted(!!match);
              }
            } catch {
              // Ignore recovery check errors
            }
          }
        } catch (err) {
          if ((err as Error).name !== 'AbortError') console.error(err);
          if (!cancelled) setLoadingHistory(false);
        }
      })();

      return () => {
        cancelled = true;
        historyAbort.abort();
        // Abort in-flight POST from doSend so stale calls don't connect to the wrong task
        if (sendAbortRef.current) {
          sendAbortRef.current.abort();
          sendAbortRef.current = null;
        }
        // Disconnect stream reader on unmount/taskId change — but do NOT stop the backend process
        if (streamAbortRef.current) {
          streamAbortRef.current.abort();
          streamAbortRef.current = null;
        }
      };
    }, [taskId, conversationId, connectToStream, resetStreamingRefs]);

    // Auto-scroll to bottom (rAF-throttled)
    const scrollRafRef = useRef<number>(0);
    useEffect(() => {
      if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current);
      scrollRafRef.current = requestAnimationFrame(() => {
        scrollRafRef.current = 0;
        if (scrollRef.current) {
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
      });
      return () => {
        if (scrollRafRef.current) {
          cancelAnimationFrame(scrollRafRef.current);
          scrollRafRef.current = 0;
        }
      };
    }, [messages, streamingBlocks]);

    // ── Send a message ──
    const doSend = useCallback(async (text: string) => {
      if (!text?.trim()) return;

      // If currently streaming, interrupt and queue the message
      if (isStreaming) {
        pendingUserMsgRef.current = text.trim();
        pendingRetryRef.current = null;
        setInput('');
        draftMap.delete(draftKey);
        try {
          await fetch('/api/ai-chat/stop', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ taskId }),
          });
        } catch (err) {
          console.error('Failed to stop:', err);
        }
        if (streamAbortRef.current) {
          streamAbortRef.current.abort();
          streamAbortRef.current = null;
        }
        finalizeStream();
        return;
      }

      // Cancel any in-flight POST from a previous doSend (e.g. rapid task switch)
      if (sendAbortRef.current) {
        sendAbortRef.current.abort();
      }
      const sendAbort = new AbortController();
      sendAbortRef.current = sendAbort;

      const userMsg: ChatMessage = {
        id: `msg-${Date.now()}`,
        role: 'user',
        content: text.trim(),
        timestamp: new Date().toISOString(),
      };

      // Optimistically add user message
      setMessages((prev) => [...prev, userMsg]);
      setInput('');
      draftMap.delete(draftKey);
      setIsStreaming(true);
      resetStreamingRefs();

      try {
        // Step 1: Start the Claude process (returns immediately)
        const res = await fetch('/api/ai-chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskId, message: text.trim(), conversationId }),
          signal: sendAbort.signal,
        });

        // Guard: if aborted while awaiting (taskId changed), abandon silently
        if (sendAbort.signal.aborted) {
          setIsStreaming(false);
          return;
        }

        if (!res.ok) {
          let errMsg = `HTTP ${res.status}`;
          try {
            const errData = await res.json();
            if (errData?.error) errMsg = errData.error;
          } catch { /* response body not JSON */ }
          throw new Error(errMsg);
        }

        // Step 2: Connect to the SSE stream
        connectToStream(taskId);

        // Notify task list to refresh (backend may have changed status to 'doing')
        window.dispatchEvent(new CustomEvent('task-updated'));

      } catch (err) {
        // Stale request aborted by taskId change — silently abandon
        if ((err as Error).name === 'AbortError') {
          setIsStreaming(false);
          return;
        }
        console.error('Chat send failed:', err);
        setIsStreaming(false);
      }
    }, [taskId, conversationId, draftKey, isStreaming, connectToStream, resetStreamingRefs, finalizeStream]);

    // Keep doSendRef in sync (used by finalizeStream's auto-retry without stale closure)
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

    // Auto-start: when history finishes loading with 0 messages, send task title
    // Only auto-start for the very first conversation of a task
    useEffect(() => {
      if (loadingHistory || isStreaming) return;
      if (messages.length > 0) return;
      if (!taskTitle) return;
      if (!isFirstConversation) return;
      if (autoStartedRef.current === taskId) return;
      autoStartedRef.current = taskId;
      doSend(taskTitle);
    }, [loadingHistory, messages.length, taskId, taskTitle, isStreaming, isFirstConversation, doSend]);

    // Expose sendMessage to parent via ref
    useImperativeHandle(ref, () => ({
      sendMessage: (text: string) => doSend(text),
    }), [doSend]);

    const handleSubmit = () => {
      doSend(input);
    };

    // ── Explicit stop (sends POST /api/ai-chat/stop) ──
    const handleAbort = async () => {
      // Cancel any pending auto-retry and queued user message
      pendingRetryRef.current = null;
      pendingUserMsgRef.current = null;
      try {
        await fetch('/api/ai-chat/stop', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskId }),
        });
      } catch (err) {
        console.error('Failed to stop:', err);
      }
      // Disconnect reader then finalize
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

    const handleClear = async () => {
      if (isStreaming) return;
      try {
        // Clear conversation
        const convParam = conversationId ? `&conversationId=${conversationId}` : '';
        await fetch(`/api/ai-chat?taskId=${taskId}${convParam}`, { method: 'DELETE' });
        setMessages([]);
        // Clear all artifacts (understanding, plan, result)
        onClearAll?.();
      } catch (err) {
        console.error('Failed to clear conversation:', err);
      }
    };

    // Auto-resize textarea
    const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const val = e.target.value;
      setInput(val);
      draftMap.set(draftKey, val);
      const el = e.target;
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 120) + 'px';
    };

    return (
      <div className="flex h-full flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-100 px-3 py-1.5 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-400">{t('chat.title')}</span>
            {phase && (
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${getPhaseLabel(phase, t).color}`}>
                {getPhaseLabel(phase, t).text}
              </span>
            )}
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-1.5 text-xs text-zinc-400 hover:text-red-500"
            onClick={handleClear}
            disabled={isStreaming || messages.length === 0}
            title={t('chat.clearConversation')}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>

        {/* Recovery banner */}
        {isInterrupted && !isStreaming && (
          <div className="mx-3 mt-2 flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-950/30">
            <p className="flex-1 text-sm text-amber-800 dark:text-amber-200">
              {t('chat.sessionInterrupted')}
            </p>
            <button
              onClick={async () => {
                setIsRecovering(true);
                try {
                  const res = await fetch('/api/recovery', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ taskId }),
                  });
                  if (res.ok) {
                    setIsInterrupted(false);
                    setIsStreaming(true);
                    resetStreamingRefs();
                    connectToStream(taskId);
                  }
                } catch {
                  // ignore
                } finally {
                  setIsRecovering(false);
                }
              }}
              disabled={isRecovering}
              className="shrink-0 rounded-md bg-amber-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-600 disabled:opacity-50 transition-colors"
            >
              {isRecovering ? t('chat.recovering') : t('chat.continueSession')}
            </button>
          </div>
        )}

        {/* Danger warnings */}
        {dangerWarnings.map(w => (
          <DangerWarning
            key={w.id}
            command={w.command}
            reason={w.reason}
            level={w.level}
            onDismiss={() => setDangerWarnings(prev => prev.filter(x => x.id !== w.id))}
          />
        ))}

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-3">
          {loadingHistory ? (
            <div className="flex h-full items-center justify-center text-sm text-zinc-400">
              {t('tasks.loading')}
            </div>
          ) : messages.length === 0 && !isStreaming ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-zinc-400">
              <p className="text-sm">{t('chat.startChatting')}</p>
              <p className="text-xs">{t('chat.inputHint')}</p>
            </div>
          ) : (
            <>
              {messages.map((msg) => (
                <ChatBubble key={msg.id} message={msg} onBranch={onBranch} showActions={!isStreaming} />
              ))}

              {/* Streaming assistant message */}
              {isStreaming && streamingBlocks.length > 0 && (
                <ChatBubble
                  message={STREAMING_MESSAGE}
                  streamingBlocks={streamingBlocks}
                  isStreaming
                />
              )}

              {/* Waiting indicator */}
              {isStreaming && streamingBlocks.length === 0 && (
                <div className="flex items-center gap-2 text-xs text-zinc-400">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {t('chat.waiting')}
                </div>
              )}
            </>
          )}
        </div>

        {/* Input area */}
        <div className="border-t border-zinc-100 p-3 dark:border-zinc-800">
          <div className="flex items-end gap-2">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder={t('chat.placeholder')}
              rows={1}
              className="flex-1 resize-none rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm outline-none transition-colors focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-500"
            />
            {isStreaming && (
              <Button
                size="sm"
                variant="destructive"
                onClick={handleAbort}
                className="h-9 px-3"
                title={t('actions.stopGenerating')}
              >
                <Square className="h-3 w-3 fill-current" />
              </Button>
            )}
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={!input.trim()}
              className="h-9 px-3"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    );
  },
);
