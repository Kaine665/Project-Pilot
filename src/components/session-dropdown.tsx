'use client';

import { memo, useState, useRef, useEffect } from 'react';
import { ChevronDown, Plus, MessageSquare } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { SessionListItem } from '@/components/agent-chat-panel';

interface SessionDropdownProps {
  sessionTitle: string;
  sessions: SessionListItem[];
  currentSessionId: string | null;
  isStreaming: boolean;
  onSwitch: (session: SessionListItem) => void;
  onNew: () => void;
}

export const SessionDropdown = memo(function SessionDropdown({
  sessionTitle,
  sessions,
  currentSessionId,
  isStreaming,
  onSwitch,
  onNew,
}: SessionDropdownProps) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className="relative flex items-center gap-1.5 min-w-0 flex-1" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1 min-w-0 text-xs font-medium text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors"
      >
        <span className="truncate">{sessionTitle}</span>
        <ChevronDown className={`h-3 w-3 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 w-64 rounded-md border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          <div className="flex items-center justify-between border-b border-zinc-100 px-2.5 py-1.5 dark:border-zinc-800">
            <span className="text-xs font-medium text-zinc-400">{t('chat.conversations')}</span>
            <button
              onClick={() => { onNew(); setOpen(false); }}
              disabled={isStreaming}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-blue-600 hover:bg-zinc-100 dark:text-blue-400 dark:hover:bg-zinc-800"
            >
              <Plus className="h-3 w-3" />
              {t('chat.newSession')}
            </button>
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {sessions.map(s => (
              <button
                key={s.id}
                onClick={() => { onSwitch(s); setOpen(false); }}
                className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-xs transition-colors ${
                  s.id === currentSessionId
                    ? 'bg-blue-50 font-medium text-zinc-900 dark:bg-blue-950/40 dark:text-zinc-100'
                    : 'text-zinc-600 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-800'
                }`}
              >
                <MessageSquare className={`h-3 w-3 shrink-0 ${s.id === currentSessionId ? 'text-blue-500 dark:text-blue-400' : ''}`} />
                <span className="truncate flex-1 text-left">{s.title}</span>
                {s.id !== currentSessionId && !!s.unreadCount && s.unreadCount > 0 && (
                  <span className="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-red-500 px-0.5 text-[10px] font-medium leading-none text-white">
                    {s.unreadCount > 99 ? '99+' : s.unreadCount}
                  </span>
                )}
              </button>
            ))}
            {sessions.length === 0 && (
              <div className="px-2.5 py-2 text-center text-xs text-zinc-400">
                {t('chat.noConversations')}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
});
