'use client';

import { Suspense } from 'react';
import { ProjectsManagementHub } from '@/components/projects-management-hub';

function ProjectsPageInner() {
  return <ProjectsManagementHub />;
}

function ProjectsLoading() {
  return (
    <div className="flex h-full min-h-[50vh] items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
    </div>
  );
}

export default function ProjectsPage() {
  return (
    <Suspense fallback={<ProjectsLoading />}>
      <ProjectsPageInner />
    </Suspense>
  );
}
