'use client';

import { memo, useState, useMemo } from 'react';
import { Bot, User, GitBranch, BookMarked, Copy, Check, Trash2, RefreshCw, ClipboardList } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { ToolCallCard } from '@/components/tool-call-card';
import { ToolExecutionWindow } from '@/components/tool-execution-window';
import { FormattedText } from '@/components/formatted-text';
import type { ParsedActionTag } from '@/lib/action-tag-parser';
import type { ChatMessage, ContentBlock, ChatToolCall } from '@/types';
import { isRepetitiveTool } from '@/lib/tool-utils';

interface ChatBubbleProps {
  message: ChatMessage;
  /** For streaming: ordered content blocks */
  streamingBlocks?: ContentBlock[];
  isStreaming?: boolean;
  /** Callback to branch from this message */
  onBranch?: (messageId: string) => void;
  /** Callback to save message as knowledge draft */
  onSaveAsKnowledge?: (messageId: string, content: string) => void;
  /** Show action buttons */
  showActions?: boolean;
  /** Callback to copy message text */
  onCopy?: (text: string) => void;
  /** Callback to delete this message */
  onDelete?: (messageId: string) => void;
  /** Callback to regenerate (resend last user message). Only for assistant messages. */
  onRegenerate?: () => void;
  /** Whether this is the last assistant message (for regenerate button) */
  isLastAssistant?: boolean;
  /** Callback to retry a failed send */
  onRetry?: () => void;
  /** Whether this message had a send failure */
  hasSendError?: boolean;
  /** Callback to view plan content in side panel */
  onViewPlan?: (content: string) => void;
  /** Callback when a file path in the message is clicked */
  onFileClick?: (filePath: string) => void;
  /** Callback when user clicks an action card to preview its content */
  onActionPreview?: (tag: ParsedActionTag) => void;
  /** Callback when user rejects an action */
  onActionReject?: (tag: ParsedActionTag) => void;
  /** Callback when user restores a rejected action */
  onActionRestore?: (tag: ParsedActionTag) => void;
}

