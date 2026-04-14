'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Agents 工作区右侧主面板：各入口共用的顶栏标题 + 可滚动正文区 */
export function AgentsRailPanelFrame({
  title,
  hideHeader,
  children,
  className,
}: {
  title: string;
  /** 标题已由外层渲染时置 true（例如 Agent 数据 / 提示词 / 能力 共用顶栏） */
  hideHeader?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden', className)}>
      {!hideHeader ? (
        <header className="shrink-0 border-b border-border/80 bg-muted/30 px-3 py-2 dark:bg-muted/20">
          <h2
            id="agents-rail-panel-title"
            className="truncate text-xs font-semibold leading-tight tracking-tight text-foreground"
          >
            {title}
          </h2>
        </header>
      ) : null}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{children}</div>
    </div>
  );
}
