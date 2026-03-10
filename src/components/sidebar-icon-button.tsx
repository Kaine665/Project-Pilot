'use client';

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { LucideIcon } from 'lucide-react';

interface SidebarIconButtonProps {
  icon: LucideIcon;
  tooltip: string;
  isActive: boolean;
  onClick: () => void;
}

export function SidebarIconButton({ icon: Icon, tooltip, isActive, onClick }: SidebarIconButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          className={`flex h-11 w-11 items-center justify-center rounded-md transition-colors ${
            isActive
              ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
              : 'text-zinc-500 hover:bg-zinc-200 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-200'
          }`}
          onClick={onClick}
        >
          <Icon className="h-5 w-5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{tooltip}</TooltipContent>
    </Tooltip>
  );
}
