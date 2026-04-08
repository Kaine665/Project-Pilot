'use client';

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  BookMarked,
  Bot,
  Check,
  ClipboardList,
  Copy,
  GitBranch,
  Pencil,
  Play,
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
import { cn } from '@/lib/utils';
import type { ChatMessage, ChatToolCall, ContentBlock } from '@/types';

/** 旧版「已手动开启 Run：…」助手提示，解析后改卡片展示 */
function parseLegacyAssistantRunNotice(content: string): { body: string } | null {
  const t = content.replace(/\u200b/g, '').trim();
  if (t === '已手动开启 Run。') return { body: '' };
  const m = t.match(/^已手动开启 Run[：:]\s*([\s\S]*)$/);
  if (!m) return null;
  return { body: m[1].trim() };
}

const ThinkingFoldable = memo(function ThinkingFoldable({
  text,
  label,
  showPulse,
}: {
  text: string;
  label: string;
  /** 思考块仍在流式输出（当前助手气泡最后一块 thinking） */
  showPulse: boolean;
}) {
  /** 流式结束后用户手动展开；流式中由 showPulse 强制展开 */
  const [settledOpen, setSettledOpen] = useState(false);
  const prevPulseRef = useRef(showPulse);

  useEffect(() => {
    if (prevPulseRef.current && !showPulse) {
      setSettledOpen(false);
    }
    prevPulseRef.current = showPulse;
  }, [showPulse]);

  const open = showPulse || settledOpen;

  return (
    <details
      className="my-2 rounded-lg border border-violet-200/80 bg-violet-50/50 text-sm dark:border-violet-900/50 dark:bg-violet-950/25"
      open={open}
      onToggle={(e) => {
        const el = e.target as HTMLDetailsElement;
        if (showPulse) {
          if (!el.open) el.open = true;
          return;
        }
        setSettledOpen(el.open);
      }}
    >
      <summary className="cursor-pointer select-none px-3 py-1.5 text-violet-800 dark:text-violet-200">
        {label}
      </summary>
      <div
        className={cn(
          'whitespace-pre-wrap border-t border-violet-100 px-3 py-2 font-mono text-xs leading-relaxed text-zinc-600 wrap-break-word dark:border-violet-900/40 dark:text-zinc-400 [overflow-anchor:none]',
          showPulse && 'max-h-[10lh] overflow-y-auto overflow-x-hidden overscroll-contain',
        )}
      >
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
  const isRunTaskUser = isUser && message.meta?.type === 'run_task';
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
            <div
              className={`whitespace-pre-wrap leading-relaxed ${
                isRunTaskUser ? 'text-emerald-950 dark:text-emerald-50' : ''
              }`}
            >
              {message.content}
            </div>
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

  const legacyRunParsed = !isUser ? parseLegacyAssistantRunNotice(message.content) : null;

  if (!isUser && message.meta?.type === 'run_open') {
    const rid = message.meta.executionRunId;
    return (
      <div className="flex w-full justify-center py-1.5" data-chat-message-id={message.id}>
        <div className="w-full max-w-[min(560px,92%)] rounded-xl border border-emerald-200/90 bg-emerald-50/85 px-3 py-2.5 text-xs text-emerald-950 shadow-sm dark:border-emerald-800/55 dark:bg-emerald-950/35 dark:text-emerald-50">
          <div className="flex items-center gap-2 font-semibold text-emerald-900 dark:text-emerald-100">
            <Play className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <span>已开启 Run（记录区间）</span>
          </div>
          <p className="mt-1.5 pl-5 text-[11px] leading-relaxed text-emerald-800/88 dark:text-emerald-200/85">
            尚未附带具体任务；你接下来在本会话发送的内容仍在这段对话里。绑定 Run：
            <code className="ml-1 rounded bg-emerald-100/90 px-1 py-0.5 font-mono text-[10px] dark:bg-emerald-900/55">
              {rid.length > 18 ? `${rid.slice(0, 18)}…` : rid}
            </code>
          </p>
        </div>
      </div>
    );
  }

  if (legacyRunParsed) {
    return (
      <div className="flex w-full justify-center py-1.5" data-chat-message-id={message.id}>
        <div className="w-full max-w-[min(560px,92%)] rounded-xl border border-amber-200/80 bg-amber-50/80 px-3 py-2.5 text-xs text-amber-950 dark:border-amber-900/45 dark:bg-amber-950/30 dark:text-amber-50">
          <div className="font-semibold text-amber-900 dark:text-amber-100">旧版 /run 提示（仅展示）</div>
          <p className="mt-1 text-[11px] leading-relaxed text-amber-900/85 dark:text-amber-200/80">
            当时为助手气泡；新版已改为「单条用户消息 + Run 卡片」。若下方紧跟你自己的任务正文，二者本属同一次操作。
          </p>
          {legacyRunParsed.body ? (
            <div className="mt-2 whitespace-pre-wrap rounded-md border border-amber-200/60 bg-white/70 px-2 py-1.5 text-[13px] leading-relaxed text-amber-950 dark:border-amber-900/40 dark:bg-zinc-900/40 dark:text-amber-50">
              {legacyRunParsed.body}
            </div>
          ) : (
            <p className="mt-2 text-[11px] text-amber-800/80 dark:text-amber-300/75">未附带任务摘要。</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`group/bubble flex w-full items-start ${
        isUser ? 'flex-row justify-end gap-1.5' : 'flex-row gap-2'
      }`}
    >
      <div
        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full ${
          isUser
            ? isRunTaskUser
              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/55 dark:text-emerald-300'
              : 'bg-user-subtle text-user'
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
            isRunTaskUser
              ? 'border border-emerald-400/40 bg-gradient-to-b from-emerald-50/95 to-white text-emerald-950 dark:border-emerald-700/45 dark:from-emerald-950/55 dark:to-zinc-900 dark:text-emerald-50'
              : isUser
                ? 'bg-user text-white'
                : 'bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200'
          }`}
        >
          {isRunTaskUser && message.meta?.type === 'run_task' && (
            <div className="mb-2 space-y-1 border-b border-emerald-200/75 pb-2 text-left dark:border-emerald-800/50">
              <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold text-emerald-900 dark:text-emerald-100">
                <Play className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                <span>/run 本轮任务</span>
                <code className="rounded bg-emerald-100/90 px-1 py-0.5 font-mono text-[10px] font-normal text-emerald-800 dark:bg-emerald-900/55 dark:text-emerald-200">
                  {message.meta.executionRunId.length > 20
                    ? `${message.meta.executionRunId.slice(0, 20)}…`
                    : message.meta.executionRunId}
                </code>
              </div>
              <p className="text-[11px] leading-snug text-emerald-800/80 dark:text-emerald-300/85">
                此正文即发给模型的用户消息；紧随其后的 AI 回复与工具调用，同属这一轮 Run 的执行记录。
              </p>
            </div>
          )}
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

                {onBranch && !isUser && (
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

                {onEdit && isUser && (
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
