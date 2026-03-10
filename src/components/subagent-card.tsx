'use client';

import { memo, useState } from 'react';
import { Blocks, ChevronDown, ChevronRight, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import type { ChatToolCall } from '@/types';

interface SubagentCardProps {
  toolCall: ChatToolCall;
}

const agentTypeLabels: Record<string, { label: string; color: string }> = {
  Explore: { label: '探索', color: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400' },
  Plan: { label: '规划', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  Bash: { label: '命令', color: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-300' },
  'general-purpose': { label: '通用', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
  'claude-code-guide': { label: '指南', color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' },
};

const statusIcons: Record<string, React.ReactNode> = {
  running: <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />,
  completed: <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />,
  failed: <XCircle className="h-3.5 w-3.5 text-red-500" />,
};

/**
 * Specialized card for the Task (subagent) tool.
 * Shows agent type, description, and a preview of the output.
 */
export const SubagentCard = memo(function SubagentCard({ toolCall }: SubagentCardProps) {
  const [expanded, setExpanded] = useState(false);

  let agentType = '';
  let description = '';
  let prompt = '';
  try {
    const parsed = JSON.parse(toolCall.input);
    agentType = parsed.subagent_type || '';
    description = parsed.description || '';
    prompt = parsed.prompt || '';
  } catch {
    return null;
  }

  const typeInfo = agentTypeLabels[agentType] || { label: agentType, color: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400' };
  const isRunning = toolCall.status === 'running';

  // Truncate output for preview
  const outputPreview = toolCall.output
    ? toolCall.output.length > 200
      ? toolCall.output.slice(0, 200) + '...'
      : toolCall.output
    : '';

  return (
    <div className="my-1.5 rounded-lg border border-blue-200 bg-blue-50/50 dark:border-blue-800 dark:bg-blue-950/30">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        {statusIcons[toolCall.status] || statusIcons.running}
        <Blocks className="h-3.5 w-3.5 text-blue-500" />
        <span className="text-xs font-medium text-blue-700 dark:text-blue-300">
          子代理
        </span>
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${typeInfo.color}`}>
          {typeInfo.label}
        </span>
        <span className="flex-1 truncate text-xs text-zinc-500 dark:text-zinc-400">
          {description}
        </span>
        {expanded
          ? <ChevronDown className="h-3 w-3 shrink-0 text-zinc-400" />
          : <ChevronRight className="h-3 w-3 shrink-0 text-zinc-400" />}
      </button>

      {/* Running indicator */}
      {isRunning && (
        <div className="mx-3 mb-2 h-1 overflow-hidden rounded-full bg-blue-200/50 dark:bg-blue-900/30">
          <div className="h-full w-1/3 animate-pulse rounded-full bg-blue-400" />
        </div>
      )}

      {/* Output preview (shown when completed, without expanding) */}
      {!isRunning && outputPreview && !expanded && (
        <div className="mx-3 mb-2 rounded border border-zinc-200 bg-white/50 px-2 py-1.5 text-[10px] text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900/50 dark:text-zinc-400">
          {outputPreview}
        </div>
      )}

      {/* Expanded details */}
      {expanded && (
        <div className="border-t border-blue-200 dark:border-blue-800">
          {/* Prompt */}
          {prompt && (
            <div className="px-3 py-2">
              <div className="mb-0.5 text-[10px] font-medium uppercase text-zinc-400">Prompt</div>
              <pre className="max-h-24 overflow-auto whitespace-pre-wrap break-all text-xs text-zinc-600 dark:text-zinc-300">
                {prompt}
              </pre>
            </div>
          )}

          {/* Full output */}
          {toolCall.output && (
            <div className="border-t border-blue-200 px-3 py-2 dark:border-blue-800">
              <div className="mb-0.5 text-[10px] font-medium uppercase text-zinc-400">Output</div>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all text-xs text-zinc-600 dark:text-zinc-300">
                {toolCall.output}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
});
