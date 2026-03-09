'use client';

import { memo, useRef, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import type { ChatToolCall } from '@/types';
import { getToolOneLiner, getToolGroupTitle } from '@/lib/tool-utils';

interface ToolExecutionWindowProps {
  toolCalls: ChatToolCall[];
}

/**
 * 紧凑工具执行窗：一行标题 + 一行内容（当前工具摘要），水平滚动
 */
export const ToolExecutionWindow = memo(function ToolExecutionWindow({
  toolCalls,
}: ToolExecutionWindowProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // 新工具加入时滚到最右
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
    }
  }, [toolCalls.length]);

  if (toolCalls.length === 0) return null;

  const title = getToolGroupTitle(toolCalls);
  const latest = toolCalls[toolCalls.length - 1];
  const isRunning = latest.status === 'running';

  return (
    <div className="my-1.5 rounded border border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900/30 overflow-hidden">
      {/* 标题行 */}
      <div className="flex items-center gap-1.5 px-2 py-1 border-b border-zinc-200 dark:border-zinc-700">
        {isRunning && <Loader2 className="h-3 w-3 animate-spin text-blue-500 shrink-0" />}
        <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
          {title}
        </span>
        <span className="ml-auto text-[10px] text-zinc-400 dark:text-zinc-500">
          {toolCalls.length}
        </span>
      </div>

      {/* 内容行：当前工具摘要，水平滚动 */}
      <div ref={scrollRef} className="overflow-x-auto px-2 py-1">
        <span className="whitespace-nowrap text-[11px] font-mono text-zinc-600 dark:text-zinc-400">
          {getToolOneLiner(latest)}
        </span>
      </div>
    </div>
  );
});
