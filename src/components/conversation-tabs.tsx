'use client';

import { useState, useRef, useEffect } from 'react';
import { Plus, MessageSquare, X, Trash2, RotateCcw, Trash, GitBranch } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import type { ConversationMeta } from '@/types';

interface ConversationTabsProps {
  conversations: ConversationMeta[];
  activeId?: string;
  onSelect: (conversationId: string) => void;
  onNew: () => void;
  onArchive: (conversationId: string) => void;
  onRestore: (conversationId: string) => void;
  onPermanentDelete: (conversationId: string) => void;
  onRename: (conversationId: string, newTitle: string) => void;
  disabled?: boolean;
}

/** 将对话列表排序：分支紧跟在父对话后面（树形扁平化） */
function sortWithBranches(conversations: ConversationMeta[]): ConversationMeta[] {
  const childrenMap = new Map<string, ConversationMeta[]>();
  const roots: ConversationMeta[] = [];

  for (const conv of conversations) {
    if (conv.parentConversationId) {
      const siblings = childrenMap.get(conv.parentConversationId) || [];
      siblings.push(conv);
      childrenMap.set(conv.parentConversationId, siblings);
    } else {
      roots.push(conv);
    }
  }

  const result: ConversationMeta[] = [];
  function addWithChildren(conv: ConversationMeta) {
    result.push(conv);
    const children = childrenMap.get(conv.conversationId) || [];
    for (const child of children) {
      addWithChildren(child);
    }
  }
  for (const root of roots) {
    addWithChildren(root);
  }

  // 添加孤儿节点（父对话已被删除的分支）
  for (const conv of conversations) {
    if (!result.includes(conv)) result.push(conv);
  }

  return result;
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) {
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

export function ConversationTabs({
  conversations,
  activeId,
  onSelect,
  onNew,
  onArchive,
  onRestore,
  onPermanentDelete,
  onRename,
  disabled,
}: ConversationTabsProps) {
  const t = useTranslations();
  const [showTrash, setShowTrash] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const editInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  const commitRename = (convId: string) => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== conversations.find((c) => c.conversationId === convId)?.title) {
      onRename(convId, trimmed);
    }
    setEditingId(null);
  };

  const activeConvs = sortWithBranches(conversations.filter((c) => !c.archived));
  const archivedConvs = conversations.filter((c) => c.archived);

  if (activeConvs.length <= 1 && archivedConvs.length === 0 && !activeConvs.some((c) => c.messageCount > 0)) {
    return null;
  }

  return (
    <div className="border-b border-zinc-100 dark:border-zinc-800">
      {/* Active tabs row */}
      <div className="flex items-center gap-0.5 bg-zinc-50/50 px-2 py-1 dark:bg-zinc-900/50">
        <MessageSquare className="mr-1 h-3 w-3 shrink-0 text-zinc-400" />
        <div className="flex flex-1 items-center gap-0.5 overflow-x-auto scrollbar-none">
          {activeConvs.map((conv, i) => {
            const isActive = conv.conversationId === activeId;
            return (
              <div
                key={conv.conversationId}
                className={cn(
                  'group flex shrink-0 items-center gap-0.5 rounded px-2 py-0.5 text-[11px] transition-colors',
                  isActive
                    ? 'bg-white font-medium text-zinc-700 shadow-sm dark:bg-zinc-800 dark:text-zinc-200'
                    : 'text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300',
                  disabled && 'opacity-50',
                )}
              >
                {editingId === conv.conversationId ? (
                  <input
                    ref={editInputRef}
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onBlur={() => commitRename(conv.conversationId)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename(conv.conversationId);
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                    className="w-[100px] rounded border border-blue-400 bg-white px-1 py-0 text-[11px] text-zinc-700 outline-none dark:bg-zinc-800 dark:text-zinc-200"
                  />
                ) : (
                  <button
                    onClick={() => onSelect(conv.conversationId)}
                    onDoubleClick={() => {
                      setEditingId(conv.conversationId);
                      setEditValue(conv.title || t('chat.conversationNumber', { number: i + 1 }));
                    }}
                    disabled={disabled}
                    className="flex items-center gap-1"
                    title={conv.parentConversationId
                      ? `${conv.title}（${t('chat.branch')} @ #${(conv.branchFromMessageIndex ?? 0) + 1}，${t('chat.doubleClickToRename')}）`
                      : `${conv.title}（${t('chat.doubleClickToRename')}）`}
                  >
                    {conv.parentConversationId && (
                      <GitBranch className="h-2.5 w-2.5 shrink-0 text-zinc-300 dark:text-zinc-600" />
                    )}
                    <span className="max-w-[100px] truncate">
                      {conv.title || t('chat.conversationNumber', { number: i + 1 })}
                    </span>
                    <span className="text-[10px] text-zinc-300 dark:text-zinc-600">
                      {formatTime(conv.updatedAt)}
                    </span>
                  </button>
                )}
                {/* Delete button — visible on hover, only when more than 1 active */}
                {activeConvs.length > 1 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onArchive(conv.conversationId);
                    }}
                    disabled={disabled}
                    className="ml-0.5 hidden rounded p-0.5 text-zinc-300 transition-colors hover:bg-zinc-200 hover:text-zinc-500 group-hover:block dark:text-zinc-600 dark:hover:bg-zinc-700 dark:hover:text-zinc-400"
                    title={t('chat.deleteConversation')}
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <div className="ml-1 flex shrink-0 items-center gap-0.5">
          {/* Trash toggle */}
          {archivedConvs.length > 0 && (
            <button
              onClick={() => setShowTrash(!showTrash)}
              className={cn(
                'flex items-center rounded p-0.5 transition-colors',
                showTrash
                  ? 'bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300'
                  : 'text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300',
              )}
              title={t('chat.trashCount', { count: archivedConvs.length })}
            >
              <Trash2 className="h-3 w-3" />
              <span className="ml-0.5 text-[10px]">{archivedConvs.length}</span>
            </button>
          )}
          {/* New conversation */}
          <button
            onClick={onNew}
            disabled={disabled}
            className={cn(
              'flex items-center rounded p-0.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300',
              disabled && 'opacity-50',
            )}
            title={t('chat.newConversation')}
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Trash panel */}
      {showTrash && archivedConvs.length > 0 && (
        <div className="border-t border-zinc-100 bg-zinc-100/50 px-2 py-1.5 dark:border-zinc-800 dark:bg-zinc-900/80">
          <div className="mb-1 flex items-center gap-1 text-[10px] font-medium text-zinc-400">
            <Trash2 className="h-2.5 w-2.5" />
            {t('chat.trash')}
          </div>
          <div className="flex flex-col gap-0.5">
            {archivedConvs.map((conv) => (
              <div
                key={conv.conversationId}
                className="flex items-center justify-between rounded px-1.5 py-0.5 text-[11px] text-zinc-400"
              >
                <span className="max-w-[140px] truncate" title={conv.title}>
                  {conv.title}
                </span>
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-zinc-300 dark:text-zinc-600">
                    {formatTime(conv.archivedAt ?? conv.updatedAt)}
                  </span>
                  <button
                    onClick={() => onRestore(conv.conversationId)}
                    className="rounded p-0.5 text-zinc-400 transition-colors hover:bg-zinc-200 hover:text-blue-500 dark:hover:bg-zinc-700 dark:hover:text-blue-400"
                    title={t('actions.restore')}
                  >
                    <RotateCcw className="h-2.5 w-2.5" />
                  </button>
                  <button
                    onClick={() => onPermanentDelete(conv.conversationId)}
                    className="rounded p-0.5 text-zinc-400 transition-colors hover:bg-zinc-200 hover:text-red-500 dark:hover:bg-zinc-700 dark:hover:text-red-400"
                    title={t('actions.permanentDelete')}
                  >
                    <Trash className="h-2.5 w-2.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
