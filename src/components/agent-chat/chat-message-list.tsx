'use client';

import { useMemo } from 'react';
import { Loader2, FileDown, ClipboardList } from 'lucide-react';
import { ChatBubble } from '@/components/chat-bubble';
import type { ParsedActionTag } from '@/lib/action-tag-parser';
import type { ChatMessage, ContentBlock } from '@/types';

export interface ChatMessageListProps {
  messages: ChatMessage[];
  isStreaming: boolean;
  streamingBlocks: ContentBlock[];
  streamingMessage: ChatMessage;
  errorMsg: string | null;
  inPlanMode: boolean;
  /** Show "session too long" compress hint */
  showCompressHint: boolean;
  /** Localized "thinking" text */
  thinkingText: string;
  onSaveAsKnowledge: (messageId: string, content: string) => void;
  onDelete: (messageId: string) => void;
  onRegenerate: () => void;
  onBranch: (messageId: string) => void;
  onEdit?: (messageId: string, content: string) => Promise<boolean> | boolean;
  onRetry: () => void;
  onViewPlan: (content: string) => void;
  onFileClick: (filePath: string) => void;
  onCompressOpen: () => void;
  onCompressDismiss: () => void;
  enableUserMessageEdit?: boolean;
  showUserMessageBranch?: boolean;
  onActionPreview?: (tag: ParsedActionTag) => void;
  onActionReject?: (tag: ParsedActionTag) => void;
  onActionRestore?: (tag: ParsedActionTag) => void;
}

export function ChatMessageList({
  messages,
  isStreaming,
  streamingBlocks,
  streamingMessage,
  errorMsg,
  inPlanMode,
  showCompressHint,
  thinkingText,
  onSaveAsKnowledge,
  onDelete,
  onRegenerate,
  onBranch,
  onEdit,
  onRetry,
  onViewPlan,
  onFileClick,
  onCompressOpen,
  onCompressDismiss,
  enableUserMessageEdit = false,
  showUserMessageBranch = true,
  onActionPreview,
  onActionReject,
  onActionRestore,
}: ChatMessageListProps) {
  const lastAssistantId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') return messages[i].id;
    }
    return null;
  }, [messages]);

  return (
    <>
      {/* Auto-compress hint */}
      {showCompressHint && (
        <div className="mb-2 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2 text-xs dark:border-amber-800 dark:bg-amber-950/30">
          <FileDown className="h-3.5 w-3.5 shrink-0 text-amber-500" />
          <span className="flex-1 text-amber-700 dark:text-amber-400">
            Session is getting long ({messages.length} messages). Compress history to keep context available.
          </span>
          <button
            onClick={onCompressOpen}
            className="rounded px-2 py-0.5 text-xs font-medium text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/50"
          >
            压缩
          </button>
          <button
            onClick={onCompressDismiss}
            className="rounded px-2 py-0.5 text-xs text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            忽略
          </button>
        </div>
      )}

      {messages.map((msg) => (
        <ChatBubble
          key={msg.id}
          message={msg}
          showActions
          isStreaming={isStreaming}
          onSaveAsKnowledge={onSaveAsKnowledge}
          onDelete={onDelete}
          onRegenerate={onRegenerate}
          onBranch={msg.role === 'user' && !showUserMessageBranch ? undefined : onBranch}
          onEdit={msg.role === 'user' && enableUserMessageEdit ? onEdit : undefined}
          isLastAssistant={msg.id === lastAssistantId}
          onRetry={onRetry}
          hasSendError={!!errorMsg && msg.role === 'user' && msg.id === messages[messages.length - 1]?.id}
          onViewPlan={onViewPlan}
          onFileClick={onFileClick}
          onActionPreview={onActionPreview}
          onActionReject={onActionReject}
          onActionRestore={onActionRestore}
        />
      ))}

      {isStreaming && streamingBlocks.length > 0 && (
        <ChatBubble
          message={streamingMessage}
          streamingBlocks={streamingBlocks}
          isStreaming
          onActionPreview={onActionPreview}
          onActionReject={onActionReject}
          onActionRestore={onActionRestore}
        />
      )}

      {isStreaming && streamingBlocks.length === 0 && (
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <Loader2 className="h-3 w-3 animate-spin" />
          {thinkingText}
        </div>
      )}

      {inPlanMode && isStreaming && (
        <div className="flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs text-blue-600 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-400">
          <ClipboardList className="h-3.5 w-3.5" />
          <span>AI is planning...</span>
        </div>
      )}

      {errorMsg && !isStreaming && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400">
          {errorMsg}
        </div>
      )}
    </>
  );
}
