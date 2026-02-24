'use client';

import { useState } from 'react';
import { TaskList } from '@/components/task-list';
import { ProjectRegistry } from '@/components/project-registry';
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PanelContext } from '@/lib/panel-context';
import { TopNav } from '@/components/top-nav';
import { cn } from '@/lib/utils';

export default function TasksLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [artifactOpen, setArtifactOpen] = useState(true);

  return (
    <PanelContext.Provider value={{ artifactOpen, setArtifactOpen }}>
      <div className="flex h-screen flex-col overflow-hidden">
        {/* Top bar */}
        <TopNav>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            title={sidebarOpen ? '收起侧栏' : '展开侧栏'}
          >
            {sidebarOpen ? (
              <PanelLeftClose className="h-4 w-4" />
            ) : (
              <PanelLeftOpen className="h-4 w-4" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setArtifactOpen(!artifactOpen)}
            title={artifactOpen ? '收起产出物面板' : '展开产出物面板'}
          >
            {artifactOpen ? (
              <PanelRightClose className="h-4 w-4" />
            ) : (
              <PanelRightOpen className="h-4 w-4" />
            )}
          </Button>
          <ProjectRegistry />
        </TopNav>

        {/* Main content */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left sidebar */}
          <aside
            className={cn(
              'shrink-0 overflow-hidden border-r border-zinc-200 transition-[width] duration-200 ease-in-out dark:border-zinc-800',
              sidebarOpen ? 'w-72' : 'w-0 border-r-0',
            )}
          >
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
