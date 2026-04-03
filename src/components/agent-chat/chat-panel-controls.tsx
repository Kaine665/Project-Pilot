'use client';

import { PanelRight, Settings } from 'lucide-react';
import type { SessionConfig } from '@/types/agent-chat';
import type { SessionAction } from './session-reducer';
import type { SessionListItem } from './types';
import type { SessionNavLink } from '@/components/agent-session-utils';
import type { Dispatch } from 'react';
import { ChatSessionHeader } from './chat-session-header';

export interface PlainToolbarControlsProps {
  workspaceMode: boolean;
  hasActiveRun: boolean;
  showConfig: boolean;
  showRuntimePanel: boolean;
  onToggleConfig: () => void;
  onToggleRuntimePanel: () => void;
}

export function PlainToolbarControls({
  workspaceMode,
  hasActiveRun,
  showConfig,
  showRuntimePanel,
  onToggleConfig,
  onToggleRuntimePanel,
}: PlainToolbarControlsProps) {
  if (workspaceMode) return null;
  return (
    <div className="flex items-center justify-end gap-0.5 border-b border-zinc-100 px-3 py-1.5 dark:border-zinc-800">
      {hasActiveRun && (
        <span className="mr-1 rounded border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
          RUN 进行中
        </span>
      )}
      <button
        type="button"
        onClick={onToggleConfig}
        className={`p-1 rounded transition-colors ${
          showConfig
            ? 'text-blue-500 dark:text-blue-400'
            : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300'
        }`}
      >
        <Settings className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={onToggleRuntimePanel}
        className={`p-1 rounded transition-colors ${
          showRuntimePanel
            ? 'text-blue-500 dark:text-blue-400'
            : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300'
        }`}
      >
        <PanelRight className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export interface ProjectSessionHeaderControlsProps {
  workspaceMode: boolean;
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
  activeRun: { runId: string; goal?: string; startedAt: string } | null;
}

export function ProjectSessionHeaderControls({
  workspaceMode,
  ...props
}: ProjectSessionHeaderControlsProps) {
  if (workspaceMode) return null;
  return <ChatSessionHeader {...props} />;
}

