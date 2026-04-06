'use client';

import { Plug } from 'lucide-react';
import { useTranslations } from '@/client/i18n/use-translations';

export default function McpPage() {
  const t = useTranslations('mcpPage');

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground">
      <header className="shrink-0 border-b border-zinc-200 bg-zinc-50/80 px-6 py-4 dark:border-zinc-800 dark:bg-zinc-950/80">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900">
            <Plug className="h-5 w-5" aria-hidden />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold tracking-tight">{t('title')}</h1>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">{t('subtitle')}</p>
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto flex max-w-2xl flex-col gap-8">
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{t('runTitle')}</h2>
            <p className="text-sm text-muted-foreground">{t('runIntro')}</p>
            <pre className="overflow-x-auto rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm dark:border-zinc-700 dark:bg-zinc-900/50">
              <code>{t('runCommand')}</code>
            </pre>
            <p className="text-xs text-muted-foreground">{t('runAlt')}</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{t('toolsTitle')}</h2>
            <ul className="list-inside list-disc space-y-2 text-sm text-muted-foreground">
              <li>{t('toolListProjects')}</li>
              <li>{t('toolGetProject')}</li>
              <li>{t('toolCreateProject')}</li>
              <li>{t('toolDeleteProject')}</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{t('clientTitle')}</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">{t('clientBody')}</p>
          </section>

          <p className="rounded-lg border border-amber-200/80 bg-amber-50/80 px-4 py-3 text-xs leading-relaxed text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-100/90">
            {t('dataNote')}
          </p>
        </div>
      </div>
    </div>
  );
}
