'use client';

import { memo } from 'react';
import { X, ClipboardList } from 'lucide-react';
import { FormattedText } from '@/components/formatted-text';

interface PlanViewerPanelProps {
  content: string;
  onClose: () => void;
}

export const PlanViewerPanel = memo(function PlanViewerPanel({
  content,
  onClose,
}: PlanViewerPanelProps) {
  return (
    <div className="flex h-full flex-col bg-zinc-50 dark:bg-zinc-950">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
        <div className="flex items-center gap-1.5">
          <ClipboardList className="h-3.5 w-3.5 text-blue-500" />
          <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Plan</span>
        </div>
        <button
          onClick={onClose}
          className="rounded p-0.5 text-zinc-400 transition-colors hover:bg-zinc-200 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3">
        <FormattedText text={content} className="text-sm leading-relaxed space-y-1.5" />
      </div>
    </div>
  );
});
