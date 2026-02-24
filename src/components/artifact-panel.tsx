'use client';

import { useState } from 'react';
import {
  ClipboardList,
  FileText,
  Package,
  RotateCcw,
  GitMerge,
  GitBranch,
  Trash2,
  Loader2,
  MessageSquare,
  ListTodo,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import type { Task, TaskUnderstanding, TaskResult, AIPlan } from '@/types';

interface ArtifactPanelProps {
  task: Task;
  onSaveTask: (updates: Partial<Task>) => void;
  understanding?: TaskUnderstanding | null;
  plan?: AIPlan | null;
  result?: TaskResult | null;
  gitBranch?: string | null;
  onSendMessage: (text: string) => void;
  onMerge: () => void;
  onDiscardBranch: () => void;
  mergeLoading?: boolean;
}

const statusLabels: Record<string, string> = {
  todo: '待办',
  doing: '进行中',
  done: '已完成',
};

export function ArtifactPanel({
  task,
  onSaveTask,
  understanding,
  plan,
  result,
  gitBranch,
  onSendMessage,
  onMerge,
  onDiscardBranch,
  mergeLoading,
}: ArtifactPanelProps) {
  const hasArtifacts = understanding || plan || result;

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-3">
      {/* Task Info Card — always first */}
      <ArtifactCard
        icon={<ListTodo className="h-4 w-4" />}
        title={task.title}
      >
        {/* Status toggle */}
        {(() => {
          const awaitingConfirm = !!result && result.status === 'completed' && task.status !== 'done';
          return (
            <div className="flex rounded-md border border-zinc-200 dark:border-zinc-700 overflow-hidden">
              {(['todo', 'doing', 'done'] as const).map((s) => {
                const isActive = task.status === s;
                // When awaiting confirmation, the active "doing" button blinks blue↔green
                const blinking = awaitingConfirm && isActive && s === 'doing';
                return (
                  <button
                    key={s}
                    onClick={() => onSaveTask({ status: s })}
                    className={`flex-1 px-3 py-1.5 text-xs font-medium transition-colors ${
                      blinking
                        ? 'animate-blink-confirm text-white'
                        : isActive
                          ? s === 'done'
                            ? 'bg-green-600 text-white dark:bg-green-500 dark:text-white'
                            : s === 'doing'
                            ? 'bg-blue-600 text-white dark:bg-blue-500 dark:text-white'
                            : 'bg-zinc-700 text-white dark:bg-zinc-300 dark:text-zinc-900'
                          : 'bg-white text-zinc-500 hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800'
                    }`}
                  >
                    {statusLabels[s]}
                  </button>
                );
              })}
            </div>
          );
        })()}

      </ArtifactCard>

      {/* Git Branch Indicator — shown once branch is created (Phase 0 onward) */}
      {gitBranch && !result && (
        <div className="flex items-center gap-2 rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-2 dark:border-cyan-900/40 dark:bg-cyan-950/20">
          <GitBranch className="h-3.5 w-3.5 shrink-0 text-cyan-600 dark:text-cyan-400" />
          <span className="text-xs text-cyan-700 dark:text-cyan-300">
            当前分支：<code className="font-semibold">{gitBranch}</code>
          </span>
        </div>
      )}

      {/* Guide when no artifacts yet */}
      {!hasArtifacts && !gitBranch && (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-center text-zinc-400">
          <MessageSquare className="h-8 w-8 stroke-1" />
          <p className="text-xs leading-relaxed">
            发送消息开始任务流程
            <br />
            AI 会自动理解任务、制定计划、执行并报告结果
          </p>
        </div>
      )}
      {/* Understanding Card */}
      {understanding && (
        <ArtifactCard
          icon={<ClipboardList className="h-4 w-4" />}
          title="任务理解"
          collapsible
        >
          <div className="space-y-1.5 text-xs">
            <Field label="项目" value={understanding.project} />
            <Field label="做什么" value={understanding.action} />
            <Field label="为什么" value={understanding.goal} />
            <Field label="交付物" value={understanding.deliverable} />
          </div>
          <CardActions>
            <SmallButton
              icon={<RotateCcw className="h-3 w-3" />}
              label="重新理解"
              onClick={() => onSendMessage('请重新分析这个任务，重新确认四要素。')}
            />
          </CardActions>
        </ArtifactCard>
      )}

      {/* Plan Card */}
      {plan && (
        <ArtifactCard
          icon={<FileText className="h-4 w-4" />}
          title={`执行计划 v${plan.version}`}
          badge={plan.status === 'pending_approval' ? '待确认' : undefined}
          collapsible
        >
          <div className="space-y-1 text-xs">
            {plan.steps.map((step) => (
              <div key={step.id} className="flex items-start gap-1.5">
                <span className="mt-0.5 shrink-0">
                  {step.status === 'completed' ? '✅' :
                   step.status === 'running' ? '🔄' :
                   step.status === 'failed' ? '❌' : '□'}
                </span>
                <span className={step.status === 'completed' ? 'text-zinc-400 line-through' : ''}>
                  {step.action}
                </span>
              </div>
            ))}
          </div>
          {plan.risks && (
            <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
              风险：{plan.risks}
            </p>
          )}
          <CardActions>
            <SmallButton
              icon={<RotateCcw className="h-3 w-3" />}
              label="重新规划"
              onClick={() => onSendMessage('请重新制定执行计划。')}
            />
          </CardActions>
        </ArtifactCard>
      )}

      {/* Execution Status / Result Card */}
      {result ? (
        <ArtifactCard
          icon={<Package className="h-4 w-4" />}
          title={result.status === 'completed' ? '执行完成' : result.status === 'failed' ? '执行失败' : '部分完成'}
          variant={result.status === 'completed' ? 'success' : result.status === 'failed' ? 'error' : 'warning'}
          collapsible
        >
          {gitBranch && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              分支：<code className="text-green-600 dark:text-green-400">{gitBranch}</code>
            </p>
          )}
          <p className="text-xs">{result.summary}</p>
          {result.files_changed && result.files_changed.length > 0 && (
            <div className="mt-2 space-y-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              <p className="font-medium text-zinc-700 dark:text-zinc-300">
                改动文件（{result.files_changed.length}）：
              </p>
              {result.files_changed.map((f, i) => (
                <div key={i} className="flex items-center gap-1 font-mono">
                  <span>{f.action === 'created' ? '+' : f.action === 'deleted' ? '-' : '~'}</span>
                  <span className="truncate">{f.path.split('/').pop()}</span>
                </div>
              ))}
            </div>
          )}
          {gitBranch && result.status === 'completed' && (
            <CardActions>
              <SmallButton
                icon={mergeLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <GitMerge className="h-3 w-3" />}
                label="合并分支"
                onClick={onMerge}
                variant="success"
                disabled={mergeLoading}
              />
              <SmallButton
                icon={<Trash2 className="h-3 w-3" />}
                label="放弃分支"
                onClick={onDiscardBranch}
                variant="danger"
                disabled={mergeLoading}
              />
            </CardActions>
          )}
        </ArtifactCard>
      ) : gitBranch ? (
        <ArtifactCard
          icon={<Package className="h-4 w-4" />}
          title="执行中"
          variant="active"
          collapsible
        >
          <div className="text-xs text-zinc-500 dark:text-zinc-400">
            <p>
              分支：<code className="text-green-600 dark:text-green-400">{gitBranch}</code>
            </p>
            {plan && (
              <div className="mt-2 space-y-0.5">
                {plan.steps.map((step) => (
                  <div key={step.id} className="flex items-start gap-1.5">
                    <span className="mt-0.5 shrink-0">
                      {step.status === 'completed' ? '✅' :
                       step.status === 'running' ? '🔄' : '□'}
                    </span>
                    <span className={step.status === 'completed' ? 'text-zinc-400' : ''}>
                      {step.action}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </ArtifactCard>
      ) : null}
    </div>
  );
}

// ==================== Sub-components ====================

function ArtifactCard({
  icon,
  title,
  badge,
  variant,
  collapsible = false,
  defaultCollapsed = false,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  badge?: string;
  variant?: 'success' | 'error' | 'warning' | 'active';
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  children: React.ReactNode;
}) {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);

  const borderMap: Record<string, string> = {
    success: 'border-green-200 dark:border-green-900/40',
    error: 'border-red-200 dark:border-red-900/40',
    warning: 'border-amber-200 dark:border-amber-900/40',
    active: 'border-blue-200 dark:border-blue-900/40',
  };
  const borderClass = (variant && borderMap[variant]) ?? 'border-zinc-200 dark:border-zinc-800';

  const iconMap: Record<string, string> = {
    success: 'text-green-600 dark:text-green-400',
    error: 'text-red-600 dark:text-red-400',
    warning: 'text-amber-600 dark:text-amber-400',
    active: 'text-blue-600 dark:text-blue-400',
  };
  const iconClass = (variant && iconMap[variant]) ?? 'text-zinc-600 dark:text-zinc-400';

  return (
    <div className={`rounded-lg border bg-white p-3 dark:bg-zinc-900 ${borderClass}`}>
      <div className={`flex items-center gap-2 ${(!collapsible || !isCollapsed) ? 'mb-2' : ''}`}>
        <span className={iconClass}>{icon}</span>
        <span className="text-sm font-medium">{title}</span>
        {badge && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
            {badge}
          </span>
        )}
        {collapsible && (
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="ml-auto rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
            aria-label={isCollapsed ? '展开' : '折叠'}
          >
            {isCollapsed ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronUp className="h-4 w-4" />
            )}
          </button>
        )}
      </div>
      {(!collapsible || !isCollapsed) && children}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-zinc-400">{label}：</span>
      <span className="text-zinc-700 dark:text-zinc-300">{value}</span>
    </div>
  );
}

function CardActions({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-zinc-100 pt-2 dark:border-zinc-800">
      {children}
    </div>
  );
}

function SmallButton({
  icon,
  label,
  onClick,
  variant,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  variant?: 'success' | 'danger';
  disabled?: boolean;
}) {
  const colorClass = variant === 'success'
    ? 'text-green-600 hover:bg-green-50 dark:text-green-400 dark:hover:bg-green-950/30'
    : variant === 'danger'
    ? 'text-red-500 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30'
    : 'text-zinc-500 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-800';

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors disabled:opacity-50 ${colorClass}`}
    >
      {icon}
      {label}
    </button>
  );
}
