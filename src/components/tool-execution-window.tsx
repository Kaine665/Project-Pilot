'use client';

import { memo, useRef, useEffect } from 'react';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';
import type { ChatToolCall } from '@/types';
import { getToolIcon, getToolOneLiner, getToolGroupTitle } from '@/lib/tool-utils';

interface ToolExecutionWindowProps {
  /** 一组连续的重复性工具调用 */
  toolCalls: ChatToolCall[];
}

/**
 * 固定 200px 内嵌面板，将连续的重复性工具调用分组展示
 * 每个工具调用显示为一行摘要，新操作自动滚到底部
 */
export const ToolExecutionWindow = memo(function ToolExecutionWindow({
  toolCalls,
}: ToolExecutionWindowProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // 新工具加入时自动滚到底部
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [toolCalls.length]);

  if (toolCalls.length === 0) return null;

  const title = getToolGroupTitle(toolCalls);

  return (
    <div className="my-1.5 h-[200px] rounded-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900/30 overflow-hidden flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-zinc-200 dark:border-zinc-700 px-3 py-1.5 shrink-0">
        <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
          {title}
        </span>
        <span className="ml-auto text-[10px] text-zinc-400 dark:text-zinc-500">
          {toolCalls.length}
        </span>
      </div>

      {/* Tool list — one line per tool */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {toolCalls.map((tc, i) => (
          <div
            key={tc.id || i}
            className="flex items-center gap-2 border-b border-zinc-100 px-3 py-1.5 last:border-b-0 dark:border-zinc-800"
          >
            {/* Status icon */}
            <span className="shrink-0">
              {tc.status === 'running' ? (
                <Loader2 className="h-3 w-3 animate-spin text-blue-500" />
              ) : tc.status === 'failed' ? (
                <XCircle className="h-3 w-3 text-red-500" />
              ) : (
                <CheckCircle2 className="h-3 w-3 text-green-500" />
              )}
            </span>

            {/* Tool icon */}
            <span className="shrink-0 text-zinc-400 dark:text-zinc-500">
              {getToolIcon(tc.toolName)}
            </span>

            {/* One-line summary */}
            <span className="min-w-0 flex-1 truncate text-xs text-zinc-600 dark:text-zinc-400 font-mono">
              {getToolOneLiner(tc)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
});
