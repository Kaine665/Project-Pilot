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
          className={`flex h-10 w-10 items-center justify-center rounded-lg transition-all ${
            isActive
              ? 'bg-zinc-900 text-white shadow-md shadow-zinc-200 dark:bg-zinc-100 dark:text-zinc-900 dark:shadow-zinc-800'
              : 'text-zinc-400 hover:bg-white hover:text-zinc-900 hover:shadow-sm dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-200'
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
