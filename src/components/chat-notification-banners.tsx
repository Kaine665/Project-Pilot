'use client';

import { memo } from 'react';
import { AlertTriangle, ArrowDown, FileText, RotateCcw, X } from 'lucide-react';

interface ChatNotificationBannersProps {
  docsSaved: Array<{ docId: string; title: string; projectKey: string }>;
  onDismissDocs: () => void;
  /** 点击横幅时滚动到对应 ActionCard 的位置 */
  onScrollToAction?: (actionType: string) => void;
  /** 会话检查点已生成，显示续接按钮 */
  checkpointSaved?: boolean;
  onResumeCheckpoint?: () => void;
  onDismissCheckpoint?: () => void;
  /**
   * 当前模型渠道为纯 Messages API，无本地 Read/Bash 等工具
   */
  textOnlyAgentChannel?: boolean;
  /** 流式输出中：隐藏文档/检查点类横幅，但仍可显示 textOnlyAgentChannel */
  streaming?: boolean;
  /** Extra class for margin adjustments */
  className?: string;
}

export const ChatNotificationBanners = memo(function ChatNotificationBanners({
  docsSaved,
  onDismissDocs,
  onScrollToAction,
  checkpointSaved,
  onResumeCheckpoint,
  onDismissCheckpoint,
  textOnlyAgentChannel,
  streaming,
  className = 'mx-3 mb-2',
}: ChatNotificationBannersProps) {
  const showAuxiliary = !streaming;
  const hasAuxiliary = showAuxiliary && (docsSaved.length > 0 || !!checkpointSaved);
  if (!textOnlyAgentChannel && !hasAuxiliary) return null;

  return (
    <>
      {textOnlyAgentChannel && (
        <div
          className={`${className} flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/25 dark:text-amber-100/90`}
          role="status"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
          <span>
            当前渠道为纯文本 API，<strong>无法</strong>执行本地 Read/Bash 等工具。需要读盘或跑命令时请改用内置{' '}
            <strong>Anthropic</strong> 或 <strong>OpenAI（Codex）</strong>，或自行在终端执行后粘贴输出。
          </span>
        </div>
      )}
      {showAuxiliary && checkpointSaved && (
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
      {showAuxiliary && docsSaved.length > 0 && (
        <div className={`${className} flex items-center justify-between gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs dark:border-blue-800/50 dark:bg-blue-900/15`}>
          <button
            onClick={() => onScrollToAction?.('docs-saved')}
            disabled={!onScrollToAction}
            className={`flex min-w-0 items-center gap-1.5 text-blue-700 dark:text-blue-400 ${onScrollToAction ? 'cursor-pointer hover:underline' : ''}`}
          >
            <FileText className="h-3 w-3 shrink-0" />
            <span className="truncate">Agent 已保存 {docsSaved.length} 条设计文档</span>
            {onScrollToAction && <ArrowDown className="h-3 w-3 shrink-0 opacity-50" />}
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
