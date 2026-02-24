'use client';

import { memo } from 'react';
import { AlertTriangle, ShieldX, X } from 'lucide-react';
import type { DangerLevel } from '@/types';

interface DangerWarningProps {
  command: string;
  reason: string;
  level: DangerLevel;
  onDismiss: () => void;
}

/**
 * Warning banner shown when AI executes a dangerous command.
 * 'critical' = red, process was auto-stopped.
 * 'warning'  = orange, notification only.
 */
export const DangerWarning = memo(function DangerWarning({ command, reason, level, onDismiss }: DangerWarningProps) {
  const isCritical = level === 'critical';

  // Parse the command for display
  let displayCommand = command;
  try {
    const parsed = JSON.parse(command);
    displayCommand = parsed.command || parsed.cmd || command;
  } catch {
    // Raw string
  }
  if (displayCommand.length > 120) {
    displayCommand = displayCommand.slice(0, 120) + '...';
  }

  return (
    <div className={`mx-3 mt-2 rounded-lg border px-4 py-3 ${
      isCritical
        ? 'border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/30'
        : 'border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30'
    }`}>
      <div className="flex items-start gap-2">
        {isCritical
          ? <ShieldX className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
          : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
        }
        <div className="flex-1 min-w-0">
          <div className={`text-xs font-medium ${
            isCritical ? 'text-red-800 dark:text-red-200' : 'text-amber-800 dark:text-amber-200'
          }`}>
            {isCritical ? '危险操作已自动拦截' : '检测到敏感操作'}
          </div>
          <div className={`mt-0.5 text-xs ${
            isCritical ? 'text-red-700 dark:text-red-300' : 'text-amber-700 dark:text-amber-300'
          }`}>
            {reason}
          </div>
          <code className={`mt-1 block truncate rounded px-1.5 py-0.5 text-[10px] ${
            isCritical
              ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'
              : 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400'
          }`}>
            {displayCommand}
          </code>
          {isCritical && (
            <div className="mt-1.5 text-[10px] text-red-600 dark:text-red-400">
              进程已停止。如需继续，请发送消息恢复会话。
            </div>
          )}
        </div>
        <button
          onClick={onDismiss}
          className="shrink-0 rounded p-0.5 text-zinc-400 transition-colors hover:text-zinc-600 dark:hover:text-zinc-300"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
});
