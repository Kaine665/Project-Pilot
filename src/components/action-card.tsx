'use client';

import { memo, useState, useCallback } from 'react';
import {
  FileText,
  BookMarked,
  PauseCircle,
  CheckCircle2,
  Save,
  Users,
  X,
  RotateCcw,
  Eye,
  Loader2,
} from 'lucide-react';
import type { ActionTagType, ParsedActionTag, ActionColorConfig } from '@/lib/action-tag-parser';
import { ACTION_COLORS } from '@/lib/action-tag-parser';

// ── Icon mapping ──

const ACTION_ICONS: Record<ActionTagType, React.ComponentType<{ className?: string }>> = {
  'save-doc': FileText,
  'save-knowledge': BookMarked,
  'suspend-task': PauseCircle,
  'complete-suspended-task': CheckCircle2,
  'save-checkpoint': Save,
  'await-sub-agents': Users,
  'session-title': FileText,
};

// ── Card states ──

export type ActionCardState = 'accepted' | 'rejected' | 'streaming';

// ── ActionCard props ──

export interface ActionCardProps {
  tag: ParsedActionTag;
  /** Initial state — defaults to 'accepted' */
  initialState?: ActionCardState;
  /** Called when user clicks the card to preview content */
  onPreview?: (tag: ParsedActionTag) => void;
  /** Called when user rejects (X button) */
  onReject?: (tag: ParsedActionTag) => void;
  /** Called when user restores a rejected action */
  onRestore?: (tag: ParsedActionTag) => void;
}

export const ActionCard = memo(function ActionCard({
  tag,
  initialState = 'accepted',
  onPreview,
  onReject,
  onRestore,
}: ActionCardProps) {
  const [state, setState] = useState<ActionCardState>(initialState);
  const colors = ACTION_COLORS[tag.type];
  const Icon = ACTION_ICONS[tag.type];

  const handleReject = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setState('rejected');
    onReject?.(tag);
  }, [tag, onReject]);

  const handleRestore = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setState('accepted');
    onRestore?.(tag);
  }, [tag, onRestore]);

  const handleClick = useCallback(() => {
    if (state !== 'streaming' && tag.hasPreviewContent) {
      onPreview?.(tag);
    }
  }, [state, tag, onPreview]);

  if (state === 'rejected') {
    return <RejectedCard tag={tag} colors={colors} Icon={Icon} onRestore={handleRestore} />;
  }

  if (state === 'streaming') {
    return <StreamingCard tag={tag} colors={colors} Icon={Icon} />;
  }

  return (
    <AcceptedCard
      tag={tag}
      colors={colors}
      Icon={Icon}
      onClick={handleClick}
      onReject={handleReject}
    />
  );
});

// ── Accepted state ──

function AcceptedCard({
  tag,
  colors,
  Icon,
  onClick,
  onReject,
}: {
  tag: ParsedActionTag;
  colors: ActionColorConfig;
  Icon: React.ComponentType<{ className?: string }>;
  onClick: () => void;
  onReject: (e: React.MouseEvent) => void;
}) {
  const clickable = tag.hasPreviewContent;

  return (
    <div
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={clickable ? onClick : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === 'Enter') onClick(); } : undefined}
      className={`
        group/action-card my-2 flex items-center gap-2.5 rounded-md border-l-[3px] px-3 py-2
        ${colors.border} ${colors.bg}
        ${clickable ? `cursor-pointer ${colors.bgHover} transition-colors` : ''}
      `}
    >
      {/* Icon */}
      <div className={`shrink-0 ${colors.iconColor}`}>
        <Icon className="h-4 w-4" />
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-xs font-medium text-zinc-800 dark:text-zinc-200">
            {tag.title}
          </span>
          <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${colors.badgeBg} ${colors.badgeText}`}>
            {colors.acceptedLabel}
          </span>
        </div>
        {tag.subtitle && (
          <p className="mt-0.5 truncate text-[11px] text-zinc-500 dark:text-zinc-400">
            {tag.subtitle}
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover/action-card:opacity-100">
        {tag.hasPreviewContent && (
          <button
            onClick={onClick}
            className="rounded p-1 text-zinc-400 transition-colors hover:bg-white/60 hover:text-zinc-600 dark:hover:bg-zinc-700/60 dark:hover:text-zinc-300"
            title="预览"
          >
            <Eye className="h-3 w-3" />
          </button>
        )}
        <button
          onClick={onReject}
          className="rounded p-1 text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/30 dark:hover:text-red-400"
          title="撤回"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

// ── Rejected state ──

function RejectedCard({
  tag,
  colors: _colors,
  Icon,
  onRestore,
}: {
  tag: ParsedActionTag;
  colors: ActionColorConfig;
  Icon: React.ComponentType<{ className?: string }>;
  onRestore: (e: React.MouseEvent) => void;
}) {
  return (
    <div className="my-2 flex items-center gap-2.5 rounded-md border-l-[3px] border-l-zinc-300 bg-zinc-100/60 px-3 py-2 dark:border-l-zinc-600 dark:bg-zinc-800/40">
      {/* Icon — grayed out */}
      <div className="shrink-0 text-zinc-400 dark:text-zinc-500">
        <Icon className="h-4 w-4" />
      </div>

      {/* Content — grayed out + strikethrough title */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-xs font-medium text-zinc-400 line-through dark:text-zinc-500">
            {tag.title}
          </span>
          <span className="shrink-0 rounded-full bg-zinc-200 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 dark:bg-zinc-700 dark:text-zinc-400">
            已撤回
          </span>
        </div>
      </div>

      {/* Restore button */}
      <button
        onClick={onRestore}
        className="flex shrink-0 items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] text-zinc-500 transition-colors hover:bg-zinc-200 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-300"
        title="恢复"
      >
        <RotateCcw className="h-3 w-3" />
        <span>恢复</span>
      </button>
    </div>
  );
}

// ── Streaming state ──

function StreamingCard({
  tag,
  colors,
  Icon,
}: {
  tag: ParsedActionTag;
  colors: ActionColorConfig;
  Icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div
      className={`
        my-2 flex items-center gap-2.5 rounded-md border-l-[3px] border-dashed px-3 py-2
        ${colors.border} ${colors.bg} animate-pulse
      `}
    >
      <div className={`shrink-0 ${colors.iconColor}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
            {tag.title || colors.label}
          </span>
          <Loader2 className={`h-3 w-3 animate-spin ${colors.iconColor}`} />
        </div>
        {tag.subtitle && (
          <p className="mt-0.5 truncate text-[11px] text-zinc-400 dark:text-zinc-500">
            正在写入...
          </p>
        )}
      </div>
    </div>
  );
}

// ── Streaming Action Card (used for unclosed tags) ──

export interface StreamingActionCardProps {
  tagType: ActionTagType;
}

export const StreamingActionCard = memo(function StreamingActionCard({
  tagType,
}: StreamingActionCardProps) {
  const colors = ACTION_COLORS[tagType];
  const Icon = ACTION_ICONS[tagType];

  return (
    <div
      className={`
        my-2 flex items-center gap-2.5 rounded-md border-l-[3px] border-dashed px-3 py-2
        ${colors.border} ${colors.bg} animate-pulse
      `}
    >
      <div className={`shrink-0 ${colors.iconColor}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
            {colors.label}
          </span>
          <Loader2 className={`h-3 w-3 animate-spin ${colors.iconColor}`} />
        </div>
        <p className="mt-0.5 text-[11px] text-zinc-400 dark:text-zinc-500">
          正在写入...
        </p>
      </div>
    </div>
  );
});
