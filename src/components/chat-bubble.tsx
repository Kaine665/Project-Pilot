'use client';

import { memo } from 'react';
import { Bot, User, GitBranch, BookMarked } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { ToolCallCard } from '@/components/tool-call-card';
import { FormattedText } from '@/components/formatted-text';
import type { ChatMessage, ContentBlock } from '@/types';

interface ChatBubbleProps {
  message: ChatMessage;
  /** For streaming: ordered content blocks */
  streamingBlocks?: ContentBlock[];
  isStreaming?: boolean;
  /** Callback to branch from this message */
  onBranch?: (messageId: string) => void;
  /** Callback to save message as knowledge draft */
  onSaveAsKnowledge?: (messageId: string, content: string) => void;
  /** Show action buttons (hidden during streaming) */
  showActions?: boolean;
}

export const ChatBubble = memo(function ChatBubble({
  message,
  streamingBlocks,
  isStreaming,
  onBranch,
  onSaveAsKnowledge,
  showActions,
}: ChatBubbleProps) {
  const t = useTranslations();
  const isUser = message.role === 'user';

  // Determine which blocks to render:
  // 1. streamingBlocks (live streaming)
  // 2. message.contentBlocks (saved message with interleaved order)
  // 3. fallback: reconstruct from content + toolCalls (legacy messages)
  const blocks: ContentBlock[] | null =
    streamingBlocks ??
    message.contentBlocks ??
    null;

  const renderBlocks = (blocksToRender: ContentBlock[]) => {
    const lastTextIdx = blocksToRender.reduce(
      (acc, b, i) => (b.type === 'text' ? i : acc),
      -1,
    );

    return blocksToRender.map((block, i) => {
      if (block.type === 'text') {
        // 只格式化 AI 消息，用户消息保持纯文本
        if (isUser) {
          return (
            <div key={i} className="whitespace-pre-wrap wrap-break-word leading-relaxed">
              {block.text}
              {isStreaming && i === lastTextIdx && (
                <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-current opacity-60" />
              )}
            </div>
          );
        }

        return (
          <div key={i} className="wrap-break-word">
            <FormattedText text={block.text} className="leading-relaxed space-y-1.5" />
            {isStreaming && i === lastTextIdx && (
              <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-current opacity-60" />
            )}
          </div>
        );
      }
      return (
        <div key={block.toolCall.id} className="my-1.5">
          <ToolCallCard toolCall={block.toolCall} />
        </div>
      );
    });
  };

  const renderImages = () => {
    if (!isUser || !message.images || message.images.length === 0) return null;
    return (
      <div className="mb-1.5 flex flex-wrap gap-1.5">
        {message.images.map((src, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={i} src={src} alt="" className="max-h-48 max-w-xs rounded object-contain border border-white/20" />
        ))}
      </div>
    );
  };

  const renderLegacy = () => (
    <>
      {renderImages()}
      {message.content && (
        <div className="wrap-break-word">
          {isUser ? (
            <div className="whitespace-pre-wrap leading-relaxed">{message.content}</div>
          ) : (
            <FormattedText text={message.content} className="leading-relaxed space-y-1.5" />
          )}
        </div>
      )}
      {message.toolCalls && message.toolCalls.length > 0 && (
        <div className="mt-1.5">
          {message.toolCalls.map((tc) => (
            <ToolCallCard key={tc.id} toolCall={tc} />
          ))}
        </div>
      )}
    </>
  );

  return (
    <div className={`flex gap-2 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      {/* Avatar */}
      <div
        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
          isUser
            ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/50 dark:text-blue-400'
            : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'
        }`}
      >
        {isUser ? <User className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
      </div>

      {/* Bubble */}
      <div className="max-w-[85%]">
        <div
          className={`rounded-lg px-3 py-2 text-sm ${
            isUser
              ? 'bg-blue-500 text-white'
              : 'bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200'
          }`}
        >
          {blocks ? <>{renderImages()}{renderBlocks(blocks)}</> : renderLegacy()}

          {/* Interrupted indicator */}
          {message.interrupted && (
            <div className="mt-1.5 text-xs text-zinc-400 dark:text-zinc-500">
              {t('chat.interrupted')}
            </div>
          )}

          {/* Extracted plan indicator */}
          {message.extractedPlanId && (
            <div className="mt-1.5 rounded border border-green-200 bg-green-50 px-2 py-1 text-xs text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-400">
              {t('chat.planExtracted')}
            </div>
          )}
        </div>

        {/* Actions: branch + save as knowledge */}
        {showActions && (onBranch || (!isUser && onSaveAsKnowledge)) && (
          <div className={`mt-0.5 flex items-center gap-1 ${isUser ? 'justify-end' : 'justify-start'}`}>
            {!isUser && onSaveAsKnowledge && (
              <button
                onClick={(e) => { e.stopPropagation(); onSaveAsKnowledge(message.id, message.content || ''); }}
                className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] text-zinc-300 transition-colors hover:bg-zinc-100 hover:text-zinc-500 dark:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-400"
                title="存为知识"
              >
                <BookMarked className="h-2.5 w-2.5" />
                <span>存为知识</span>
              </button>
            )}
            {onBranch && (
              <button
                onClick={(e) => { e.stopPropagation(); onBranch(message.id); }}
                className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] text-zinc-300 transition-colors hover:bg-zinc-100 hover:text-zinc-500 dark:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-400"
                title={t('chat.createBranchFrom')}
              >
                <GitBranch className="h-2.5 w-2.5" />
                <span>{t('chat.branch')}</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
});
