'use client';

import { Layers, ChevronUp, ChevronDown, ArrowUp, Trash2 } from 'lucide-react';
import type { DeferredInputBufferItem } from '@/types/agent-chat';

export interface ChatQueueOverlayProps {
  pendingMessages: DeferredInputBufferItem[];
  expanded: boolean;
  onToggleExpanded: (expanded: boolean) => void;
  onSendNow: (index: number) => void;
  onRemove: (index: number) => void;
}

export function ChatQueueOverlay({
  pendingMessages,
  expanded,
  onToggleExpanded,
  onSendNow,
  onRemove,
}: ChatQueueOverlayProps) {
  if (pendingMessages.length === 0) return null;

  return (
    <div className="absolute bottom-0 left-0 right-0 z-10 px-6 pb-2 pointer-events-none">
      <div className="mx-auto w-96 pointer-events-auto">
        {expanded ? (
          <>
            <button
              type="button"
              onClick={() => onToggleExpanded(false)}
              className="flex w-full items-center justify-between gap-2 rounded-t-xl border border-b-0 border-blue-200/80 bg-blue-50/60 px-3 py-2 text-left text-xs font-medium text-blue-700 backdrop-blur-md transition-colors hover:bg-blue-50/80 dark:border-blue-800/80 dark:bg-blue-950/40 dark:text-blue-300 dark:hover:bg-blue-950/60"
            >
              <span className="flex items-center gap-1.5">
                <Layers className="h-3.5 w-3.5" />
                {pendingMessages.length} 条消息排队
              </span>
              <span className="flex items-center gap-1">
                [收起]
                <ChevronUp className="h-3.5 w-3.5" />
              </span>
            </button>
            <div className="space-y-1.5 rounded-b-xl border border-blue-200/80 border-t-0 bg-white/70 px-3 py-2 backdrop-blur-md dark:border-blue-800/80 dark:bg-zinc-900/70">
              {pendingMessages.map((m, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between gap-2 rounded-lg border border-blue-100/80 bg-white/50 px-2.5 py-1.5 backdrop-blur-sm dark:border-blue-800/60 dark:bg-zinc-800/40"
                >
                  <span className="min-w-0 flex-1 truncate text-xs text-zinc-700 dark:text-zinc-300">
                    {i + 1}. {m.text.trim().slice(0, 80)}{m.text.length > 80 ? '\u2026' : ''}
                  </span>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => onSendNow(i)}
                      className="rounded p-1 text-blue-500 hover:bg-blue-100 hover:text-blue-600 dark:text-blue-400 dark:hover:bg-blue-900/50"
                      title="立即发送"
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemove(i)}
                      className="rounded p-1 text-zinc-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/50"
                      title="从队列移除"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <button
            type="button"
            onClick={() => onToggleExpanded(true)}
            className="flex w-full items-center justify-between gap-2 rounded-xl border border-blue-200/80 bg-blue-50/60 px-3 py-2 text-left text-xs font-medium text-blue-700 backdrop-blur-md transition-colors hover:bg-blue-50/80 dark:border-blue-800/80 dark:bg-blue-950/40 dark:text-blue-300 dark:hover:bg-blue-950/60"
          >
            <span className="flex items-center gap-1.5">
              <Layers className="h-3.5 w-3.5" />
              {pendingMessages.length} 条消息排队
            </span>
            <span className="flex items-center gap-1">
              [展开]
              <ChevronDown className="h-3.5 w-3.5" />
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
