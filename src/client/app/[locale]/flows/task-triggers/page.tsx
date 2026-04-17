'use client';

import { useOutletContext } from 'react-router';
import { TaskTriggersPanel } from '@/components/task-triggers-panel';
import type { TasksWorkspaceOutletContext } from '@/app/[locale]/flows/tasks/layout';

export default function TaskTriggersPage() {
  const ctx = useOutletContext<Partial<TasksWorkspaceOutletContext> | undefined>();
  return <TaskTriggersPanel tasksHub={ctx?.tasksHub === true} />;
}
