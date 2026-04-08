'use client';

import { ChevronRight, Loader2 } from 'lucide-react';
import { memo, useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from '@/client/i18n/use-translations';
import { Link } from '@/client/i18n/routing';
import { CommunityAgentCard } from '@/components/community-store/community-agent-card';
import { CommunityMcpCard } from '@/components/community-store/community-mcp-card';
import { CommunitySkillCard } from '@/components/community-store/community-skill-card';
import { useCommunityCatalog } from '@/components/community-store/community-catalog-context';
import { CommunityStoreShell } from '@/components/community-store/community-store-shell';
import { Button } from '@/components/ui/button';
import type {
  CommunityMcpCatalogResponse,
  CommunitySkillsCatalogResponse,
} from '@/types/community-catalog';

export const CommunityHomePage = memo(function CommunityHomePage() {
  const t = useTranslations('community');
  const locale = useLocale();
  const { catalog, loadError } = useCommunityCatalog();

  const [skillsCat, setSkillsCat] = useState<CommunitySkillsCatalogResponse | null>(null);
  const [mcpCat, setMcpCat] = useState<CommunityMcpCatalogResponse | null>(null);
  const [mcpInstalled, setMcpInstalled] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [sRes, mRes, iRes] = await Promise.all([
          fetch('/api/community/skills/catalog', { cache: 'no-store' }),
          fetch('/api/community/mcp/catalog', { cache: 'no-store' }),
          fetch('/api/community/mcp/installed', { cache: 'no-store' }),
        ]);
        if (!cancelled && sRes.ok) setSkillsCat((await sRes.json()) as CommunitySkillsCatalogResponse);
        if (!cancelled && mRes.ok) setMcpCat((await mRes.json()) as CommunityMcpCatalogResponse);
        if (!cancelled && iRes.ok) {
          const ij = (await iRes.json()) as { keys?: string[] };
          if (Array.isArray(ij.keys)) setMcpInstalled(ij.keys);
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** 发现页精选条数（MCP 在开发默认拉 Registry 后条目多，多露一些） */
  const FEATURED_LIMIT = 24;

  const featuredAgents = useMemo(() => {
    const items = catalog?.items ?? [];
    return [...items]
      .sort((a, b) => {
        const ta = new Date(a.updatedAt ?? a.createdAt ?? 0).getTime();
        const tb = new Date(b.updatedAt ?? b.createdAt ?? 0).getTime();
        return tb - ta;
      })
      .slice(0, FEATURED_LIMIT);
  }, [catalog?.items]);

  const featuredSkills = useMemo(() => {
    const items = skillsCat?.items ?? [];
    return [...items]
      .sort((a, b) => new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime())
      .slice(0, FEATURED_LIMIT);
  }, [skillsCat?.items]);

  const featuredMcp = useMemo(() => {
    const items = mcpCat?.items ?? [];
    return [...items]
      .sort((a, b) => new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime())
      .slice(0, FEATURED_LIMIT);
  }, [mcpCat?.items]);

  return (
    <CommunityStoreShell>
      {loadError ? <p className="p-6 text-sm text-destructive">{t('loadError')}</p> : null}
      {!catalog && !loadError ? (
        <div className="flex flex-1 items-center justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-zinc-400" aria-hidden />
        </div>
      ) : null}
      {catalog ? (
        <div className="mx-auto w-full max-w-[1400px] space-y-10 px-4 py-8 lg:px-6">
          <section className="rounded-2xl border border-violet-200/80 bg-gradient-to-br from-violet-50/90 to-white p-6 dark:border-violet-900/50 dark:from-violet-950/40 dark:to-zinc-950">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{t('home.bannerTitle')}</h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
              {t('home.bannerBody')}
            </p>
            <Button asChild className="mt-4" variant="default">
              <Link to="/workspace/community/agent">
                {t('home.bannerCta')}
                <ChevronRight className="ml-1 h-4 w-4" aria-hidden />
              </Link>
            </Button>
          </section>

          <section>
            <div className="mb-4 flex items-end justify-between gap-4">
              <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">{t('home.featuredAssistants')}</h2>
              <Link
                to="/workspace/community/agent"
                className="text-sm font-medium text-primary hover:underline"
              >
                {t('home.more')}
              </Link>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {featuredAgents.map((item) => (
                <CommunityAgentCard key={item.id} item={item} localeCode={locale} />
              ))}
            </div>
          </section>

          <section>
            <div className="mb-4 flex items-end justify-between gap-4">
              <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">{t('home.featuredSkills')}</h2>
              <Link to="/workspace/community/skill" className="text-sm font-medium text-primary hover:underline">
                {t('home.moreSkills')}
              </Link>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {featuredSkills.map((item) => (
                <CommunitySkillCard key={item.id} item={item} localeCode={locale} />
              ))}
            </div>
          </section>

          <section>
            <div className="mb-4 flex items-end justify-between gap-4">
              <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">{t('home.featuredMcp')}</h2>
              <Link to="/workspace/community/mcp" className="text-sm font-medium text-primary hover:underline">
                {t('home.moreMcp')}
              </Link>
            </div>
            <p className="mb-4 text-xs text-zinc-500 dark:text-zinc-400">{t('home.mcpStripHint')}</p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {featuredMcp.map((item) => (
                <CommunityMcpCard
                  key={item.id}
                  item={item}
                  localeCode={locale}
                  installed={mcpInstalled.includes(item.serverKey)}
                />
              ))}
            </div>
          </section>

          <div className="space-y-1 font-mono text-[10px] text-zinc-400">
            <p>{t('catalogMeta', { source: catalog.source, version: String(catalog.version) })}</p>
            {catalog.catalogOrigin === 'remote' ? (
              <p>
                {t('catalogOrigin.remote')}
                {catalog.remoteCatalogUrl ? ` · ${catalog.remoteCatalogUrl}` : ''}
              </p>
            ) : null}
            {catalog.catalogOrigin === 'dev-bulk' ? <p>{t('catalogOrigin.devBulk')}</p> : null}
            {skillsCat?.catalogOrigin === 'remote' ? (
              <p>
                Skill：{t('catalogOrigin.remote')}
                {skillsCat.remoteCatalogUrl ? ` · ${skillsCat.remoteCatalogUrl}` : ''}
              </p>
            ) : null}
            {skillsCat?.catalogOrigin === 'dev-bulk' ? (
              <p>Skill：{t('catalogOrigin.devBulk')}</p>
            ) : null}
            {mcpCat?.catalogOrigin === 'remote' ? (
              <p>
                MCP：{t('catalogOrigin.remote')}
                {mcpCat.remoteCatalogUrl ? ` · ${mcpCat.remoteCatalogUrl}` : ''}
              </p>
            ) : null}
            {mcpCat?.catalogOrigin === 'registry' ? (
              <p>
                MCP：{t('catalogOrigin.registry')}
                {mcpCat.remoteCatalogUrl ? ` · ${mcpCat.remoteCatalogUrl}` : ''}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </CommunityStoreShell>
  );
});
