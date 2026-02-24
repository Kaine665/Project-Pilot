'use client';

import { useState, memo } from 'react';
import { ChevronDown, ChevronRight, Terminal, FileText, Pencil, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import type { ChatToolCall } from '@/types';

const toolIcons: Record<string, React.ReactNode> = {
  Bash: <Terminal className="h-3 w-3" />,
  Read: <FileText className="h-3 w-3" />,
  Edit: <Pencil className="h-3 w-3" />,
  Write: <Pencil className="h-3 w-3" />,
  Glob: <FileText className="h-3 w-3" />,
  Grep: <FileText className="h-3 w-3" />,
};

const statusIcons: Record<ChatToolCall['status'], React.ReactNode> = {
  running: <Loader2 className="h-3 w-3 animate-spin text-blue-500" />,
  completed: <CheckCircle2 className="h-3 w-3 text-green-500" />,
  failed: <XCircle className="h-3 w-3 text-red-500" />,
};

interface ToolCallCardProps {
  toolCall: ChatToolCall;
}

export const ToolCallCard = memo(function ToolCallCard({ toolCall }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false);

  const icon = toolIcons[toolCall.toolName] ?? <Terminal className="h-3 w-3" />;

  // Truncate long input for display
  const displayInput = toolCall.input.length > 120
    ? toolCall.input.slice(0, 120) + '...'
    : toolCall.input;

  return (
    <div className="my-1 rounded border border-zinc-200 bg-zinc-50 text-xs dark:border-zinc-700 dark:bg-zinc-800/50">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left"
      >
        {statusIcons[toolCall.status]}
        <span className="text-zinc-400">{icon}</span>
        <span className="font-medium text-zinc-600 dark:text-zinc-300">
          {toolCall.toolName}
        </span>
        <span className="flex-1 truncate text-zinc-400">
          {displayInput}
        </span>
        {expanded
          ? <ChevronDown className="h-3 w-3 shrink-0 text-zinc-400" />
          : <ChevronRight className="h-3 w-3 shrink-0 text-zinc-400" />}
      </button>

      {expanded && (
        <div className="border-t border-zinc-200 dark:border-zinc-700">
          {/* Input */}
          <div className="px-2 py-1.5">
            <div className="mb-0.5 text-[10px] font-medium uppercase text-zinc-400">Input</div>
            <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all text-zinc-600 dark:text-zinc-300">
              {toolCall.input}
            </pre>
          </div>

          {/* Output */}
          {toolCall.output && (
            <div className="border-t border-zinc-200 px-2 py-1.5 dark:border-zinc-700">
              <div className="mb-0.5 text-[10px] font-medium uppercase text-zinc-400">Output</div>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all text-zinc-600 dark:text-zinc-300">
                {toolCall.output}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
});
