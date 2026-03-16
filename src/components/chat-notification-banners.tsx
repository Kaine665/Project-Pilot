'use client';

import { memo } from 'react';
import { BookMarked, CheckCircle2, FileText, X } from 'lucide-react';

export interface TopicCompletionInfo {
  completed: boolean;
  confidence: number;
  summary: string;
}

interface ChatNotificationBannersProps {
  knowledgeDrafts: Array<{ entryId: string; label: string }>;
  docsSaved: Array<{ docId: string; title: string; projectKey: string }>;
  topicCompletion: TopicCompletionInfo | null;
  onDismissKnowledge: () => void;
  onDismissDocs: () => void;
  onDismissTopicCompletion: () => void;
  /** Extra class for margin adjustments */
  className?: string;
}

export const ChatNotificationBanners = memo(function ChatNotificationBanners({
  knowledgeDrafts,
  docsSaved,
  topicCompletion,
  onDismissKnowledge,
  onDismissDocs,
  onDismissTopicCompletion,
  className = 'mx-3 mb-2',
}: ChatNotificationBannersProps) {
  if (knowledgeDrafts.length === 0 && docsSaved.length === 0 && !topicCompletion) return null;

  return (
    <>
      {topicCompletion && (
        <div className={`${className} flex items-center justify-between gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-xs dark:border-green-800/50 dark:bg-green-900/15`}>
          <div className="flex items-center gap-1.5 text-green-700 dark:text-green-400">
            <CheckCircle2 className="h-3 w-3 shrink-0" />
            <span>主题已完成 — {topicCompletion.summary}</span>
          </div>
          <button
            onClick={onDismissTopicCompletion}
            className="shrink-0 text-green-400 hover:text-green-600 dark:text-green-600 dark:hover:text-green-400"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}
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
