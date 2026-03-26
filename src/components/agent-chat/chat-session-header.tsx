'use client';

import { Dispatch } from 'react';
import { Sparkles, ArrowLeft, Trash2, FileDown, Settings, Maximize2, Minimize2, GitFork, PanelRight } from 'lucide-react';
import { useRouter } from '@/client/i18n/routing';
import { Button } from '@/components/ui/button';
import { SessionDropdown } from '@/components/session-dropdown';
import { buildSessionUrl } from '@/components/agent-session-utils';
import type { SessionNavLink } from '@/components/agent-session-utils';
import type { SessionConfig } from '@/types/agent-chat';
import type { SessionListItem } from './types';
import type { SessionAction } from './session-reducer';

export interface ChatSessionHeaderProps {
  isFull: boolean;
  sessionId: string | null;
  sessionTitle: string;
  sessionList: SessionListItem[];
  sessionClockNow: number;
  sessionConfig: SessionConfig;
  isStreaming: boolean;
  showConfig: boolean;
  parentSession: SessionNavLink | null;
  childSessions: SessionNavLink[];
  showChildList: boolean;
  messages: { length: number };
  sessionDispatch: Dispatch<SessionAction>;
  onSwitchSession: (session: SessionListItem) => void;
  onNewSession: () => void;
  onDelete: () => void;
  onToggleConfig: () => void;
  onCompressOpen: () => void;
  showRuntimePanel?: boolean;
  onToggleRuntimePanel?: () => void;
}

export function ChatSessionHeader({
  isFull,
  sessionId,
  sessionTitle,
  sessionList,
  sessionClockNow,
  sessionConfig,
  isStreaming,
  showConfig,
  parentSession,
  childSessions,
  showChildList,
  messages,
  sessionDispatch,
  onSwitchSession,
  onNewSession,
  onDelete,
  onToggleConfig,
  onCompressOpen,
  showRuntimePanel,
  onToggleRuntimePanel,
}: ChatSessionHeaderProps) {
  const router = useRouter();

  return (
    <div className="flex items-center justify-between border-b border-zinc-100 px-3 py-1.5 dark:border-zinc-800">
      <div className="flex items-center gap-1.5 min-w-0 flex-1">
        {/* Parent session back button */}
        {parentSession && (
          <button
            onClick={() => router.push(buildSessionUrl(parentSession.agentId, parentSession.id))}
            className="flex items-center gap-0.5 shrink-0 text-xs text-blue-500 hover:text-blue-700 dark:hover:text-blue-300 mr-1"
            title={`Back to parent session: ${parentSession.title}`}
          >
            <ArrowLeft className="h-3 w-3" />
          </button>
        )}
        <Sparkles className="h-3.5 w-3.5 shrink-0 text-blue-500" />
        {isFull ? (
          <span className="text-xs font-medium text-zinc-500 truncate">{sessionTitle}</span>
        ) : (
          <SessionDropdown
            sessionTitle={sessionTitle}
            sessions={sessionList}
            clockNow={sessionClockNow}
            currentSessionId={sessionId}
            isStreaming={isStreaming}
            onSwitch={onSwitchSession}
            onNew={onNewSession}
          />
        )}
        {/* Child sessions indicator */}
        {childSessions.length > 0 && (
          <div className="relative shrink-0 ml-1" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) sessionDispatch({ type: 'CLOSE_CHILD_LIST' }); }}>
            <button
              onClick={() => sessionDispatch({ type: 'TOGGLE_CHILD_LIST' })}
              className="flex items-center gap-0.5 text-xs text-violet-500 hover:text-violet-700 dark:hover:text-violet-300"
              title={`${childSessions.length} 个子会话`}
            >
              <GitFork className="h-3 w-3" />
              <span>{childSessions.length}</span>
            </button>
            {showChildList && (
              <div className="absolute left-0 top-full mt-1 z-50 min-w-[200px] max-w-[300px] rounded-md border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-800">
                <div className="px-2 py-1.5 text-[10px] font-medium text-zinc-400 border-b border-zinc-100 dark:border-zinc-700">Child Sessions</div>
                {childSessions.map(cs => (
                  <button
                    key={cs.id}
                    onClick={() => {
                      sessionDispatch({ type: 'CLOSE_CHILD_LIST' });
                      router.push(buildSessionUrl(cs.agentId, cs.id));
                    }}
                    className="block w-full text-left px-2 py-1.5 text-xs text-zinc-600 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-700 truncate"
                  >
                    {cs.title || 'Untitled Session'}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      <div className="flex items-center gap-0.5 shrink-0">
        {/* Compress history */}
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-1.5 text-xs text-zinc-400 hover:text-blue-500 dark:hover:text-blue-400 disabled:opacity-30"
          onClick={onCompressOpen}
          disabled={isStreaming || messages.length < 6}
          title="压缩会话历史"
        >
          <FileDown className="h-3 w-3" />
        </Button>
        {/* Session config toggle */}
        <Button
          size="sm"
          variant="ghost"
          className={`h-6 px-1.5 text-xs transition-colors ${
            showConfig
              ? 'text-blue-500 dark:text-blue-400'
              : (sessionConfig.contextIds?.length || sessionConfig.supplementaryPrompt?.trim())
                ? 'text-blue-400 dark:text-blue-500'
                : 'text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300'
          }`}
          onClick={onToggleConfig}
          title="会话配置"
        >
          <Settings className="h-3 w-3" />
        </Button>
        {/* Runtime panel toggle */}
        {onToggleRuntimePanel && (
          <Button
            size="sm"
            variant="ghost"
            className={`h-6 px-1.5 text-xs transition-colors ${
              showRuntimePanel
                ? 'text-blue-500 dark:text-blue-400'
                : 'text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300'
            }`}
            onClick={onToggleRuntimePanel}
            title="运行时面板"
          >
            <PanelRight className="h-3 w-3" />
          </Button>
        )}
        {!isFull && sessionId && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-1.5 text-xs text-zinc-400 hover:text-red-500 dark:hover:text-red-400"
            onClick={onDelete}
            disabled={isStreaming}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        )}
        {isFull ? (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-1.5 text-xs text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"
            onClick={() => router.push('/flows')}
          >
            <Minimize2 className="h-3 w-3" />
          </Button>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-1.5 text-xs text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"
            onClick={() => router.push('/flows/butler')}
          >
            <Maximize2 className="h-3 w-3" />
          </Button>
        )}
      </div>
    </div>
  );
}