export const ChatBubble = memo(function ChatBubble({
  message,
  streamingBlocks,
  isStreaming,
  onBranch,
  onSaveAsKnowledge,
  showActions,
  onCopy,
  onDelete,
  onRegenerate,
  isLastAssistant,
  onRetry,
  hasSendError,
  onViewPlan,
  onFileClick,
  onActionPreview,
  onActionReject,
  onActionRestore,
}: ChatBubbleProps) {
  const t = useTranslations();
  const isUser = message.role === 'user';
  const [copied, setCopied] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Determine which blocks to render:
  // 1. streamingBlocks (live streaming)
  // 2. message.contentBlocks (saved message with interleaved order)
  // 3. fallback: reconstruct from content + toolCalls (legacy messages)
  const blocks: ContentBlock[] | null =
    streamingBlocks ??
    message.contentBlocks ??
    null;

  // Detect plan content in tool calls (Write to .claude/plans/ or ExitPlanMode output)
  const planWriteContent = useMemo(() => {
    const allBlocks = blocks ?? message.contentBlocks ?? [];
    for (const b of allBlocks) {
      if (b.type !== 'tool_call') continue;
      // 1. Write to .claude/plans/ — normalize backslashes for Windows
      if (b.toolCall.toolName === 'Write') {
        try {
          const parsed = typeof b.toolCall.input === 'string'
            ? JSON.parse(b.toolCall.input)
            : b.toolCall.input;
          const fp = (parsed?.file_path ?? '').replace(/\\/g, '/');
          if (fp.includes('.claude/plans/')) return parsed.content as string;
        } catch { /* ignore */ }
      }
      // 2. ExitPlanMode output contains the plan content
      if (b.toolCall.toolName === 'ExitPlanMode' && b.toolCall.output) {
        const out = b.toolCall.output.trim();
        if (out.length > 50) return out;
      }
    }
    return null;
  }, [blocks, message.contentBlocks]);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    const text = message.content || '';
    if (onCopy) {
      onCopy(text);
    } else {
      navigator.clipboard.writeText(text);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // AskUserQuestion tool calls are rendered outside the bubble for prominence
  const isAskUserQuestion = (block: ContentBlock) =>
    block.type === 'tool_call' && block.toolCall.toolName === 'AskUserQuestion';

  const renderBlocks = (blocksToRender: ContentBlock[]) => {
    // 过滤掉 AskUserQuestion（它们在气泡外部单独渲染）
    const filteredBlocks = blocksToRender.filter((b) => !isAskUserQuestion(b));

    const lastTextIdx = filteredBlocks.reduce(
      (acc, b, i) => (b.type === 'text' ? i : acc),
      -1,
    );

    // 将 blocks 分组：连续的重复性工具合并为一组
    const groups: Array<
      | { type: 'block'; block: ContentBlock; index: number }
      | { type: 'tool_group'; toolCalls: ChatToolCall[] }
    > = [];

    let pendingTools: ChatToolCall[] = [];

    const flushTools = () => {
      if (pendingTools.length > 0) {
        groups.push({ type: 'tool_group', toolCalls: [...pendingTools] });
        pendingTools = [];
      }
    };

    for (let i = 0; i < filteredBlocks.length; i++) {
      const block = filteredBlocks[i];
      if (block.type === 'tool_call' && isRepetitiveTool(block.toolCall.toolName)) {
        pendingTools.push(block.toolCall);
      } else {
        flushTools();
        groups.push({ type: 'block', block, index: i });
      }
    }
    flushTools();

    return groups.map((group, gi) => {
      if (group.type === 'tool_group') {
        return <ToolExecutionWindow key={`tg-${gi}`} toolCalls={group.toolCalls} />;
      }

      const { block, index: i } = group;

      if (block.type === 'text') {
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
            <FormattedText
              text={block.text}
              className="leading-relaxed space-y-1.5"
              onFileClick={onFileClick}
              isStreaming={isStreaming && i === lastTextIdx}
              onActionPreview={onActionPreview}
              onActionReject={onActionReject}
              onActionRestore={onActionRestore}
            />
            {isStreaming && i === lastTextIdx && (
              <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-current opacity-60" />
            )}
          </div>
        );
      }

      // 使用 index 后缀确保 key 唯一，防止 toolCall.id 重复
      return (
        <div key={`${block.toolCall.id}-${i}`} className="my-1.5">
          <ToolCallCard toolCall={block.toolCall} />
        </div>
      );
    });
  };

  // Collect AskUserQuestion blocks to render outside the bubble
  const askUserBlocks = (blocks ?? message.contentBlocks ?? [])
    .filter(isAskUserQuestion) as Array<ContentBlock & { type: 'tool_call' }>;

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
            <FormattedText
              text={message.content}
              className="leading-relaxed space-y-1.5"
              onFileClick={onFileClick}
              onActionPreview={onActionPreview}
              onActionReject={onActionReject}
              onActionRestore={onActionRestore}
            />
          )}
        </div>
      )}
      {message.toolCalls && message.toolCalls.length > 0 && (
        <div className="mt-1.5">
          {(() => {
            const result: React.ReactNode[] = [];
            let pending: ChatToolCall[] = [];
            const flush = () => {
              if (pending.length > 0) {
                result.push(<ToolExecutionWindow key={`lg-${result.length}`} toolCalls={[...pending]} />);
                pending = [];
              }
            };
            for (let i = 0; i < message.toolCalls!.length; i++) {
              const tc = message.toolCalls![i];
              if (isRepetitiveTool(tc.toolName)) {
                pending.push(tc);
              } else {
                flush();
                result.push(<ToolCallCard key={`${tc.id}-${i}`} toolCall={tc} />);
              }
            }
            flush();
            return result;
          })()}
        </div>
      )}
    </>
  );

  return (
    <div className={`group/bubble flex gap-2 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      {/* Avatar */}
      <div
        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
          isUser
            ? 'bg-user-subtle text-user'
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
              ? 'bg-user text-white'
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

          {/* Plan file write badge */}
          {planWriteContent && onViewPlan && (
            <button
              onClick={(e) => { e.stopPropagation(); onViewPlan(planWriteContent); }}
              className="mt-2 flex h-[60px] w-[200px] items-center justify-center gap-2 rounded-lg border border-blue-200 bg-blue-50 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-400 dark:hover:bg-blue-900/40"
            >
              <ClipboardList className="h-5 w-5 shrink-0" />
              <span>查看计划</span>
            </button>
          )}
        </div>

        {/* AskUserQuestion cards — rendered outside the bubble for prominence */}
        {askUserBlocks.length > 0 && (
          <div className="mt-1.5">
            {askUserBlocks.map((block, idx) => (
              <ToolCallCard key={`${block.toolCall.id}-${idx}`} toolCall={block.toolCall} />
            ))}
          </div>
        )}

        {/* Retry button for failed sends (user messages) */}
        {hasSendError && isUser && onRetry && showActions && (
          <div className={`mt-1 flex items-center gap-1.5 ${isUser ? 'justify-end' : 'justify-start'}`}>
            <span className="text-xs text-red-400 dark:text-red-500">发送失败</span>
            <button
              onClick={(e) => { e.stopPropagation(); if (!isStreaming) onRetry(); }}
              disabled={isStreaming}
              className="flex items-center gap-0.5 rounded px-2 py-1 text-xs text-red-500 transition-colors hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-950/30 dark:hover:text-red-300 disabled:opacity-40 disabled:pointer-events-none"
            >
              <RefreshCw className="h-3 w-3" />
              <span>重试</span>
            </button>
          </div>
        )}

        {/* Action toolbar: hover-visible */}
        {showActions && (
          <div className={`mt-0.5 flex items-center gap-1 opacity-0 transition-opacity group-hover/bubble:opacity-100 ${isUser ? 'justify-end' : 'justify-start'}`}>
            {/* Copy — always available */}
            <button
              onClick={handleCopy}
              className="flex items-center gap-0.5 rounded px-2 py-1 text-xs text-zinc-300 transition-colors hover:bg-zinc-100 hover:text-zinc-500 dark:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-400"
              title="复制"
            >
              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              <span>{copied ? '已复制' : '复制'}</span>
            </button>

            {/* Save as knowledge (assistant only) — always available */}
            {!isUser && onSaveAsKnowledge && (
              <button
                onClick={(e) => { e.stopPropagation(); onSaveAsKnowledge(message.id, message.content || ''); }}
                className="flex items-center gap-0.5 rounded px-2 py-1 text-xs text-zinc-300 transition-colors hover:bg-zinc-100 hover:text-zinc-500 dark:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-400"
                title="存为知识"
              >
                <BookMarked className="h-3 w-3" />
                <span>存为知识</span>
              </button>
            )}

            {/* Branch — always available (safe during streaming) */}
            {onBranch && (
              <button
                onClick={(e) => { e.stopPropagation(); onBranch(message.id); }}
                className="flex items-center gap-0.5 rounded px-2 py-1 text-xs text-zinc-300 transition-colors hover:bg-zinc-100 hover:text-zinc-500 dark:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-400"
                title={t('chat.createBranchFrom')}
              >
                <GitBranch className="h-3 w-3" />
                <span>{t('chat.branch')}</span>
              </button>
            )}

            {/* Regenerate (last assistant only) — disabled during streaming */}
            {!isUser && isLastAssistant && onRegenerate && (
              <button
                onClick={(e) => { e.stopPropagation(); if (!isStreaming) onRegenerate(); }}
                disabled={isStreaming}
                className="flex items-center gap-0.5 rounded px-2 py-1 text-xs text-zinc-300 transition-colors hover:bg-zinc-100 hover:text-zinc-500 dark:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-400 disabled:opacity-40 disabled:pointer-events-none"
                title="重新生成"
              >
                <RefreshCw className="h-3 w-3" />
                <span>重新生成</span>
              </button>
            )}

            {/* Delete with confirmation — disabled during streaming */}
            {onDelete && !confirmDelete && (
              <button
                onClick={(e) => { e.stopPropagation(); if (!isStreaming) setConfirmDelete(true); }}
                disabled={isStreaming}
                className="flex items-center gap-0.5 rounded px-2 py-1 text-xs text-zinc-300 transition-colors hover:bg-red-50 hover:text-red-500 dark:text-zinc-600 dark:hover:bg-red-950/30 dark:hover:text-red-400 disabled:opacity-40 disabled:pointer-events-none"
                title="删除"
              >
                <Trash2 className="h-3 w-3" />
                <span>删除</span>
              </button>
            )}
            {onDelete && confirmDelete && (
              <>
                <button
                  onClick={(e) => { e.stopPropagation(); onDelete(message.id); setConfirmDelete(false); }}
                  className="flex items-center gap-0.5 rounded px-2 py-1 text-xs text-red-500 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
                >
                  <Trash2 className="h-3 w-3" />
                  <span>确认删除</span>
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setConfirmDelete(false); }}
                  className="flex items-center gap-0.5 rounded px-2 py-1 text-xs text-zinc-300 transition-colors hover:bg-zinc-100 hover:text-zinc-500 dark:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-400"
                >
                  <span>取消</span>
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
});
