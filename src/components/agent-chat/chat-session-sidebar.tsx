'use client';

import { Plus, MessageSquare } from 'lucide-react';
import { useTranslations } from '@/client/i18n/use-translations';
import type { SessionListItem } from './types';
import { formatSessionElapsed } from './types';

export interface ChatSessionSidebarProps {
  sessionList: SessionListItem[];
  currentSessionId: string | null;
  sessionClockNow: number;
  isStreaming: boolean;
  onSwitchSession: (session: SessionListItem) => void;
  onNewSession: () => void;
}

export function ChatSessionSidebar({
  sessionList,
  currentSessionId,
  sessionClockNow,
  isStreaming,
  onSwitchSession,
  onNewSession,
}: ChatSessionSidebarProps) {
  const t = useTranslations();

  return (
    <div className="flex w-64 shrink-0 flex-col border-r border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-center justify-between border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
        <span className="text-sm font-medium text-zinc-500">{t('chat.conversations')}</span>
        <button
          onClick={onNewSession}
          disabled={isStreaming}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-blue-600 hover:bg-zinc-200 dark:text-blue-400 dark:hover:bg-zinc-800"
        >
          <Plus className="h-3 w-3" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {sessionList.map(s => (
          <button
            key={s.id}
            onClick={() => onSwitchSession(s)}
            className={`flex w-full items-center gap-2 px-3 py-2.5 text-sm transition-colors border-l-2 ${
              s.id === currentSessionId
                ? 'border-l-blue-500 bg-blue-50 font-medium text-zinc-900 dark:border-l-blue-400 dark:bg-blue-950/40 dark:text-zinc-100'
                : 'border-l-transparent text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900'
            }`}
          >
            <MessageSquare className={`h-3.5 w-3.5 shrink-0 ${s.id === currentSessionId ? 'text-blue-500 dark:text-blue-400' : ''}`} />
            <span className="truncate flex-1 text-left">{s.title}</span>
            {s.isRunning ? (
              <span className="shrink-0 rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium leading-none text-blue-700 dark:bg-blue-950/70 dark:text-blue-300">
                {formatSessionElapsed(s.runningStartedAt, sessionClockNow)}
              </span>
            ) : s.isAwaiting ? (
              <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium leading-none text-amber-700 dark:bg-amber-950/70 dark:text-amber-300">
                ⏳
              </span>
            ) : !!s.unreadCount && s.unreadCount > 0 && (
              <span className="flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-medium leading-none text-white">
                {s.unreadCount > 99 ? '99+' : s.unreadCount}
              </span>
            )}
          </button>
        ))}
        {sessionList.length === 0 && (
          <div className="px-3 py-4 text-center text-xs text-zinc-400">
            {t('chat.noConversations')}
          </div>
        )}
      </div>
    </div>
  );
}
