'use client';

import { Pencil, Trash2 } from 'lucide-react';
import type { AgentPreset } from '@/types';
import { AgentAvatar } from '@/components/agent-form';
import { cn } from '@/lib/utils';
import { useTranslations } from '@/client/i18n/use-translations';

export function PresetCard({
  preset,
  onEdit,
  onDelete,
}: {
  preset: AgentPreset;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations('presets');
  const modelLine =
    preset.defaultProvider && preset.defaultModel
      ? `${preset.defaultProvider} · ${preset.defaultModel}`
      : preset.defaultProvider || preset.defaultModel || '';

  return (
    <div
      className={cn(
        'group relative flex flex-col rounded-2xl border border-zinc-200/80 bg-white p-4 shadow-sm transition-shadow hover:shadow-md dark:border-zinc-800 dark:bg-zinc-950',
      )}
    >
      <div className="flex gap-3">
        <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-700">
          <AgentAvatar iconKey={preset.icon} className="h-full w-full object-cover" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">{preset.name}</div>
          {preset.description ? (
            <p className="mt-0.5 line-clamp-2 text-xs text-zinc-500 dark:text-zinc-400">{preset.description}</p>
          ) : (
            <p className="mt-0.5 text-xs text-zinc-400">{t('cardNoDescription')}</p>
          )}
          <div className="mt-2 flex flex-wrap gap-1.5">
            <span className="rounded-md bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
              {preset.projectKey ? t('badgeProject', { key: preset.projectKey }) : t('badgeGlobal')}
            </span>
            {preset.skillIds.length > 0 && (
              <span className="rounded-md bg-violet-50 px-2 py-0.5 text-[10px] font-medium text-violet-700 dark:bg-violet-950/50 dark:text-violet-300">
                {t('badgeSkills', { count: preset.skillIds.length })}
              </span>
            )}
            {modelLine && (
              <span className="rounded-md bg-sky-50 px-2 py-0.5 text-[10px] font-medium text-sky-800 dark:bg-sky-950/40 dark:text-sky-200">
                {modelLine}
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="mt-3 flex justify-end gap-1 border-t border-zinc-100 pt-3 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 dark:border-zinc-800">
        <button
          type="button"
          onClick={onEdit}
          className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          <Pencil className="h-3.5 w-3.5" />
          {t('edit')}
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
        >
          <Trash2 className="h-3.5 w-3.5" />
          {t('delete')}
        </button>
      </div>
    </div>
  );
}
