'use client';

import { useState, useEffect, useRef } from 'react';
import { Loader2, Terminal } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface LogViewerProps {
  planId: string | undefined;
  /** Whether the process is still running */
  active: boolean;
}

export function LogViewer({ planId, active }: LogViewerProps) {
  const [logs, setLogs] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [done, setDone] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!planId) return;

    // Reset state
    setLogs('');
    setDone(false);
    setStreaming(true);

    const es = new EventSource(`/api/ai-logs?planId=${planId}`);
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      try {
        const text = JSON.parse(event.data) as string;
        if (text) {
          setLogs((prev) => prev + text);
        }
      } catch { /* ignore parse errors */ }
    };

    es.addEventListener('done', () => {
      setStreaming(false);
      setDone(true);
      es.close();
    });

    es.onerror = () => {
      // EventSource will auto-reconnect on transient errors,
      // but if the stream was intentionally closed, stop.
      if (done) {
        es.close();
      }
    };

    return () => {
      es.close();
      eventSourceRef.current = null;
      setStreaming(false);
    };
  }, [planId]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  // Detect manual scroll to disable auto-scroll
  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 40;
    setAutoScroll(isAtBottom);
  };

  if (!planId) {
    return (
      <div className="flex flex-col items-center gap-2 p-8 text-center">
        <Terminal className="h-8 w-8 text-zinc-300 dark:text-zinc-600" />
        <p className="text-sm text-zinc-400">选择一个计划查看 AI 输出日志</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <Terminal className="h-3.5 w-3.5" />
          <span>AI 输出日志</span>
          {streaming && (
            <span className="flex items-center gap-1 text-blue-500">
              <Loader2 className="h-3 w-3 animate-spin" />
              实时更新中
            </span>
          )}
          {done && logs && (
            <span className="text-zinc-300 dark:text-zinc-600">已结束</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {!autoScroll && (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 text-xs px-2"
              onClick={() => {
                setAutoScroll(true);
                if (containerRef.current) {
                  containerRef.current.scrollTop = containerRef.current.scrollHeight;
                }
              }}
            >
              滚动到底部
            </Button>
          )}
        </div>
      </div>

      {/* Log content */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="h-[300px] overflow-y-auto rounded-md border border-zinc-200 bg-zinc-950 p-3 font-mono text-xs leading-5 text-zinc-200 dark:border-zinc-700"
      >
        {logs ? (
          <pre className="whitespace-pre-wrap break-words">{logs}</pre>
        ) : (
          <div className="flex h-full items-center justify-center text-zinc-500">
            {active || streaming ? (
              <span className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                等待 AI 输出...
              </span>
            ) : (
              '暂无日志'
            )}
          </div>
        )}
      </div>
    </div>
  );
}
