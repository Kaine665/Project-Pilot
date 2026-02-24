'use client';

import { Suspense, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { FlowEditor } from '@/components/flow-editor';
import type { HighlightTarget } from '@/components/flow-editor';
import { useFlowsContext } from '../layout';

function ProjectsPageInner() {
  const { projects, activeKey } = useFlowsContext();
  const activeProject = projects.find(p => p.key === activeKey);
  const searchParams = useSearchParams();
  const t = useTranslations('flows');

  // Build highlight target from URL params (when navigating back from task agent)
  const highlight = useMemo<HighlightTarget | null>(() => {
    const sectionId = searchParams.get('sectionId') ?? undefined;
    const itemId = searchParams.get('itemId') ?? undefined;
    if (sectionId || itemId) {
      return { sectionId, itemId };
    }
    return null;
  }, [searchParams]);

  if (!activeProject) {
    return (
      <div className="flex h-full items-center justify-center text-zinc-400 text-sm">
        {t('selectOrCreateProject')}
      </div>
    );
  }

  return (
    <FlowEditor
      key={activeProject.key}
      projectKey={activeProject.key}
      projectName={activeProject.name}
      initialHighlight={highlight}
    />
  );
}

export default function ProjectsPage() {
  return (
    <Suspense>
      <ProjectsPageInner />
    </Suspense>
  );
}
