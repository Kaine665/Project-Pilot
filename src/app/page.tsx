'use client';

import { useState } from 'react';
import { TaskList } from '@/components/task-list';
import { TaskDetail } from '@/components/task-detail';
import { ProjectRegistry } from '@/components/project-registry';
import { Bot } from 'lucide-react';

export default function Home() {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      {/* Top bar */}
      <header className="flex shrink-0 items-center justify-between border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
        <div className="flex items-center gap-2">
          <Bot className="h-5 w-5 text-zinc-700 dark:text-zinc-300" />
          <h1 className="text-sm font-semibold">Task Agent</h1>
        </div>
        <ProjectRegistry />
      </header>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar */}
        <aside className="w-72 shrink-0 border-r border-zinc-200 dark:border-zinc-800">
          <TaskList selectedTaskId={selectedTaskId} onSelect={setSelectedTaskId} />
        </aside>

        {/* Right panel */}
        <main className="flex-1 overflow-hidden">
          <TaskDetail taskId={selectedTaskId} />
        </main>
      </div>
    </div>
  );
}
