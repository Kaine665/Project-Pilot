'use client';

import type { CSSProperties } from 'react';
import { ChevronsLeft, ChevronsRight } from 'lucide-react';
import { useTranslations } from '@/client/i18n/use-translations';
import { cn } from '@/lib/utils';

/** 与 `titleBarOverlay` 同高条内右侧系统按钮（最小化/最大化/关闭）错开，避免被 `drag` 整行盖住 */
const ELECTRON_WCO_RIGHT_RESERVE_PX = 138;

/** Win/Linux Electron：系统标题区由 titleBarOverlay 绘制；本条为侧栏切换 + 拖拽带；`dragOnly` 时仅保留拖拽（系统最小化/最大化/关闭仍在右上角） */
export function ElectronTitleBar({
  heightPx,
  workspaceSidebarMini,
  onToggleWorkspaceSidebar,
  dragOnly = false,
}: {
  heightPx: number;
  /** 桌面：左侧轨已完全隐藏时为 true（显示「展开」）；移动：抽屉关闭 */
  workspaceSidebarMini: boolean;
  onToggleWorkspaceSidebar: () => void;
  /** 工作区沉浸：隐藏 `>>` 切换钮，整行为拖拽区，与系统窗口按钮同一顶带 */
  dragOnly?: boolean;
}) {
  const tr = useTranslations('workspaceSidebarRail');
  const tNav = useTranslations('nav');

  const dragStyle = { WebkitAppRegion: 'drag' } as CSSProperties;
  const noDragStyle = { WebkitAppRegion: 'no-drag' } as CSSProperties;

  return (
    <>
      <div
        className="fixed left-0 right-0 z-[120] bg-white dark:bg-zinc-950"
        style={{
          top: 0,
          height: heightPx,
        }}
      >
        <div className="flex h-full min-h-0 min-w-0 items-stretch gap-1.5 px-2.5">
          {dragOnly ? null : (
            <button
              type="button"
              onClick={onToggleWorkspaceSidebar}
              className={cn(
                'self-center flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-600 shadow-sm',
                'transition-all hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-900',
                'active:scale-[0.97] active:border-zinc-300 active:bg-zinc-100',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 focus-visible:ring-offset-2',
                'dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300',
                'dark:hover:border-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-100',
                'dark:active:bg-zinc-800 dark:focus-visible:ring-zinc-500 dark:ring-offset-zinc-950',
              )}
              style={noDragStyle}
              aria-label={workspaceSidebarMini ? tr('expandGuide') : tr('collapseGuide')}
              title={workspaceSidebarMini ? tr('expandGuide') : tr('collapseGuide')}
            >
              {workspaceSidebarMini ? (
                <ChevronsRight className="h-3.5 w-3.5" aria-hidden />
              ) : (
                <ChevronsLeft className="h-3.5 w-3.5" aria-hidden />
              )}
            </button>
          )}
          <div className="relative min-h-0 min-w-0 flex-1 self-stretch">
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center px-2">
              <span className="max-w-full truncate text-sm font-semibold leading-none tracking-tight text-zinc-800 dark:text-zinc-100">
                {tNav('appName')}
              </span>
            </div>
            <div className="absolute inset-0 z-0 min-h-0 min-w-0" style={dragStyle} aria-hidden />
          </div>
          <div
            className="shrink-0 self-stretch bg-white dark:bg-zinc-950"
            style={{ width: ELECTRON_WCO_RIGHT_RESERVE_PX, ...noDragStyle }}
            aria-hidden
          />
        </div>
      </div>
      {/* WCO 系统叠层覆盖到 y=heightPx（含），所以线画在 heightPx+1 才不被遮挡 */}
      <div
        className="pointer-events-none fixed left-0 right-0 z-[120] h-px bg-zinc-200 dark:bg-zinc-800"
        style={{ top: heightPx + 1 }}
        aria-hidden
      />
    </>
  );
}
