'use client';

import { Sparkles } from 'lucide-react';
import type { ComponentProps } from 'react';
import { AgentAvatar } from '@/components/agent-form';
import { ChatInput } from '@/components/chat-input';
import { SessionConfigPanel } from '@/components/session-config-panel';
import { RuntimePanel } from '@/components/runtime-panel';
import { FolderExplorerPanel } from '@/components/folder-explorer-panel';
import { PlanViewerPanel } from '@/components/plan-viewer-panel';
import { ActionContentPanel } from '@/components/action-content-panel';
import type { Agent } from '@/types';
import type { SessionConfig } from '@/types/agent-chat';
import type { ParsedActionTag } from '@/lib/action-tag-parser';

type ChatInputBaseProps = Omit<ComponentProps<typeof ChatInput>, 'placeholder'>;

export function PlanPanelSection({
  planContent,
  isOpen,
  onClose,
}: {
  planContent: string | null;
  isOpen: boolean;
  onClose: () => void;
}) {
  if (!planContent) return null;
  return (
    <div
      className={`shrink-0 overflow-hidden border-l border-zinc-200 transition-[width] duration-200 ease-in-out dark:border-zinc-800 ${
        isOpen ? 'w-[400px]' : 'w-0 border-l-0'
      }`}
    >
      <div className="h-full w-[400px]">
        <PlanViewerPanel content={planContent} onClose={onClose} />
      </div>
    </div>
  );
}

export function ActionPanelSection({
  actionPreviewTag,
  isOpen,
  onClose,
}: {
  actionPreviewTag: ParsedActionTag | null;
  isOpen: boolean;
  onClose: () => void;
}) {
  if (!actionPreviewTag) return null;
  return (
    <div
      className={`shrink-0 overflow-hidden border-l border-zinc-200 transition-[width] duration-200 ease-in-out dark:border-zinc-800 ${
        isOpen ? 'w-[400px]' : 'w-0 border-l-0'
      }`}
    >
      <div className="h-full w-[400px]">
        <ActionContentPanel tag={actionPreviewTag} onClose={onClose} />
      </div>
    </div>
  );
}

export function ConfigDrawerSection({
  showConfig,
  sessionId,
  sessionConfig,
  onSave,
  onClose,
  agent,
  hasProject,
}: {
  showConfig: boolean;
  sessionId: string | null;
  sessionConfig: SessionConfig;
  onSave: (config: SessionConfig) => void;
  onClose: () => void;
  agent: Agent;
  hasProject: boolean;
}) {
  return (
    <div
      className={`shrink-0 overflow-hidden border-l border-zinc-200 transition-[width] duration-200 ease-in-out dark:border-zinc-800 ${
        showConfig ? 'w-[320px]' : 'w-0 border-l-0'
      }`}
    >
      <div className="h-full w-[320px]">
        <SessionConfigPanel
          sessionId={sessionId ?? '_new'}
          config={sessionConfig}
          onSave={onSave}
          onClose={onClose}
          agent={agent}
          {...(!hasProject ? { agentSystemPrompt: agent.systemPrompt, agentCapabilities: agent.capabilities } : {})}
        />
      </div>
    </div>
  );
}

export function RuntimeDrawerSection({
  showRuntimePanel,
  agent,
  sessionConfig,
  onSaveConfig,
  onClose,
}: {
  showRuntimePanel: boolean;
  agent: Agent;
  sessionConfig: SessionConfig;
  onSaveConfig: (config: SessionConfig) => void;
  onClose: () => void;
}) {
  return (
    <div
      className={`shrink-0 overflow-hidden border-l border-zinc-200 transition-[width] duration-200 ease-in-out dark:border-zinc-800 ${
        showRuntimePanel ? 'w-[300px]' : 'w-0 border-l-0'
      }`}
    >
      <div className="h-full w-[300px]">
        <RuntimePanel
          agent={agent}
          sessionConfig={sessionConfig}
          onSaveConfig={onSaveConfig}
          onClose={onClose}
        />
      </div>
    </div>
  );
}

