'use client';

import { Suspense, useMemo, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { FlowEditor } from '@/components/flow-editor';
import type { HighlightTarget } from '@/components/flow-editor';
import { useProject } from '@/components/project-context';

function ProjectsPageInner() {
  const { projects, activeKey, setActiveKey, fetchProjects } = useProject();
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

  const handleProjectUpdated = useCallback(async () => {
    await fetchProjects();
  }, [fetchProjects]);

  const handleProjectDeleted = useCallback(async () => {
    const list = await fetchProjects();
    // Switch to first remaining project, or null
    const remaining = list.filter((p: { key: string; name: string; archived?: boolean }) => !p.archived);
    if (remaining.length > 0) {
      setActiveKey(remaining[0].key);
    } else {
      setActiveKey(remaining[0]?.key ?? '');
    }
  }, [fetchProjects, setActiveKey]);

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
      projectDescription={activeProject.description}
      initialHighlight={highlight}
      onProjectUpdated={handleProjectUpdated}
      onProjectDeleted={handleProjectDeleted}
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
