'use client';

import { Package, PanelRight, Play, Settings } from 'lucide-react';
import type { SessionConfig } from '@/types/agent-chat';
import type { SessionAction } from './session-reducer';
import type { SessionListItem } from './types';
import type { SessionNavLink } from '@/components/agent-session-utils';
import type { Dispatch } from 'react';
import { ChatSessionHeader } from './chat-session-header';

type ActiveRunChip = { runId: string; goal?: string; startedAt: string };

function WorkspaceActiveRunStrip({ activeRun }: { activeRun: ActiveRunChip }) {
  return (
    <div
      className="flex shrink-0 items-center gap-2 border-b border-emerald-200/80 bg-emerald-50/70 px-4 py-1.5 dark:border-emerald-900/45 dark:bg-emerald-950/30"
      role="status"
      aria-label="会话 Run 进行中"
    >
      <Play className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
      <span className="text-[11px] font-medium leading-snug text-emerald-900 dark:text-emerald-100">
        Run 进行中
        <span className="mx-1.5 font-normal text-emerald-700/65 dark:text-emerald-300/50">·</span>
        <span className="font-normal text-emerald-800/88 dark:text-emerald-200/85">
          任务与 Run 绑定见对话列表中的「/run 本轮任务」气泡；Run ID{' '}
          <code className="rounded bg-emerald-100/90 px-1 font-mono text-[10px] dark:bg-emerald-900/55">
            {activeRun.runId.length > 22 ? `${activeRun.runId.slice(0, 22)}…` : activeRun.runId}
          </code>
        </span>
      </span>
    </div>
  );
}

export interface PlainToolbarControlsProps {
  workspaceMode: boolean;
  hasActiveRun: boolean;
  /** 与 hasActiveRun 一致；工作区用其展示 Run 摘要（goal / runId） */
  activeRun?: ActiveRunChip | null;
  showConfig: boolean;
  showRuntimePanel: boolean;
  showArtifactsPanel: boolean;
  onToggleConfig: () => void;
  onToggleRuntimePanel: () => void;
  onToggleArtifactsPanel: () => void;
}

export function PlainToolbarControls({
  workspaceMode,
  hasActiveRun,
  activeRun,
  showConfig,
  showRuntimePanel,
  showArtifactsPanel,
  onToggleConfig,
  onToggleRuntimePanel,
  onToggleArtifactsPanel,
}: PlainToolbarControlsProps) {
  if (workspaceMode) {
    const run = activeRun ?? null;
    if (!run || !hasActiveRun) return null;
    return <WorkspaceActiveRunStrip activeRun={run} />;
  }
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
      <button
        type="button"
        onClick={onToggleArtifactsPanel}
        className={`p-1 rounded transition-colors ${
          showArtifactsPanel
            ? 'text-blue-500 dark:text-blue-400'
            : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300'
        }`}
        title="会话产物（提炼、生成物等）"
      >
        <Package className="h-3.5 w-3.5" />
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
  showArtifactsPanel?: boolean;
  onToggleArtifactsPanel?: () => void;
  activeRun: ActiveRunChip | null;
}

export function ProjectSessionHeaderControls({
  workspaceMode,
  activeRun,
  showArtifactsPanel,
  onToggleArtifactsPanel,
  ...props
}: ProjectSessionHeaderControlsProps) {
  if (workspaceMode) {
    if (!activeRun) return null;
    return <WorkspaceActiveRunStrip activeRun={activeRun} />;
  }
  return (
    <ChatSessionHeader
      {...props}
      activeRun={activeRun}
      showArtifactsPanel={showArtifactsPanel}
      onToggleArtifactsPanel={onToggleArtifactsPanel}
    />
  );
}

