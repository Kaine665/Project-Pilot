'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as Dialog from '@radix-ui/react-dialog';
import { usePathname, useRouter } from '@/client/i18n/routing';
import type { Locale } from '@/client/i18n/routing';
import { useTranslations } from '@/client/i18n/use-translations';
import { Languages, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const LOCALES: Locale[] = ['zh', 'en'];

function resolveUiLocale(raw: string | undefined): Locale {
  const c = (raw || 'zh').toLowerCase().split('-')[0];
  return c === 'en' ? 'en' : 'zh';
}

/** 触发钮上的两字（字母）简写：中文界面显示「中文」，英文界面显示「EN」 */
function localeShortBadge(locale: Locale): string {
  return locale === 'zh' ? '中文' : 'EN';
}

export function LanguageSwitcher({
  /** true：与工作区左侧迷你栏 `SidebarNavRow` 对齐（仅简写文案）；false：与展开态 `SidebarNavRow` 一致（图标槽 + 文案） */
  compact = false,
  className,
}: {
  compact?: boolean;
  className?: string;
}) {
  const { i18n } = useTranslation();
  const tr = useTranslations('workspaceSidebarRail');
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const resolved = resolveUiLocale(i18n.language);
  const badge = localeShortBadge(resolved);

  const applyLocale = (next: Locale) => {
    setOpen(false);
    if (next === resolved) return;
    void i18n.changeLanguage(next);
    router.push(pathname);
  };

  const triggerClassName = compact
    ? cn(
        'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-zinc-600 transition-colors',
        'hover:bg-white hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200',
        'text-[11px] font-semibold leading-none tracking-tight',
        className,
      )
    : cn(
        'flex h-10 w-full min-w-0 items-center gap-2 rounded-lg text-left text-sm font-medium text-zinc-600 transition-colors',
        'hover:bg-white hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200',
        className,
      );

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          className={triggerClassName}
          title={tr('languagePickerTitle')}
          aria-label={tr('languagePickerTriggerAria')}
          aria-haspopup="dialog"
          aria-expanded={open}
        >
          {compact ? (
            badge
          ) : (
            <>
              <span className="flex h-10 w-10 shrink-0 items-center justify-center" aria-hidden>
                <Languages className="h-5 w-5 shrink-0 text-zinc-600 dark:text-zinc-400" />
              </span>
              <span className="min-w-0 flex-1 truncate">{badge}</span>
            </>
          )}
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[300] bg-black/45 data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-[301] w-[min(92vw,300px)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-zinc-200 bg-white p-4 shadow-lg outline-none',
            'dark:border-zinc-700 dark:bg-zinc-950',
            'data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
          )}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className="flex items-start justify-between gap-2 border-b border-zinc-100 pb-3 dark:border-zinc-800">
            <Dialog.Title className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {tr('languagePickerTitle')}
            </Dialog.Title>
            <Dialog.Close
              type="button"
              className="rounded-md p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
              aria-label={tr('languagePickerCloseAria')}
            >
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">{tr('languagePickerDescription')}</Dialog.Description>
          <div className="mt-3 flex flex-col gap-2">
            {LOCALES.map((code) => {
              const selected = code === resolved;
              const label = code === 'zh' ? tr('localeOptionZh') : tr('localeOptionEn');
              return (
                <Button
                  key={code}
                  type="button"
                  variant={selected ? 'secondary' : 'outline'}
                  className={cn(
                    'h-auto justify-start py-2.5 text-left text-sm font-medium',
                    selected && 'ring-2 ring-zinc-400 ring-offset-2 dark:ring-zinc-500 dark:ring-offset-zinc-950',
                  )}
                  onClick={() => applyLocale(code)}
                >
                  {label}
                </Button>
              );
            })}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