export function FolderExplorerSection({
  showFolderExplorer,
  onClose,
  onInsertPath,
  projectPath,
}: {
  showFolderExplorer: boolean;
  onClose: () => void;
  onInsertPath: (filePath: string) => void;
  projectPath?: string;
}) {
  return (
    <div
      className={`shrink-0 overflow-hidden border-l border-zinc-200 transition-[width] duration-200 ease-in-out dark:border-zinc-800 ${
        showFolderExplorer ? 'w-[280px]' : 'w-0 border-l-0'
      }`}
    >
      <div className="h-full w-[280px]">
        <FolderExplorerPanel
          onClose={onClose}
          onInsertPath={onInsertPath}
          initialPath={projectPath}
        />
      </div>
    </div>
  );
}

export function PlainEmptyStateSection({
  agent,
  agentDisplayName,
  workspaceMode,
}: {
  agent: Agent;
  agentDisplayName: string;
  workspaceMode: boolean;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-zinc-400 dark:text-zinc-500">
      <div className="h-14 w-14 overflow-hidden rounded-2xl bg-zinc-100 dark:bg-zinc-800">
        <AgentAvatar
          slug={agent.slug}
          iconKey={agent.icon}
          agentId={agent.id}
          customAvatar={agent.customAvatar}
          updatedAt={agent.updatedAt}
          className="h-full w-full object-cover"
          alt={agentDisplayName}
        />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">{agentDisplayName}</p>
        <p className="max-w-sm text-sm">
          {workspaceMode ? `向 ${agentDisplayName} 发一条消息，开始当前工作区会话。` : `向 ${agentDisplayName} 发一条消息，开始对话。`}
        </p>
      </div>
    </div>
  );
}

export function ProjectEmptyStateSection({
  workspaceMode,
  agent,
  agentDisplayName,
  plannerHint,
}: {
  workspaceMode: boolean;
  agent: Agent;
  agentDisplayName: string;
  plannerHint: string;
}) {
  if (workspaceMode) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center text-zinc-400 dark:text-zinc-500">
        <div className="h-16 w-16 overflow-hidden rounded-[24px] bg-zinc-100 dark:bg-zinc-800">
          <AgentAvatar
          slug={agent.slug}
          iconKey={agent.icon}
          agentId={agent.id}
          customAvatar={agent.customAvatar}
          updatedAt={agent.updatedAt}
          className="h-full w-full object-cover"
          alt={agentDisplayName}
        />
        </div>
        <div className="space-y-1.5">
          <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">{agentDisplayName}</p>
          <p className="max-w-sm text-sm leading-6">
            向 {agentDisplayName} 发一条消息，开始当前工作区会话。
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-zinc-400">
      <Sparkles className="h-8 w-8 stroke-1" />
      <p className="text-xs">{plannerHint}</p>
    </div>
  );
}

export function PlainInputSection({
  chatInputProps,
  agentDisplayName,
}: {
  chatInputProps: ChatInputBaseProps;
  agentDisplayName: string;
}) {
  return (
    <div className="border-t border-zinc-200 p-3 dark:border-zinc-800">
      <ChatInput
        {...chatInputProps}
        placeholder={`发送消息给 ${agentDisplayName}...`}
      />
    </div>
  );
}

export function ProjectInputSection({
  chatInputProps,
  workspaceMode,
  agentDisplayName,
  plannerPlaceholder,
  isFull,
}: {
  chatInputProps: ChatInputBaseProps;
  workspaceMode: boolean;
  agentDisplayName: string;
  plannerPlaceholder: string;
  isFull: boolean;
}) {
  return (
    <div className="border-t border-zinc-100 p-2 dark:border-zinc-800">
      <ChatInput
        {...chatInputProps}
        placeholder={workspaceMode ? `继续向 ${agentDisplayName} 发送消息...` : plannerPlaceholder}
        minHeight={isFull ? '120px' : '200px'}
        fullWidth
      />
    </div>
  );
}

