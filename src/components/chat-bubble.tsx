'use client';

import { memo, useMemo, useState } from 'react';
import {
  BookMarked,
  Bot,
  Check,
  ClipboardList,
  Copy,
  GitBranch,
  Pencil,
  RefreshCw,
  Trash2,
  User,
} from 'lucide-react';
import { useTranslations } from '@/client/i18n/use-translations';
import { FormattedText } from '@/components/formatted-text';
import { ToolCallCard } from '@/components/tool-call-card';
import { ToolExecutionWindow } from '@/components/tool-execution-window';
import type { ParsedActionTag } from '@/lib/action-tag-parser';
import { isRepetitiveTool } from '@/lib/tool-utils';
import type { ChatMessage, ChatToolCall, ContentBlock } from '@/types';

const ThinkingFoldable = memo(function ThinkingFoldable({
  text,
  label,
  showPulse,
}: {
  text: string;
  label: string;
  showPulse: boolean;
}) {
  const [open, setOpen] = useState(true);
  return (
    <details
      className="my-2 rounded-lg border border-violet-200/80 bg-violet-50/50 text-sm dark:border-violet-900/50 dark:bg-violet-950/25"
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary className="cursor-pointer select-none px-3 py-1.5 text-violet-800 dark:text-violet-200">
        {label}
      </summary>
      <div className="whitespace-pre-wrap border-t border-violet-100 px-3 py-2 font-mono text-xs leading-relaxed text-zinc-600 wrap-break-word dark:border-violet-900/40 dark:text-zinc-400">
        {text}
        {showPulse && (
          <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-current opacity-60" />
        )}
      </div>
    </details>
  );
});

