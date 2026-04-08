'use client';

import { ArrowLeft, Download, ExternalLink, Loader2 } from 'lucide-react';
import { memo, useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from '@/client/i18n/use-translations';
import { Link, useParams, useSearchParams } from '@/client/i18n/routing';
import { CommunityStoreShell } from '@/components/community-store/community-store-shell';
import { useProject } from '@/components/project-context';
import { Button } from '@/components/ui/button';
import { FormattedText } from '@/components/formatted-text';
import { isHttpUrl, localizedSkill } from '@/lib/community-catalog-locale';
import type { CommunitySkillSeedItem } from '@/types/community-catalog';

export const CommunitySkillDetailPage = memo(function CommunitySkillDetailPage() {
  const t = useTranslations('community');
  const locale = useLocale();
  const { identifier: identifierParam } = useParams<{ identifier: string }>();
  const identifier = identifierParam ? decodeURIComponent(identifierParam) : '';
  const [searchParams] = useSearchParams();
  const listQs = searchParams.toString();
  const backTo = listQs ? `/workspace/community/skill?${listQs}` : '/workspace/community/skill';
  const { activeKey } = useProject();

  const [item, setItem] = useState<CommunitySkillSeedItem | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [installing, setInstalling] = useState<'global' | 'project' | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!identifier) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/community/skills/item/${encodeURIComponent(identifier)}`, {
          cache: 'no-store',
        });
        const data = (await res.json()) as CommunitySkillSeedItem & { error?: string };
        if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : `HTTP ${res.status}`);
        if (!cancelled) {
          setItem(data as CommunitySkillSeedItem);
          setLoadError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setItem(null);
          setLoadError(e instanceof Error ? e.message : t('detail.notFound'));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [identifier, t]);

  const locDisplay = item ? localizedSkill(item, locale) : null;

  const install = useCallback(
    async (scope: 'global' | 'project') => {
      if (!item) return;
      if (scope === 'project' && !activeKey) {
        setToast(t('skill.needProject'));
        return;
      }
      setInstalling(scope);
      setToast(null);
      try {
        const res = await fetch('/api/community/skills/install', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: item.id,
            ...(scope === 'project' && activeKey ? { projectKey: activeKey } : {}),
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(typeof data.error === 'string' ? data.error : `HTTP ${res.status}`);
        }
        setToast(t('skill.installOk', { name: (data as { name?: string }).name ?? item.dirName }));
      } catch (e) {
        setToast(e instanceof Error ? e.message : t('skill.installFail'));
      } finally {
        setInstalling(null);
      }
    },
    [activeKey, item, t],
  );

  return (
    <CommunityStoreShell>
      <div className="mx-auto w-full max-w-3xl px-4 py-6 lg:px-6">
        <Link
          to={backTo}
          className="mb-6 inline-flex items-center gap-1 text-sm font-medium text-zinc-600 hover:text-primary dark:text-zinc-400"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          {t('detail.back')}
        </Link>

        {!item && !loadError ? (
          <div className="flex justify-center py-24">
            <Loader2 className="h-8 w-8 animate-spin text-zinc-400" aria-hidden />
          </div>
        ) : null}

        {loadError ? (
          <p className="text-sm text-destructive">
            {loadError === 'not_found' ? t('detail.notFound') : loadError}
          </p>
        ) : null}

        {item && locDisplay ? (
          <div className="space-y-6">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">{locDisplay.title}</h1>
              <p className="mt-1 font-mono text-sm text-zinc-500">{item.dirName}</p>
              {locDisplay.description ? (
                <p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{locDisplay.description}</p>
              ) : null}
            </div>

            <section className="rounded-xl border border-zinc-200 bg-zinc-50/80 p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{t('skill.sourceSection')}</h2>
              <div className="formatted-markdown mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                <FormattedText
                  text={
                    locDisplay.sourceNote?.trim()
                      ? locDisplay.sourceNote
                      : item.sourceProvider === 'unknown'
                        ? t('skill.sourceFallbackUnknown')
                        : t('skill.sourceFallbackPp')
                  }
                />
              </div>
              {isHttpUrl(item.sourceUrl) ? (
                <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                  <Button variant="default" className="gap-2 sm:w-auto" asChild>
                    <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-4 w-4" aria-hidden />
                      {t('skill.openExternalSource')}
                    </a>
                  </Button>
                  <span className="break-all font-mono text-[11px] text-zinc-500 dark:text-zinc-400">{item.sourceUrl}</span>
                </div>
              ) : null}
            </section>

            <div className="flex flex-wrap gap-2">
              <Button
                disabled={installing !== null}
                onClick={() => void install('global')}
                className="gap-2"
              >
                {installing === 'global' ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Download className="h-4 w-4" aria-hidden />
                )}
                {t('skill.installGlobal')}
              </Button>
              <Button
                variant="outline"
                disabled={installing !== null || !activeKey}
                onClick={() => void install('project')}
                className="gap-2"
              >
                {installing === 'project' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                {t('skill.installProject')}
              </Button>
              <Button variant="outline" asChild>
                <Link to="/workspace/skills">{t('skill.openSkillsPage')}</Link>
              </Button>
            </div>

            {!activeKey ? (
              <p className="text-xs text-amber-700 dark:text-amber-300">{t('skill.needProjectHint')}</p>
            ) : null}

            {toast ? (
              <p className="rounded-lg border border-border bg-muted/40 px-4 py-2 text-sm text-foreground">{toast}</p>
            ) : null}

            <section>
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{t('skill.preview')}</h2>
              <div className="formatted-markdown mt-3 max-h-[480px] overflow-auto rounded-xl border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-800 dark:bg-zinc-950">
                <FormattedText text={locDisplay.skillMarkdownPreview} />
              </div>
            </section>
          </div>
        ) : null}
      </div>
    </CommunityStoreShell>
  );
});
