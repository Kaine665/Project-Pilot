'use client';

import { memo } from 'react';
import {
  X,
  FileText,
  Save,
} from 'lucide-react';
import { FormattedText } from '@/components/formatted-text';
import type { ParsedActionTag, ActionTagType } from '@/lib/action-tag-parser';
import { ACTION_COLORS } from '@/lib/action-tag-parser';

const PANEL_ICONS: Partial<Record<ActionTagType, React.ComponentType<{ className?: string }>>> = {
  'save-doc': FileText,
  'save-checkpoint': Save,
};

interface ActionContentPanelProps {
  tag: ParsedActionTag;
  onClose: () => void;
}

export const ActionContentPanel = memo(function ActionContentPanel({
  tag,
  onClose,
}: ActionContentPanelProps) {
  const colors = ACTION_COLORS[tag.type];
  const Icon = PANEL_ICONS[tag.type] ?? FileText;

  return (
    <div className="flex h-full flex-col bg-zinc-50 dark:bg-zinc-950">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
        <div className="flex items-center gap-2 min-w-0">
          <Icon className={`h-3.5 w-3.5 shrink-0 ${colors.iconColor}`} />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-xs font-medium text-zinc-700 dark:text-zinc-300">
                {tag.title}
              </span>
              <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${colors.badgeBg} ${colors.badgeText}`}>
                {colors.label}
              </span>
            </div>
            {tag.subtitle && (
              <p className="mt-0.5 truncate text-[11px] text-zinc-500 dark:text-zinc-400">
                {tag.subtitle}
              </p>
            )}
          </div>
        </div>
        <button
          onClick={onClose}
          className="shrink-0 rounded p-0.5 text-zinc-400 transition-colors hover:bg-zinc-200 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Attributes bar (if any useful attrs) */}
      {renderAttrs(tag) && (
        <div className="border-b border-zinc-200 px-3 py-1.5 dark:border-zinc-800">
          {renderAttrs(tag)}
        </div>
      )}

      {/* Body content */}
      <div className="flex-1 overflow-y-auto p-3">
        {tag.body ? (
          <FormattedText
            text={tag.body}
            className="text-sm leading-relaxed space-y-1.5"
          />
        ) : (
          <p className="text-xs text-zinc-400 dark:text-zinc-500 italic">
            无内容
          </p>
        )}
      </div>
    </div>
  );
});

function renderAttrs(tag: ParsedActionTag): React.ReactNode | null {
  const pills: Array<{ label: string; value: string }> = [];

  if (tag.type === 'save-doc') {
    if (tag.attrs.project) pills.push({ label: '项目', value: tag.attrs.project });
  }

  if (pills.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5">
      {pills.map(({ label, value }) => (
        <span
          key={label}
          className="inline-flex items-center gap-1 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] dark:bg-zinc-800"
        >
          <span className="text-zinc-400 dark:text-zinc-500">{label}:</span>
          <span className="font-medium text-zinc-600 dark:text-zinc-300">{value}</span>
        </span>
      ))}
    </div>
  );
}
