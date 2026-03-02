'use client';

import { memo } from 'react';
import { BookMarked, FileText, X } from 'lucide-react';

interface ChatNotificationBannersProps {
  knowledgeDrafts: Array<{ entryId: string; label: string }>;
  docsSaved: Array<{ docId: string; title: string; projectKey: string }>;
  onDismissKnowledge: () => void;
  onDismissDocs: () => void;
  /** Extra class for margin adjustments */
  className?: string;
}

export const ChatNotificationBanners = memo(function ChatNotificationBanners({
  knowledgeDrafts,
  docsSaved,
  onDismissKnowledge,
  onDismissDocs,
  className = 'mx-3 mb-2',
}: ChatNotificationBannersProps) {
  if (knowledgeDrafts.length === 0 && docsSaved.length === 0) return null;

  return (
    <>
      {knowledgeDrafts.length > 0 && (
        <div className={`${className} flex items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs dark:border-amber-800/50 dark:bg-amber-900/15`}>
          <div className="flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
            <BookMarked className="h-3 w-3 shrink-0" />
            <span>Agent 已保存 {knowledgeDrafts.length} 条知识草稿，待确认</span>
          </div>
          <button
            onClick={onDismissKnowledge}
            className="shrink-0 text-amber-400 hover:text-amber-600 dark:text-amber-600 dark:hover:text-amber-400"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}
      {docsSaved.length > 0 && (
        <div className={`${className} flex items-center justify-between gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs dark:border-blue-800/50 dark:bg-blue-900/15`}>
          <div className="flex items-center gap-1.5 text-blue-700 dark:text-blue-400">
            <FileText className="h-3 w-3 shrink-0" />
            <span>Agent 已保存 {docsSaved.length} 条设计文档</span>
          </div>
          <button
            onClick={onDismissDocs}
            className="shrink-0 text-blue-400 hover:text-blue-600 dark:text-blue-600 dark:hover:text-blue-400"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}
    </>
  );
});
