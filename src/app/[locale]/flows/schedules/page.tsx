'use client';

import { useOutletContext } from 'react-router';
import { AgentSchedulesPanel } from '@/components/agent-schedules-panel';
import type { TasksWorkspaceOutletContext } from '@/app/[locale]/flows/tasks/layout';

export default function SchedulesPage() {
  const ctx = useOutletContext<Partial<TasksWorkspaceOutletContext> | undefined>();
  return <AgentSchedulesPanel showPageHeader={ctx?.tasksHub !== true} />;
}
