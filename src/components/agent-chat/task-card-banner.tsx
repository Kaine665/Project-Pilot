'use client';

import { useState } from 'react';
import {
  ClipboardList,
  Code2,
  FlaskConical,
  GitMerge,
  CheckCircle2,
  MessageCircle,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import type { TaskCard, TaskCardStage } from '@/lib/task-card-store';

interface TaskCardBannerProps {
  card: TaskCard;
  className?: string;
}

const STAGE_CONFIG: Record<TaskCardStage, {
  icon: typeof ClipboardList;
  label: string;
  color: string;
  bgColor: string;
}> = {
  planning: {
    icon: ClipboardList,
    label: '规划中',
    color: 'text-blue-600 dark:text-blue-400',
    bgColor: 'bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800',
  },
  developing: {
    icon: Code2,
    label: '开发中',
    color: 'text-amber-600 dark:text-amber-400',
    bgColor: 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800',
  },
  testing: {
    icon: FlaskConical,
    label: '测试中',
    color: 'text-purple-600 dark:text-purple-400',
    bgColor: 'bg-purple-50 dark:bg-purple-950/30 border-purple-200 dark:border-purple-800',
  },
  merging: {
    icon: GitMerge,
    label: '合并中',
    color: 'text-green-600 dark:text-green-400',
    bgColor: 'bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800',
  },
  done: {
    icon: CheckCircle2,
    label: '已完成',
    color: 'text-emerald-600 dark:text-emerald-400',
    bgColor: 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800',
  },
  discussing: {
    icon: MessageCircle,
    label: '讨论中',
    color: 'text-zinc-600 dark:text-zinc-400',
    bgColor: 'bg-zinc-50 dark:bg-zinc-900/50 border-zinc-200 dark:border-zinc-700',
  },
};

export function TaskCardBanner({ card, className = '' }: TaskCardBannerProps) {
  const [expanded, setExpanded] = useState(true);

  const stageConf = STAGE_CONFIG[card.stage] ?? STAGE_CONFIG.discussing;
  const Icon = stageConf.icon;

  return (
    <div
      className={`sticky top-0 z-10 mx-1 mb-2 rounded-lg border ${stageConf.bgColor} transition-all ${className}`}
    >
      {/* Header — always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <Icon className={`h-4 w-4 shrink-0 ${stageConf.color}`} />
        <span className="flex-1 truncate text-sm font-medium text-zinc-800 dark:text-zinc-200">
          {card.title}
        </span>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${stageConf.color} bg-white/60 dark:bg-zinc-800/60`}>
          {stageConf.label}
        </span>
        {expanded
          ? <ChevronUp className="h-3 w-3 shrink-0 text-zinc-400" />
          : <ChevronDown className="h-3 w-3 shrink-0 text-zinc-400" />
        }
      </button>

      {/* Details — collapsible */}
      {expanded && (
        <div className="border-t border-inherit px-3 pb-2 pt-1.5">
          <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
            {card.summary}
          </p>

          {card.executor && (
            <div className="mt-1.5 flex items-center gap-1 text-[10px] text-zinc-500 dark:text-zinc-500">
              <span>执行者: {card.executor}</span>
            </div>
          )}

          {card.scope && card.scope.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {card.scope.slice(0, 3).map((s) => (
                <span
                  key={s}
                  className="inline-block rounded bg-zinc-200/60 px-1.5 py-0.5 text-[10px] font-mono text-zinc-600 dark:bg-zinc-700/40 dark:text-zinc-400"
                >
                  {s.split('/').pop()}
                </span>
              ))}
              {card.scope.length > 3 && (
                <span className="text-[10px] text-zinc-400">+{card.scope.length - 3}</span>
              )}
            </div>
          )}

          {card.blockers && card.blockers.length > 0 && (
            <div className="mt-1.5 text-[10px] text-red-500 dark:text-red-400">
              ⚠ {card.blockers.join('; ')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
