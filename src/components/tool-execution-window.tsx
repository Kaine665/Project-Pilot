'use client';

import { memo, useState, useRef, useEffect } from 'react';
import { Loader2, CheckCircle2, XCircle, ChevronDown, ChevronRight } from 'lucide-react';
import type { ChatToolCall } from '@/types';
import { getToolIcon, getToolOneLiner, getToolGroupTitle } from '@/lib/tool-utils';

interface ToolExecutionWindowProps {
  toolCalls: ChatToolCall[];
}

/**
 * 紧凑工具执行窗：标题行（标题左 + 展开按钮居中）+ 当前工具摘要
 * 展开后显示所有工具列表
 */
export const ToolExecutionWindow = memo(function ToolExecutionWindow({
  toolCalls,
}: ToolExecutionWindowProps) {
  const [expanded, setExpanded] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  // 展开时自动滚到底部
  useEffect(() => {
    if (expanded && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [expanded, toolCalls.length]);

  if (toolCalls.length === 0) return null;

  const title = getToolGroupTitle(toolCalls);
  const latest = toolCalls[toolCalls.length - 1];
  const isRunning = latest.status === 'running';

  return (
    <div className="my-1.5 rounded border border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900/30 overflow-hidden">
      {/* 标题行：标题左侧，展开按钮居中 */}
      <div
        className="grid grid-cols-3 items-center px-2 py-1 cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800/50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        {/* 左：标题 */}
        <div className="flex items-center gap-1 justify-start">
          {isRunning && <Loader2 className="h-3 w-3 animate-spin text-blue-500 shrink-0" />}
          <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 truncate">
            {title}
          </span>
          <span className="text-[10px] text-zinc-400 dark:text-zinc-500 shrink-0">
            ({toolCalls.length})
          </span>
        </div>
        {/* 中：展开/收起按钮 */}
        <div className="flex justify-center">
          {expanded
            ? <ChevronDown className="h-3 w-3 text-zinc-400" />
            : <ChevronRight className="h-3 w-3 text-zinc-400" />
          }
        </div>
        {/* 右：留空 */}
        <div />
      </div>

      {/* 收起时：只显示当前工具摘要 */}
      {!expanded && (
        <div className="border-t border-zinc-200 dark:border-zinc-700 px-2 py-1">
          <span className="truncate block text-[11px] font-mono text-zinc-600 dark:text-zinc-400">
            {getToolOneLiner(latest)}
          </span>
        </div>
      )}

      {/* 展开时：所有工具列表 */}
      {expanded && (
        <div ref={listRef} className="border-t border-zinc-200 dark:border-zinc-700 max-h-[200px] overflow-y-auto">
          {toolCalls.map((tc, i) => (
            <div
              key={tc.id ? `${tc.id}-${i}` : `tool-${i}`}
              className="flex items-center gap-1.5 px-2 py-1 border-b border-zinc-100 last:border-b-0 dark:border-zinc-800"
            >
              <span className="shrink-0">
                {tc.status === 'running' ? (
                  <Loader2 className="h-3 w-3 animate-spin text-blue-500" />
                ) : tc.status === 'failed' ? (
                  <XCircle className="h-3 w-3 text-red-500" />
                ) : (
                  <CheckCircle2 className="h-3 w-3 text-green-500" />
                )}
              </span>
              <span className="shrink-0 text-zinc-400 dark:text-zinc-500">
                {getToolIcon(tc.toolName)}
              </span>
              <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-600 dark:text-zinc-400 font-mono">
                {getToolOneLiner(tc)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});
