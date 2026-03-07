'use client';

import { useState, useCallback, useMemo } from 'react';
import { CheckCircle2, XCircle, Circle, Loader2, Square, ChevronDown, ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useOrchestratorStream } from '@/hooks/use-orchestrator-stream';
import type { OrchestratorPhase, OrchestratorSSEEvent, SplitPlan, WorkerResult } from '@/types/orchestrator';

interface OrchMonitorProps {
  orchId: string;
  onStop?: () => void;
}

const PHASE_ORDER: OrchestratorPhase[] = [
  'pending', 'splitting', 'spawning', 'executing', 'synthesizing', 'merging', 'completed',
];

export function OrchMonitor({ orchId, onStop }: OrchMonitorProps) {
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

  const errorMessage = useMemo(() => {
    const evt = [...events].reverse().find(e => e.type === 'orch_error');
    return evt?.type === 'orch_error' ? evt.message : null;
  }, [events]);

  const isDone = phase === 'completed' || phase === 'failed';
  const needsSplitConfirm = phase === 'splitting' && splitPlan !== null;
  const needsMergeConfirm = phase === 'merging';

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
    <div className="space-y-6">
      {/* 状态栏 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`inline-block h-2 w-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-zinc-300'}`} />
          <span className="text-xs text-zinc-500">{isConnected ? t('connected') : t('disconnected')}</span>
          <span className="text-xs text-zinc-400">|</span>
          <span className="text-xs text-zinc-500">{t('eventCount', { count: events.length })}</span>
        </div>
        {!isDone && (
          <button
            onClick={() => { handleAction('stop'); onStop?.(); }}
            className="flex items-center gap-1 rounded-md px-3 py-1.5 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
          >
            <Square className="h-3 w-3" />
            {t('stop')}
          </button>
        )}
      </div>

      {/* 阶段进度 */}
      <PhaseIndicator currentPhase={phase} />

      {/* 错误信息 */}
      {errorMessage && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
          {errorMessage}
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

      {/* Merge 确认 */}
      {needsMergeConfirm && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-900/20">
          <p className="text-sm text-amber-700 dark:text-amber-400 mb-3">合并阶段需要确认</p>
          <button
            onClick={() => handleAction('confirm-merge')}
            className="rounded-md bg-amber-600 px-4 py-2 text-sm text-white hover:bg-amber-700"
          >
            {t('confirmMerge')}
          </button>
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
        {t('splitPlan')}
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
                <div className="flex gap-3 text-xs text-zinc-400">
                  <span>branch: {task.branchSlug}</span>
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

          {/* 确认按钮 */}
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
      {result?.summary && <p className="text-xs text-zinc-600 mt-1 dark:text-zinc-400">{result.summary}</p>}
      {result?.filesChanged && result.filesChanged.length > 0 && (
        <div className="text-xs text-zinc-400 mt-1">
          {result.filesChanged.length} files changed
        </div>
      )}
    </div>
  );
}
