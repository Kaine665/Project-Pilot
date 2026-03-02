'use client';

import { createPortal } from 'react-dom';
import {
  Plus,
  Sparkles,
  ChevronsRight,
  TextCursorInput,
  BookOpen,
  Bot,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { DeleteButton } from './flow-shared';
import type { TreeItem } from '@/types/flow';
import type { Agent } from '@/types';

// ── Actions Panel (portal) ──

interface ItemActionsPanelProps {
  panelRef: React.RefObject<HTMLDivElement | null>;
  pos: { top: number; left: number };
  item: TreeItem;
  addingDesc: boolean;
  isDeferred: boolean;
  isSelected: boolean;
  boundAgent: Agent | undefined;
  onAddDescription: () => void;
  onOpenContext: () => void;
  onOpenAgentPicker: (e: React.MouseEvent) => void;
  onLaunchAI: () => void;
  onToggleDefer: () => void;
  onAddSubItem: () => void;
  onDelete: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

export function ItemActionsPanel({
  panelRef, pos, item, addingDesc, isDeferred, isSelected, boundAgent,
  onAddDescription, onOpenContext, onOpenAgentPicker, onLaunchAI,
  onToggleDefer, onAddSubItem, onDelete,
  onMouseEnter, onMouseLeave,
}: ItemActionsPanelProps) {
  const t = useTranslations();

  return createPortal(
    <div
      ref={panelRef}
      className="fixed flex items-center gap-1.5 bg-white dark:bg-zinc-900 rounded-lg shadow-lg border border-zinc-200 dark:border-zinc-700 px-2.5 py-1.5 z-9999"
      style={{ top: pos.top, left: pos.left, transform: 'translateY(-50%)' }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {!item.description && !addingDesc && (
        <button
          className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-muted-foreground hover:text-foreground transition-colors"
          onClick={e => {
            e.stopPropagation();
            onAddDescription();
          }}
          title={t('flows.addDescription')}
        >
          <TextCursorInput className="w-3.5 h-3.5" />
        </button>
      )}
      <button
        className="p-1 rounded hover:bg-amber-50 dark:hover:bg-amber-950/30 text-muted-foreground hover:text-amber-600 transition-colors"
        onClick={e => {
          e.stopPropagation();
          onOpenContext();
        }}
        title={t('flows.taskContext')}
      >
        <BookOpen className="w-3.5 h-3.5" />
      </button>
      <button
        className={`p-1 rounded transition-colors ${
          item.agentId
            ? 'text-blue-500 bg-blue-50 dark:bg-blue-950/30'
            : 'text-muted-foreground hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-950/30'
        }`}
        onClick={e => {
          e.stopPropagation();
          onOpenAgentPicker(e);
        }}
        title={boundAgent ? t('flows.agentBound', { agent: boundAgent.name }) : t('flows.bindAgent')}
      >
        <Bot className="w-3.5 h-3.5" />
      </button>
      <button
        className="p-1 rounded hover:bg-violet-50 dark:hover:bg-violet-950/30 text-muted-foreground hover:text-violet-500 transition-colors"
        onClick={e => {
          e.stopPropagation();
          onLaunchAI();
        }}
        title={boundAgent ? t('flows.startAIWithAgent', { agent: boundAgent.name }) : t('flows.startAICollaboration')}
      >
        <Sparkles className="w-3.5 h-3.5" />
      </button>
      <button
        className={`p-1 rounded transition-colors ${
          isDeferred
            ? 'text-blue-400 hover:text-blue-600'
            : 'text-muted-foreground hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-950/30'
        }`}
        onClick={e => {
          e.stopPropagation();
          onToggleDefer();
        }}
        title={isDeferred ? t('flows.moveToThisCycle') : t('flows.pushToLater')}
      >
        <ChevronsRight className="w-3.5 h-3.5" />
      </button>
      <button
        className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-muted-foreground hover:text-foreground transition-colors"
        onClick={e => {
          e.stopPropagation();
          onAddSubItem();
        }}
        title={t('flows.addSubItem')}
      >
        <Plus className="w-3.5 h-3.5" />
      </button>
      <DeleteButton onClick={onDelete} />
    </div>,
    document.body,
  );
}

// ── Agent Picker Panel (portal) ──

interface ItemAgentPickerPanelProps {
  panelRef: React.RefObject<HTMLDivElement | null>;
  pos: { top: number; left: number };
  agents: Agent[];
  currentAgentId?: string;
  onAssign: (agentId: string | null) => void;
}

export function ItemAgentPickerPanel({
  panelRef, pos, agents, currentAgentId,
  onAssign,
}: ItemAgentPickerPanelProps) {
  const t = useTranslations();

  return createPortal(
    <div
      ref={panelRef}
      className="fixed z-9999 bg-white dark:bg-zinc-900 rounded-lg shadow-lg border border-zinc-200 dark:border-zinc-700 w-48 py-1"
      style={{ top: pos.top, left: pos.left }}
      onMouseDown={e => e.stopPropagation()}
    >
      <button
        className="w-full text-left px-3 py-1.5 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors flex items-center gap-2 text-muted-foreground"
        onClick={e => {
          e.stopPropagation();
          onAssign(null);
        }}
      >
        <span className="w-3.5 h-3.5 shrink-0 inline-block" />
        <span>{t('flows.noAgent')}</span>
        {!currentAgentId && <span className="ml-auto text-[10px]">✓</span>}
      </button>
      {agents.length > 0 && <div className="my-1 border-t border-zinc-200 dark:border-zinc-700" />}
      {agents.map(agent => (
        <button
          key={agent.id}
          className={`w-full text-left px-3 py-1.5 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors flex items-center gap-2 ${
            currentAgentId === agent.id ? 'text-blue-600 dark:text-blue-400' : 'text-foreground'
          }`}
          onClick={e => {
            e.stopPropagation();
            onAssign(agent.id);
          }}
        >
          <Bot className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{agent.name}</span>
          {currentAgentId === agent.id && <span className="ml-auto text-[10px]">✓</span>}
        </button>
      ))}
      {agents.length === 0 && (
        <div className="px-3 py-2 text-xs text-muted-foreground">{t('flows.noAgentsAvailable')}</div>
      )}
    </div>,
    document.body,
  );
}
