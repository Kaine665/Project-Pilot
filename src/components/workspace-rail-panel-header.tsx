'use client';

import * as React from 'react';
import type { ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * 侧栏面板统一文件夹头。
 *
 * - `variant="section"` — 顶层文件夹（h-8，带底线，用于 Rail 大区块）
 * - `variant="group"`   — 子级文件夹（h-7，无底线，用于区块内部分组）
 */
export function WorkspaceRailPanelHeader({
  title,
  icon,
  actions,
  collapsed,
  onToggleCollapsed,
  toggleTitle,
  variant = 'section',
  className: outerClassName,
}: {
  title: string;
  icon?: ReactNode;
  actions?: ReactNode;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  toggleTitle: string;
  variant?: 'section' | 'group';
  className?: string;
}) {
  const isSection = variant === 'section';

  return (
    <div
      data-state={collapsed ? 'collapsed' : 'expanded'}
      data-variant={variant}
      className={cn(
        'flex shrink-0 items-center gap-0.5',
        isSection
          ? cn(
              'h-8 border-b px-1.5',
              collapsed
                ? 'border-border/70 bg-muted/60'
                : 'border-border/40 bg-muted/40',
            )
          : cn('h-7 px-1'),
        outerClassName,
      )}
    >
      <button
        type="button"
        onClick={onToggleCollapsed}
        aria-expanded={!collapsed}
        title={toggleTitle}
        aria-label={`${title} — ${toggleTitle}`}
        className={cn(
          'flex min-w-0 flex-1 items-center gap-1 rounded-md text-left transition-colors',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
          'hover:bg-accent/50',
          isSection ? 'gap-1.5 py-0.5 pl-0.5 pr-1' : 'gap-1 py-px pl-0.5 pr-0.5',
        )}
      >
        <span
          aria-hidden
          className={cn(
            'inline-flex shrink-0 items-center justify-center text-muted-foreground/70',
            isSection ? 'h-5 w-5' : 'h-4 w-4',
          )}
        >
          {collapsed
            ? <ChevronRight className={isSection ? 'h-3.5 w-3.5' : 'h-3 w-3'} strokeWidth={2} />
            : <ChevronDown className={isSection ? 'h-3.5 w-3.5' : 'h-3 w-3'} strokeWidth={2} />}
        </span>
        {icon ? (
          <span className={cn(
            'flex shrink-0 items-center',
            isSection ? 'text-muted-foreground/70' : 'text-muted-foreground/60',
          )}>
            {icon}
          </span>
        ) : null}
        <span
          className={cn(
            'min-w-0 flex-1 truncate font-semibold text-muted-foreground',
            isSection ? 'text-[11px]' : 'text-[10.5px]',
          )}
        >
          {title}
        </span>
      </button>
      {!collapsed && actions ? (
        <div className="flex min-w-0 shrink-0 items-center justify-end gap-0.5">{actions}</div>
      ) : null}
    </div>
  );
}

/**
 * 上下区域之间的隐形拖拽分隔条。
 * 默认只有 1px 细线，hover/拖拽时高亮为主题色带，
 * 用一个更宽的不可见 hit-area 保证容易点中。
 */
export const WorkspaceRailResizeHandle = React.forwardRef<
  HTMLButtonElement,
  {
    disabled?: boolean;
    dragging?: boolean;
    onResizeStart: (event: React.PointerEvent<HTMLButtonElement>) => void;
    className?: string;
  }
>(({ disabled, dragging, onResizeStart, className }, ref) => (
  <button
    ref={ref}
    type="button"
    data-rail-resize-handle
    aria-orientation="horizontal"
    aria-disabled={disabled}
    disabled={disabled}
    onPointerDown={disabled ? undefined : onResizeStart}
    className={cn(
      'group relative z-10 flex h-0 w-full shrink-0 touch-none items-center justify-center border-0 outline-none select-none',
      disabled ? 'cursor-default' : 'cursor-row-resize',
      className,
    )}
  >
    {/* invisible hit-area — 14px tall for easy grab */}
    <span className="pointer-events-auto absolute inset-x-0 -top-[7px] h-[14px]" />
    {/* visible line — thickens + changes color on hover / drag */}
    <span
      className={cn(
        'pointer-events-none absolute inset-x-0 -top-px transition-all duration-100',
        disabled
          ? 'h-px bg-border/30'
          : dragging
            ? 'h-[3px] bg-primary/50'
            : 'h-px bg-border/60 group-hover:h-[3px] group-hover:bg-primary/40',
      )}
    />
  </button>
));
WorkspaceRailResizeHandle.displayName = 'WorkspaceRailResizeHandle';
