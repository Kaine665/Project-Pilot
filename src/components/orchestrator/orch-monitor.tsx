'use client';

import { useState, useCallback, useMemo } from 'react';
import {
  CheckCircle2, XCircle, Circle, Loader2, Square,
  ChevronDown, ChevronRight, GitBranch, AlertTriangle, RotateCcw,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useOrchestratorStream } from '@/hooks/use-orchestrator-stream';
import type { OrchestratorPhase, SplitPlan, WorkerResult } from '@/types/orchestrator';

interface OrchMonitorProps {
  orchId: string;
  onStop?: () => void;
  /** 重新发起编排（复用 prompt） */
  onRelaunch?: (prompt: string) => void;
  /** 当前编排的原始 prompt */
  originalPrompt?: string;
}

const PHASE_ORDER: OrchestratorPhase[] = [
  'pending', 'splitting', 'spawning', 'executing', 'synthesizing', 'merging', 'completed',
];

export function OrchMonitor({ orchId, onStop, onRelaunch, originalPrompt }: OrchMonitorProps) {
  const t = useTranslations('orchestrator');
  const { events, phase, isConnected } = useOrchestratorStream(orchId);

  // 从事件中提取关键数据
  const splitPlan = useMemo(() => {
    const evt = events.find(e => e.type === 'orch_split_completed');
    return evt?.type === 'orch_split_completed' ? evt.plan : null;
  }, [events]);

  const workerStates = useMemo(() => {
    const states = new Map<string, { title: string; status: string; result?: WorkerResult; error?: string; eventCount: number }>();
    for (const e of events) {
      if (e.type === 'worker_started') {
        states.set(e.workerId, { title: e.title, status: 'running', eventCount: 0 });
      } else if (e.type === 'worker_completed') {
        const prev = states.get(e.workerId);
        if (prev) states.set(e.workerId, { ...prev, status: 'completed', result: e.result });
      } else if (e.type === 'worker_failed') {
        const prev = states.get(e.workerId);
        if (prev) states.set(e.workerId, { ...prev, status: 'failed', error: e.error });
      } else if (e.type === 'worker_event') {
        const prev = states.get(e.workerId);
        if (prev) states.set(e.workerId, { ...prev, eventCount: prev.eventCount + 1 });
      }
    }
    return states;
  }, [events]);

  const synthesisResult = useMemo(() => {
    const evt = events.find(e => e.type === 'orch_synthesis_completed');
    return evt?.type === 'orch_synthesis_completed' ? evt.summary : null;
  }, [events]);

  // 合并结果
  const mergedBranches = useMemo(() => {
    const evt = events.find(e => e.type === 'orch_merge_completed');
    return evt?.type === 'orch_merge_completed' ? evt.branches : null;
  }, [events]);

  // 收集所有错误事件
  const errorEvents = useMemo(() => {
    return events.filter(e => e.type === 'orch_error').map(e => e.type === 'orch_error' ? e.message : '');
  }, [events]);

  const lastError = errorEvents.length > 0 ? errorEvents[errorEvents.length - 1] : null;

  const isDone = phase === 'completed' || phase === 'failed';
  const needsSplitConfirm = phase === 'splitting' && splitPlan !== null;
  // 后端在 synthesizing 阶段等 confirmMerge，综合完成后才能确认合并
  const needsMergeConfirm = phase === 'synthesizing' && synthesisResult !== null;

  const handleAction = useCallback(async (action: string) => {
    try {
      await fetch(`/api/orchestrator/${orchId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
    } catch { /* ignore */ }
  }, [orchId]);

  return (
    <div className="flex h-full flex-col">
      {/* 滚动内容区 */}
      <div className="flex-1 overflow-y-auto space-y-6 pb-4">
        {/* 状态栏 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={`inline-block h-2 w-2 rounded-full ${isConnected ? 'bg-green-500' : isDone ? 'bg-zinc-300' : 'bg-amber-400 animate-pulse'}`} />
            <span className="text-xs text-zinc-500">{isConnected ? t('connected') : t('disconnected')}</span>
            <span className="text-xs text-zinc-400">|</span>
            <span className="text-xs text-zinc-500">{t('eventCount', { count: events.length })}</span>
          </div>
        </div>

        {/* 阶段进度 */}
        <PhaseIndicator currentPhase={phase} />

        {/* 错误信息 */}
        {lastError && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span className="font-medium">错误</span>
            </div>
            {lastError}
            {errorEvents.length > 1 && (
              <p className="text-xs mt-2 text-red-500">共 {errorEvents.length} 个错误</p>
            )}
          </div>
        )}

        {/* Split Plan 展示 */}
        {splitPlan && <SplitPlanView plan={splitPlan} needsConfirm={needsSplitConfirm} onConfirm={() => handleAction('confirm-split')} />}

        {/* Worker 卡片 */}
        {workerStates.size > 0 && (
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('workers')}</h3>
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
              {Array.from(workerStates.entries()).map(([id, w]) => (
                <WorkerCard key={id} workerId={id} title={w.title} status={w.status} result={w.result} error={w.error} eventCount={w.eventCount} />
              ))}
            </div>
          </div>
        )}

        {/* 综合结果 */}
        {synthesisResult && (
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('synthesis')}</h3>
            <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm whitespace-pre-wrap dark:border-zinc-700 dark:bg-zinc-900">
              {synthesisResult}
            </div>
          </div>
        )}

        {/* 合并结果 */}
        {mergedBranches && (
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">合并结果</h3>
            <div className="space-y-1.5">
              {mergedBranches.map(branch => (
                <div key={branch} className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                  <GitBranch className="h-4 w-4" />
                  <span className="font-mono text-xs">{branch}</span>
                  <CheckCircle2 className="h-3.5 w-3.5" />
                </div>
              ))}
              {/* 显示未合并的分支（从 splitPlan 对比） */}
              {splitPlan && splitPlan.tasks
                .filter(task => !mergedBranches.some(b => b.includes(task.branchSlug)))
                .map(task => (
                  <div key={task.branchSlug} className="flex items-center gap-2 text-sm text-red-500 dark:text-red-400">
                    <GitBranch className="h-4 w-4" />
                    <span className="font-mono text-xs">{task.branchSlug}</span>
                    <XCircle className="h-3.5 w-3.5" />
                    <span className="text-xs text-zinc-400">未合并</span>
                  </div>
                ))
              }
            </div>
          </div>
        )}
      </div>

      {/* ── 底部操作栏 ── */}
      <ActionBar
        phase={phase}
        isDone={isDone}
        needsSplitConfirm={needsSplitConfirm}
        needsMergeConfirm={needsMergeConfirm}
        onAction={handleAction}
        onStop={() => { handleAction('stop'); onStop?.(); }}
        onRelaunch={onRelaunch && originalPrompt ? () => onRelaunch(originalPrompt) : undefined}
      />
    </div>
  );
}

// ── 底部操作栏 ──

function ActionBar({ phase, isDone, needsSplitConfirm, needsMergeConfirm, onAction, onStop, onRelaunch }: {
  phase: OrchestratorPhase;
  isDone: boolean;
  needsSplitConfirm: boolean;
  needsMergeConfirm: boolean;
  onAction: (action: string) => void;
  onStop: () => void;
  onRelaunch?: () => void;
}) {
  const t = useTranslations('orchestrator');
  const [confirming, setConfirming] = useState<string | null>(null);

  const handleConfirmAction = (action: string) => {
    setConfirming(action);
    onAction(action);
    setTimeout(() => setConfirming(null), 2000);
  };

  // 没有需要显示的操作时不渲染操作栏
  const hasVisibleAction = needsSplitConfirm || needsMergeConfirm || isDone || (!isDone && phase !== 'pending');
  if (!hasVisibleAction) return null;

  return (
    <div className="shrink-0 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 px-4 py-3">
      <div className="flex items-center gap-2 flex-wrap">
        {/* 拆分确认 */}
        {needsSplitConfirm && (
          <button
            onClick={() => handleConfirmAction('confirm-split')}
            disabled={confirming === 'confirm-split'}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {confirming === 'confirm-split' ? '...' : t('confirmSplit')}
          </button>
        )}

        {/* 合并确认 */}
        {needsMergeConfirm && (
          <button
            onClick={() => handleConfirmAction('confirm-merge')}
            disabled={confirming === 'confirm-merge'}
            className="rounded-md bg-amber-600 px-4 py-2 text-sm text-white hover:bg-amber-700 disabled:opacity-50 transition-colors"
          >
            {confirming === 'confirm-merge' ? '...' : t('confirmMerge')}
          </button>
        )}

        {/* 进行中阶段的提示 */}
        {!isDone && !needsSplitConfirm && !needsMergeConfirm && (
          <span className="text-xs text-zinc-400 flex items-center gap-1.5">
            <Loader2 className="h-3 w-3 animate-spin" />
            {t(`phases.${phase}`)}...
          </span>
        )}

        {/* 完成后的操作 */}
        {isDone && onRelaunch && (
          <button
            onClick={onRelaunch}
            className="flex items-center gap-1.5 rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            重新发起
          </button>
        )}

        {/* 右侧：停止 / 状态 */}
        <div className="flex-1" />
        {!isDone && (
          <button
            onClick={onStop}
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
          >
            <Square className="h-3.5 w-3.5" />
            {t('stop')}
          </button>
        )}
        {phase === 'completed' && (
          <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {t('phases.completed')}
          </span>
        )}
        {phase === 'failed' && (
          <span className="flex items-center gap-1 text-xs text-red-500">
            <XCircle className="h-3.5 w-3.5" />
            {t('phases.failed')}
          </span>
        )}
      </div>
    </div>
  );
}

// ── 阶段指示器 ──

function PhaseIndicator({ currentPhase }: { currentPhase: OrchestratorPhase }) {
  const t = useTranslations('orchestrator');
  const currentIdx = PHASE_ORDER.indexOf(currentPhase);
  const isFailed = currentPhase === 'failed';

  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-1">
      {PHASE_ORDER.map((p, idx) => {
        const isActive = p === currentPhase;
        const isCompleted = !isFailed && idx < currentIdx;
        const isPending = !isActive && !isCompleted;

        return (
          <div key={p} className="flex items-center gap-1">
            {idx > 0 && (
              <div className={`h-px w-4 ${isCompleted ? 'bg-green-400' : 'bg-zinc-200 dark:bg-zinc-700'}`} />
            )}
            <div className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs whitespace-nowrap ${
              isActive
                ? isFailed
                  ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                  : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                : isCompleted
                  ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                  : 'bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500'
            }`}>
              {isCompleted && <CheckCircle2 className="h-3 w-3" />}
              {isActive && !isFailed && <Loader2 className="h-3 w-3 animate-spin" />}
              {isActive && isFailed && <XCircle className="h-3 w-3" />}
              {isPending && <Circle className="h-3 w-3" />}
              {t(`phases.${p}`)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── SplitPlan 展示 ──

function SplitPlanView({ plan, needsConfirm, onConfirm }: { plan: SplitPlan; needsConfirm: boolean; onConfirm: () => void }) {
  const t = useTranslations('orchestrator');
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="space-y-3">
      <button onClick={() => setExpanded(!expanded)} className="flex items-center gap-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">
        {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        {t('splitPlan')}（{plan.tasks.length} 个子任务）
      </button>

      {expanded && (
        <div className="space-y-3 pl-2">
          {/* 分析 */}
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm dark:border-zinc-700 dark:bg-zinc-900">
            <p className="text-xs font-medium text-zinc-500 mb-1">{t('analysis')}</p>
            <p className="whitespace-pre-wrap">{plan.analysis}</p>
          </div>

          {/* 任务列表 */}
          <div className="space-y-2">
            {plan.tasks.map((task, idx) => (
              <div key={idx} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-medium">{task.title}</span>
                  {task.estimatedComplexity && (
                    <span className={`text-xs px-1.5 py-0.5 rounded ${
                      task.estimatedComplexity === 'high' ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400' :
                      task.estimatedComplexity === 'medium' ? 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400' :
                      'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400'
                    }`}>
                      {task.estimatedComplexity}
                    </span>
                  )}
                </div>
                <p className="text-xs text-zinc-500 mb-2">{task.description}</p>
                <div className="flex gap-3 text-xs text-zinc-400 flex-wrap">
                  <span className="flex items-center gap-1"><GitBranch className="h-3 w-3" />{task.branchSlug}</span>
                  {task.agentId && <span>{t('assignedAgent')}: {task.agentId}</span>}
                  {task.dependsOn && task.dependsOn.length > 0
                    ? <span>{t('dependencies')}: {task.dependsOn.join(', ')}</span>
                    : <span>{t('noDependencies')}</span>
                  }
                </div>
              </div>
            ))}
          </div>

          {/* 预期结果 */}
          <div className="text-xs text-zinc-500">
            <span className="font-medium">{t('expectedOutcome')}：</span>{plan.expectedOutcome}
          </div>

          {/* 确认按钮（也在底部操作栏有，这里保留方便滚动时操作） */}
          {needsConfirm && (
            <button
              onClick={onConfirm}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
            >
              {t('confirmSplit')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Worker 卡片 ──

function WorkerCard({ workerId, title, status, result, error, eventCount }: {
  workerId: string;
  title: string;
  status: string;
  result?: WorkerResult;
  error?: string;
  eventCount: number;
}) {
  const t = useTranslations('orchestrator');
  const statusKey = status as 'pending' | 'running' | 'completed' | 'failed' | 'stopped';
  const [showFiles, setShowFiles] = useState(false);

  return (
    <div className={`rounded-lg border p-3 ${
      status === 'completed' ? 'border-green-200 bg-green-50/50 dark:border-green-800 dark:bg-green-900/10' :
      status === 'failed' ? 'border-red-200 bg-red-50/50 dark:border-red-800 dark:bg-red-900/10' :
      status === 'running' ? 'border-blue-200 bg-blue-50/50 dark:border-blue-800 dark:bg-blue-900/10' :
      'border-zinc-200 dark:border-zinc-700'
    }`}>
      <div className="flex items-center gap-2 mb-1">
        {status === 'completed' && <CheckCircle2 className="h-4 w-4 text-green-500" />}
        {status === 'failed' && <XCircle className="h-4 w-4 text-red-500" />}
        {status === 'running' && <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />}
        {status === 'pending' && <Circle className="h-4 w-4 text-zinc-400" />}
        {status === 'stopped' && <Square className="h-4 w-4 text-zinc-400" />}
        <span className="text-sm font-medium truncate">{title}</span>
      </div>
      <div className="flex items-center gap-3 text-xs text-zinc-400">
        <span>{t(`workerStatus.${statusKey}`)}</span>
        <span>{t('eventCount', { count: eventCount })}</span>
      </div>
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
      {result?.summary && <p className="text-xs text-zinc-600 mt-2 dark:text-zinc-400">{result.summary}</p>}
      {result?.filesChanged && result.filesChanged.length > 0 && (
        <div className="mt-2">
          <button
            onClick={() => setShowFiles(!showFiles)}
            className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 flex items-center gap-1"
          >
            {showFiles ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            {result.filesChanged.length} 个文件变更
          </button>
          {showFiles && (
            <div className="mt-1 space-y-0.5 pl-3.5">
              {result.filesChanged.map((f, i) => (
                <p key={i} className="text-xs text-zinc-400 font-mono">
                  <span className={
                    f.action === 'created' ? 'text-green-500' :
                    f.action === 'deleted' ? 'text-red-500' :
                    'text-amber-500'
                  }>
                    {f.action === 'created' ? '+' : f.action === 'deleted' ? '-' : '~'}
                  </span>
                  {' '}{f.path}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
