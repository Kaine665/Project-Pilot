'use client';

import { memo } from 'react';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';
import type { ChatToolCall } from '@/types';
import { getToolDisplayName } from '@/lib/tool-utils';

interface ToolExecutionWindowProps {
  toolCall: ChatToolCall | null;
}

/**
 * 固定尺寸的工具执行观察窗（200px）
 * 用于显示当前执行的工具调用详情，替代主气泡中的重复操作显示
 */
export const ToolExecutionWindow = memo(function ToolExecutionWindow({
  toolCall,
}: ToolExecutionWindowProps) {
  if (!toolCall) {
    return (
      <div className="h-[200px] rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-3 flex items-center justify-center text-xs text-zinc-400 dark:border-zinc-600 dark:bg-zinc-900/30 dark:text-zinc-500">
        无工具执行
      </div>
    );
  }

  const { name: displayName, isMcp } = getToolDisplayName(toolCall.toolName);
  const statusIcon = getStatusIcon(toolCall.status);

  return (
    <div className="h-[200px] rounded-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900/30 overflow-hidden flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-zinc-200 dark:border-zinc-700 px-3 py-2 shrink-0">
        {statusIcon}
        <span className={`text-xs font-medium ${isMcp ? 'text-orange-600 dark:text-orange-400' : 'text-zinc-600 dark:text-zinc-400'}`}>
          {displayName}
        </span>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2 text-xs text-zinc-700 dark:text-zinc-300 font-mono">
        {/* Input */}
        {toolCall.input && (
          <div className="space-y-1">
            <div className="text-zinc-500 dark:text-zinc-500">输入:</div>
            <pre className="bg-white dark:bg-zinc-800 rounded p-2 overflow-x-auto whitespace-pre-wrap break-words max-h-20 text-[11px] border border-zinc-200 dark:border-zinc-700">
              {formatInput(toolCall.input)}
            </pre>
          </div>
        )}

        {/* Output */}
        {toolCall.output && (
          <div className="space-y-1">
            <div className="text-zinc-500 dark:text-zinc-500">输出:</div>
            <pre className="bg-white dark:bg-zinc-800 rounded p-2 overflow-x-auto whitespace-pre-wrap break-words max-h-20 text-[11px] border border-zinc-200 dark:border-zinc-700">
              {formatOutput(toolCall.output)}
            </pre>
          </div>
        )}

        {/* Error */}
        {toolCall.error && (
          <div className="space-y-1">
            <div className="text-red-600 dark:text-red-400">错误:</div>
            <pre className="bg-red-50 dark:bg-red-900/20 rounded p-2 overflow-x-auto text-red-700 dark:text-red-400 whitespace-pre-wrap break-words max-h-20 text-[11px] border border-red-200 dark:border-red-800">
              {toolCall.error}
            </pre>
          </div>
        )}

        {/* Running state */}
        {toolCall.status === 'running' && !toolCall.output && (
          <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span>执行中...</span>
          </div>
        )}
      </div>
    </div>
  );
});

function getStatusIcon(status: ChatToolCall['status']) {
  const icons: Record<ChatToolCall['status'], React.ReactNode> = {
    running: <Loader2 className="h-3 w-3 animate-spin text-blue-500" />,
    completed: <CheckCircle2 className="h-3 w-3 text-green-500" />,
    failed: <XCircle className="h-3 w-3 text-red-500" />,
  };
  return icons[status];
}

function formatInput(input: string | Record<string, unknown>): string {
  if (typeof input === 'string') {
    try {
      return JSON.stringify(JSON.parse(input), null, 2);
    } catch {
      return input.slice(0, 500);
    }
  }
  return JSON.stringify(input, null, 2);
}

function formatOutput(output: string | Record<string, unknown>): string {
  if (typeof output === 'string') {
    return output.slice(0, 500);
  }
  return JSON.stringify(output, null, 2).slice(0, 500);
}
