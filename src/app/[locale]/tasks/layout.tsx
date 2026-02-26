'use client';

import { TaskList } from '@/components/task-list';
import { ProjectRegistry } from '@/components/project-registry';
import { PanelContext } from '@/lib/panel-context';
import { TopNav } from '@/components/top-nav';

export default function TasksLayout({ children }: { children: React.ReactNode }) {
  return (
    <PanelContext.Provider value={{ artifactOpen: true, setArtifactOpen: () => {} }}>
      <div className="flex h-screen flex-col overflow-hidden">
        {/* Top bar */}
        <TopNav>
          <ProjectRegistry />
        </TopNav>

        {/* Main content */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left sidebar */}
          <aside className="w-72 shrink-0 border-r border-zinc-200 dark:border-zinc-800">
            <div className="h-full w-72">
              <TaskList />
            </div>
          </aside>

          {/* Right panel */}
          <main className="flex-1 overflow-hidden">
            {children}
          </main>
        </div>
      </div>
    </PanelContext.Provider>
  );
}
