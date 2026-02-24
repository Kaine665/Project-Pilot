'use client';

import { use } from 'react';
import { TaskDetail } from '@/components/task-detail';
import { usePanelContext } from '@/lib/panel-context';

export default function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { artifactOpen } = usePanelContext();

  return <TaskDetail taskId={id} artifactOpen={artifactOpen} />;
}
