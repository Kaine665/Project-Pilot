'use client';

import { Suspense } from 'react';
import { ProjectsManagementHub } from '@/components/projects-management-hub';

function ProjectsPageInner() {
  return <ProjectsManagementHub />;
}

export default function ProjectsPage() {
  return (
    <Suspense>
      <ProjectsPageInner />
    </Suspense>
  );
}