interface ChatBubbleProps {
  message: ChatMessage;
  streamingBlocks?: ContentBlock[];
  isStreaming?: boolean;
  onBranch?: (messageId: string) => void;
  onSaveAsKnowledge?: (messageId: string, content: string) => void;
  showActions?: boolean;
  onCopy?: (text: string) => void;
  onDelete?: (messageId: string) => void;
  onRegenerate?: () => void;
  isLastAssistant?: boolean;
  onRetry?: () => void;
  hasSendError?: boolean;
  onViewPlan?: (content: string) => void;
  onFileClick?: (filePath: string) => void;
  onActionPreview?: (tag: ParsedActionTag) => void;
  onActionReject?: (tag: ParsedActionTag) => void;
  onActionRestore?: (tag: ParsedActionTag) => void;
  onEdit?: (messageId: string, content: string) => Promise<boolean> | boolean;
  assistantAvatarSrc?: string;
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
  onEdit,
  assistantAvatarSrc,
}: ChatBubbleProps) {
  const t = useTranslations();
  const tActions = useTranslations('actions');
  const isUser = message.role === 'user';
  const [copied, setCopied] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  const blocks: ContentBlock[] | null = streamingBlocks ?? message.contentBlocks ?? null;

  const planWriteContent = useMemo(() => {
    const allBlocks = blocks ?? message.contentBlocks ?? [];
    for (const block of allBlocks) {
      if (block.type !== 'tool_call') continue;
      if (block.toolCall.toolName === 'Write') {
        try {
          const parsed = typeof block.toolCall.input === 'string'
            ? JSON.parse(block.toolCall.input)
            : block.toolCall.input;
          const filePath = (parsed?.file_path ?? '').replace(/\\/g, '/');
          if (filePath.includes('.claude/plans/')) {
            return parsed.content as string;
          }
        } catch {
          // ignore malformed tool input
        }
      }
      if (block.toolCall.toolName === 'ExitPlanMode' && block.toolCall.output) {
        const output = block.toolCall.output.trim();
        if (output.length > 50) return output;
      }
    }
    return null;
  }, [blocks, message.contentBlocks]);

  const editableText = useMemo(() => {
    if (typeof message.content === 'string' && message.content.length > 0) return message.content;
    const textBlock = (blocks ?? message.contentBlocks ?? []).find((block) => block.type === 'text');
    return textBlock?.type === 'text' ? textBlock.text : '';
  }, [blocks, message.content, message.contentBlocks]);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    const text = editableText || message.content || '';
    if (onCopy) {
      onCopy(text);
    } else {
      navigator.clipboard.writeText(text);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleStartEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDelete(false);
    setEditValue(editableText);
    setIsEditing(true);
  };

  const handleCancelEdit = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setEditValue(editableText);
    setIsEditing(false);
  };

  const handleSaveEdit = async () => {
    if (!onEdit || isSavingEdit) return;
    const nextContent = editValue.trim();
    if (!nextContent && (!message.images || message.images.length === 0)) return;
    if (nextContent === editableText) {
      setIsEditing(false);
      return;
    }

    setIsSavingEdit(true);
    try {
      const saved = await onEdit(message.id, nextContent);
      if (saved !== false) {
        setIsEditing(false);
      }
    } finally {
      setIsSavingEdit(false);
    }
  };

  const isAskUserQuestion = (block: ContentBlock) =>
    block.type === 'tool_call' && block.toolCall.toolName === 'AskUserQuestion';

  const renderBlocks = (blocksToRender: ContentBlock[]) => {
    const filteredBlocks = blocksToRender.filter((block) => !isAskUserQuestion(block));
    const lastTextIdx = filteredBlocks.reduce(
      (acc, block, index) => (block.type === 'text' ? index : acc),
      -1,
    );

    const groups: Array<
      | { type: 'block'; block: ContentBlock; index: number }
      | { type: 'tool_group'; toolCalls: ChatToolCall[] }
    > = [];

    let pendingTools: ChatToolCall[] = [];

    const flushTools = () => {
      if (pendingTools.length === 0) return;
      groups.push({ type: 'tool_group', toolCalls: [...pendingTools] });
      pendingTools = [];
    };

    for (let i = 0; i < filteredBlocks.length; i++) {
      const block = filteredBlocks[i];
      if (block.type === 'tool_call' && isRepetitiveTool(block.toolCall.toolName)) {
        pendingTools.push(block.toolCall);
        continue;
      }
      flushTools();
      groups.push({ type: 'block', block, index: i });
    }
    flushTools();

    return groups.map((group, groupIndex) => {
      if (group.type === 'tool_group') {
        return <ToolExecutionWindow key={`tg-${groupIndex}`} toolCalls={group.toolCalls} />;
      }

      const { block, index } = group;
      if (block.type === 'text') {
        if (isUser) {
          return (
            <div key={index} className="whitespace-pre-wrap wrap-break-word leading-relaxed">
              {block.text}
              {isStreaming && index === lastTextIdx && (
                <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-current opacity-60" />
              )}
            </div>
          );
        }

        return (
          <div key={index} className="wrap-break-word">
            <FormattedText
              text={block.text}
              className="space-y-1.5 leading-relaxed"
              onFileClick={onFileClick}
              isStreaming={isStreaming && index === lastTextIdx}
              onActionPreview={onActionPreview}
              onActionReject={onActionReject}
              onActionRestore={onActionRestore}
            />
            {isStreaming && index === lastTextIdx && (
              <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-current opacity-60" />
            )}
          </div>
        );
      }

      if (block.type === 'thinking') {
        const isLastBlock = index === filteredBlocks.length - 1;
        return (
          <ThinkingFoldable
            key={index}
            text={block.text}
            label={t('chat.thinkingSection')}
            showPulse={!!isStreaming && isLastBlock}
          />
        );
      }

      return (
        <div key={`${block.toolCall.id}-${index}`} className="my-1.5">
          <ToolCallCard toolCall={block.toolCall} />
        </div>
      );
    });
  };

  const askUserBlocks = (blocks ?? message.contentBlocks ?? [])
    .filter(isAskUserQuestion) as Array<ContentBlock & { type: 'tool_call' }>;

  const renderImages = () => {
    if (!isUser || !message.images || message.images.length === 0) return null;
    return (
      <div className="mb-1.5 flex flex-wrap gap-1.5">
        {message.images.map((src, index) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={index}
            src={src}
            alt=""
            className="max-h-48 max-w-xs rounded border border-white/20 object-contain"
          />
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
              className="space-y-1.5 leading-relaxed"
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
            let pendingTools: ChatToolCall[] = [];

            const flush = () => {
              if (pendingTools.length === 0) return;
              result.push(
                <ToolExecutionWindow key={`lg-${result.length}`} toolCalls={[...pendingTools]} />,
              );
              pendingTools = [];
            };

            for (let i = 0; i < message.toolCalls.length; i++) {
              const toolCall = message.toolCalls[i];
              if (isRepetitiveTool(toolCall.toolName)) {
                pendingTools.push(toolCall);
                continue;
              }
              flush();
              result.push(<ToolCallCard key={`${toolCall.id}-${i}`} toolCall={toolCall} />);
            }
            flush();
            return result;
          })()}
        </div>
      )}
    </>
  );

  return (
    <div
      className={`group/bubble flex w-full items-start ${
        isUser ? 'flex-row justify-end gap-1.5' : 'flex-row gap-2'
      }`}
    >
      <div
        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full ${
          isUser
            ? 'bg-user-subtle text-user'
            : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'
        } ${isUser ? 'order-2' : 'order-1'}`}
      >
        {isUser ? (
          <User className="h-3.5 w-3.5" />
        ) : assistantAvatarSrc ? (
          <img src={assistantAvatarSrc} alt="" className="h-full w-full object-cover" />
        ) : (
          <Bot className="h-3.5 w-3.5" />
        )}
      </div>

      <div className={`max-w-[85%] ${isUser ? 'order-1 ml-auto' : 'order-2'}`}>
        <div
          className={`rounded-lg px-3 py-2 text-sm ${
            isUser
              ? 'bg-user text-white'
              : 'bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200'
          }`}
        >
          {isEditing && isUser ? (
            <div className="space-y-2">
              {renderImages()}
              <textarea
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    handleCancelEdit();
                    return;
                  }
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                    e.preventDefault();
                    void handleSaveEdit();
                  }
                }}
                rows={Math.max(3, editValue.split('\n').length)}
                className="w-full resize-y rounded-md border border-white/20 bg-black/10 px-3 py-2 text-sm leading-relaxed text-white outline-none placeholder:text-white/50 focus:border-white/40"
                placeholder={tActions('edit')}
              />
            </div>
          ) : blocks ? (
            <>
              {renderImages()}
              {renderBlocks(blocks)}
            </>
          ) : (
            renderLegacy()
          )}

          {message.interrupted && (
            <div className="mt-1.5 text-xs text-zinc-400 dark:text-zinc-500">
              {t('chat.interrupted')}
            </div>
          )}

          {planWriteContent && onViewPlan && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onViewPlan(planWriteContent);
              }}
              className="mt-2 flex h-[60px] w-[200px] items-center justify-center gap-2 rounded-lg border border-blue-200 bg-blue-50 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-400 dark:hover:bg-blue-900/40"
            >
              <ClipboardList className="h-5 w-5 shrink-0" />
              <span>{t('chat.viewPlan')}</span>
            </button>
          )}
        </div>

        {askUserBlocks.length > 0 && (
          <div className="mt-1.5">
            {askUserBlocks.map((block, index) => (
              <ToolCallCard key={`${block.toolCall.id}-${index}`} toolCall={block.toolCall} />
            ))}
          </div>
        )}

        {hasSendError && isUser && onRetry && showActions && (
          <div className={`mt-1 flex items-center gap-1.5 ${isUser ? 'justify-end' : 'justify-start'}`}>
            <span className="text-xs text-red-400 dark:text-red-500">{t('chat.sendFailed')}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (!isStreaming) onRetry();
              }}
              disabled={isStreaming}
              className="flex items-center gap-0.5 rounded px-2 py-1 text-xs text-red-500 transition-colors hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-950/30 dark:hover:text-red-300 disabled:pointer-events-none disabled:opacity-40"
            >
              <RefreshCw className="h-3 w-3" />
              <span>{t('chat.retry')}</span>
            </button>
          </div>
        )}

        {showActions && (
          <div
            className={`mt-0.5 flex items-center gap-1 transition-opacity ${
              isEditing ? 'opacity-100' : 'opacity-0 group-hover/bubble:opacity-100'
            } ${isUser ? 'justify-end' : 'justify-start'}`}
          >
            {isEditing ? (
              <>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleSaveEdit();
                  }}
                  disabled={isSavingEdit || (!editValue.trim() && (!message.images || message.images.length === 0))}
                  className="flex items-center gap-0.5 rounded px-2 py-1 text-xs text-zinc-300 transition-colors hover:bg-zinc-100 hover:text-zinc-500 dark:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-400 disabled:pointer-events-none disabled:opacity-40"
                  title={tActions('save')}
                >
                  <Check className="h-3 w-3" />
                  <span>{tActions('save')}</span>
                </button>
                <button
                  onClick={handleCancelEdit}
                  disabled={isSavingEdit}
                  className="flex items-center gap-0.5 rounded px-2 py-1 text-xs text-zinc-300 transition-colors hover:bg-zinc-100 hover:text-zinc-500 dark:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-400 disabled:pointer-events-none disabled:opacity-40"
                >
                  <span>{tActions('cancel')}</span>
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-0.5 rounded px-2 py-1 text-xs text-zinc-300 transition-colors hover:bg-zinc-100 hover:text-zinc-500 dark:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-400"
                  title={tActions('copy')}
                >
                  {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  <span>{copied ? t('chat.copied') : tActions('copy')}</span>
                </button>

                {!isUser && onSaveAsKnowledge && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onSaveAsKnowledge(message.id, editableText || message.content || '');
                    }}
                    className="flex items-center gap-0.5 rounded px-2 py-1 text-xs text-zinc-300 transition-colors hover:bg-zinc-100 hover:text-zinc-500 dark:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-400"
                    title={t('chat.saveAsKnowledge')}
                  >
                    <BookMarked className="h-3 w-3" />
                    <span>{t('chat.saveAsKnowledge')}</span>
                  </button>
                )}

                {onBranch && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onBranch(message.id);
                    }}
                    className="flex items-center gap-0.5 rounded px-2 py-1 text-xs text-zinc-300 transition-colors hover:bg-zinc-100 hover:text-zinc-500 dark:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-400"
                    title={t('chat.createBranchFrom')}
                  >
                    <GitBranch className="h-3 w-3" />
                    <span>{t('chat.branch')}</span>
                  </button>
                )}

                {onEdit && (
                  <button
                    onClick={handleStartEdit}
                    disabled={isStreaming}
                    className="flex items-center gap-0.5 rounded px-2 py-1 text-xs text-zinc-300 transition-colors hover:bg-zinc-100 hover:text-zinc-500 dark:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-400 disabled:pointer-events-none disabled:opacity-40"
                    title={tActions('edit')}
                  >
                    <Pencil className="h-3 w-3" />
                    <span>{tActions('edit')}</span>
                  </button>
                )}

                {!isUser && isLastAssistant && onRegenerate && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!isStreaming) onRegenerate();
                    }}
                    disabled={isStreaming}
                    className="flex items-center gap-0.5 rounded px-2 py-1 text-xs text-zinc-300 transition-colors hover:bg-zinc-100 hover:text-zinc-500 dark:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-400 disabled:pointer-events-none disabled:opacity-40"
                    title={t('chat.regenerate')}
                  >
                    <RefreshCw className="h-3 w-3" />
                    <span>{t('chat.regenerate')}</span>
                  </button>
                )}

                {onDelete && !confirmDelete && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!isStreaming) setConfirmDelete(true);
                    }}
                    disabled={isStreaming}
                    className="flex items-center gap-0.5 rounded px-2 py-1 text-xs text-zinc-300 transition-colors hover:bg-red-50 hover:text-red-500 dark:text-zinc-600 dark:hover:bg-red-950/30 dark:hover:text-red-400 disabled:pointer-events-none disabled:opacity-40"
                    title={tActions('delete')}
                  >
                    <Trash2 className="h-3 w-3" />
                    <span>{tActions('delete')}</span>
                  </button>
                )}

                {onDelete && confirmDelete && (
                  <>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(message.id);
                        setConfirmDelete(false);
                      }}
                      className="flex items-center gap-0.5 rounded px-2 py-1 text-xs text-red-500 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
                      title={t('chat.confirmDelete')}
                    >
                      <Trash2 className="h-3 w-3" />
                      <span>{t('chat.confirmDelete')}</span>
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmDelete(false);
                      }}
                      className="flex items-center gap-0.5 rounded px-2 py-1 text-xs text-zinc-300 transition-colors hover:bg-zinc-100 hover:text-zinc-500 dark:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-400"
                    >
                      <span>{tActions('cancel')}</span>
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
});
