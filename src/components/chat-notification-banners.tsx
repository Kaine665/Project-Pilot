'use client';

import { memo } from 'react';
import { BookMarked, CheckCircle2, ExternalLink, FileText, RotateCcw, X } from 'lucide-react';

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
  /** 点击知识草稿横幅，跳转到知识管理页 */
  onNavigateToKnowledge?: () => void;
  /** 点击文档保存横幅，跳转到设计文档页 */
  onNavigateToDoc?: (projectKey: string) => void;
  /** 会话检查点已生成，显示续接按钮 */
  checkpointSaved?: boolean;
  onResumeCheckpoint?: () => void;
  onDismissCheckpoint?: () => void;
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
  onNavigateToKnowledge,
  onNavigateToDoc,
  checkpointSaved,
  onResumeCheckpoint,
  onDismissCheckpoint,
  className = 'mx-3 mb-2',
}: ChatNotificationBannersProps) {
  if (knowledgeDrafts.length === 0 && docsSaved.length === 0 && !topicCompletion && !checkpointSaved) return null;

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
      {checkpointSaved && (
        <div className={`${className} flex items-center justify-between gap-2 rounded-md border border-violet-200 bg-violet-50 px-3 py-2 text-xs dark:border-violet-800/50 dark:bg-violet-900/15`}>
          <div className="flex items-center gap-1.5 text-violet-700 dark:text-violet-400">
            <RotateCcw className="h-3 w-3 shrink-0" />
            <span>Agent 已生成工作检查点，可在新会话中续接</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onResumeCheckpoint}
              className="rounded px-2 py-0.5 text-xs font-medium text-violet-700 ring-1 ring-violet-300 hover:bg-violet-100 dark:text-violet-400 dark:ring-violet-700 dark:hover:bg-violet-900/40"
            >
              续接
            </button>
            <button
              onClick={onDismissCheckpoint}
              className="shrink-0 text-violet-400 hover:text-violet-600 dark:text-violet-600 dark:hover:text-violet-400"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}
      {knowledgeDrafts.length > 0 && (
        <div className={`${className} flex items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs dark:border-amber-800/50 dark:bg-amber-900/15`}>
          <button
            onClick={onNavigateToKnowledge}
            disabled={!onNavigateToKnowledge}
            className={`flex min-w-0 items-center gap-1.5 text-amber-700 dark:text-amber-400 ${onNavigateToKnowledge ? 'cursor-pointer hover:underline' : ''}`}
          >
            <BookMarked className="h-3 w-3 shrink-0" />
            <span className="truncate">Agent 已保存 {knowledgeDrafts.length} 条知识草稿，待确认</span>
            {onNavigateToKnowledge && <ExternalLink className="h-3 w-3 shrink-0 opacity-50" />}
          </button>
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
          <button
            onClick={() => {
              if (!onNavigateToDoc || docsSaved.length === 0) return;
              // 用第一条文档的 projectKey 导航
              onNavigateToDoc(docsSaved[0].projectKey);
            }}
            disabled={!onNavigateToDoc}
            className={`flex min-w-0 items-center gap-1.5 text-blue-700 dark:text-blue-400 ${onNavigateToDoc ? 'cursor-pointer hover:underline' : ''}`}
          >
            <FileText className="h-3 w-3 shrink-0" />
            <span className="truncate">Agent 已保存 {docsSaved.length} 条设计文档</span>
            {onNavigateToDoc && <ExternalLink className="h-3 w-3 shrink-0 opacity-50" />}
          </button>
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
