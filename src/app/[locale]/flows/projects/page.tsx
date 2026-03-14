'use client';

import { Suspense, useState, useMemo, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ChevronDown, ChevronUp, Inbox } from 'lucide-react';
import { FlowEditor } from '@/components/flow-editor';
import type { HighlightTarget } from '@/components/flow-editor';
import { useProject } from '@/components/project-context';
import { ProjectInbox } from '@/components/project-inbox';

function ProjectsPageInner() {
  const { projects, activeKey, setActiveKey, fetchProjects } = useProject();
  const activeProject = projects.find(p => p.key === activeKey);
  const searchParams = useSearchParams();
  const t = useTranslations('flows');
  const [inboxOpen, setInboxOpen] = useState(true);

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
    <>
      {/* Collapsible Inbox */}
      <div className="mx-auto max-w-7xl px-8 pt-6">
        <button
          onClick={() => setInboxOpen(v => !v)}
          className="mb-2 flex items-center gap-1.5 text-sm font-medium text-zinc-500 transition-colors hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
        >
          <Inbox className="h-4 w-4" />
          <span>收件箱</span>
          {inboxOpen ? (
            <ChevronUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
        </button>
        {inboxOpen && (
          <div className="mb-2 rounded-lg border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
            <ProjectInbox projectKey={activeProject.key} />
          </div>
        )}
      </div>

      <FlowEditor
        key={activeProject.key}
        projectKey={activeProject.key}
        projectName={activeProject.name}
        projectDescription={activeProject.description}
        projectEntry={activeProject}
        initialHighlight={highlight}
        onProjectUpdated={handleProjectUpdated}
        onProjectDeleted={handleProjectDeleted}
      />
    </>
  );
}

export default function ProjectsPage() {
  return (
    <Suspense>
      <ProjectsPageInner />
    </Suspense>
  );
}
