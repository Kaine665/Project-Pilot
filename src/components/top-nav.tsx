'use client';

import type { CSSProperties } from 'react';
import { useTranslations } from '@/client/i18n/use-translations';
import { ProjectSwitcher } from '@/components/project-switcher';
import { cn } from '@/lib/utils';

export function TopNav({
  children,
  workspaceSidebarMini,
  onToggleWorkspaceSidebar,
  titleBarInsetPx = 0,
}: {
  children?: React.ReactNode;
  /** 桌面：左侧轨是否已完全隐藏；移动：抽屉是否关闭。与 onToggleWorkspaceSidebar 同时传入时显示顶栏切换钮 */
  workspaceSidebarMini?: boolean;
  onToggleWorkspaceSidebar?: () => void;
  /** Win/Linux Electron：`ElectronTitleBar` 已含侧栏切换时不再重复 */
  titleBarInsetPx?: number;
}) {
  const tr = useTranslations('workspaceSidebarRail');
  const showSidebarToggle =
    typeof workspaceSidebarMini === 'boolean' &&
    typeof onToggleWorkspaceSidebar === 'function' &&
    titleBarInsetPx <= 0;

  /** Electron 无边框窗：空白处拖动；与 `ElectronTitleBar` 一致 */
  const dragStyle = { WebkitAppRegion: 'drag' } as CSSProperties;
  const noDragStyle = { WebkitAppRegion: 'no-drag' } as CSSProperties;

  const electronChrome = titleBarInsetPx > 0;

  // 三列 `1fr / auto / 1fr`：中间项目切换在顶栏几何居中，左右工具区宽度不等时也不偏移（Electron 无 WCO 顶栏同理）。
  // Electron 有 `titleBarOverlay` 时本组件通常不挂载；若挂载则勿在整段 header 上 `drag`（Windows 非客户区问题）。
  return (
    <header
      className={cn(
        'relative grid shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-2 bg-white px-4 py-1 sm:px-6 dark:bg-zinc-950 sm:gap-3',
        electronChrome
          ? 'border-zinc-200 dark:border-zinc-800'
          : 'border-b border-zinc-200 dark:border-zinc-800',
      )}
      style={electronChrome ? noDragStyle : dragStyle}
    >
      <div className="relative z-10 flex min-w-0 items-center justify-start" style={noDragStyle}>
        {showSidebarToggle ? (
          <button
            type="button"
            style={noDragStyle}
            onClick={onToggleWorkspaceSidebar}
            className={cn(
              'flex h-8 shrink-0 items-center justify-center whitespace-nowrap rounded-md border border-zinc-200 bg-white px-2.5 text-xs font-medium text-zinc-600 shadow-sm',
              'transition-all hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-900',
              'active:scale-[0.97] active:border-zinc-300 active:bg-zinc-100',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 focus-visible:ring-offset-2',
              'dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300',
              'dark:hover:border-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-100',
              'dark:active:bg-zinc-800 dark:focus-visible:ring-zinc-500 dark:ring-offset-zinc-950',
            )}
            aria-label={workspaceSidebarMini ? tr('expandGuide') : tr('collapseGuide')}
            title={workspaceSidebarMini ? tr('expandGuide') : tr('collapseGuide')}
          >
            {workspaceSidebarMini ? tr('toggleSidebarExpand') : tr('toggleSidebarCollapse')}
          </button>
        ) : (
          <div className="h-8 w-8 shrink-0" aria-hidden />
        )}
      </div>
      <div
        className="relative z-10 flex min-w-0 max-w-[min(42vw,20rem)] shrink items-center justify-center justify-self-center px-1 sm:px-2"
        style={noDragStyle}
      >
        <ProjectSwitcher />
      </div>
      <div className="relative z-10 flex min-w-0 items-center justify-end gap-3" style={noDragStyle}>
        {children}
      </div>
    </header>
  );
}
