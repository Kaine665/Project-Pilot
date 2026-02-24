'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { FormattedText } from '@/components/formatted-text';
import { cn } from '@/lib/utils';
import type { AIPlan, AIPlanStep, PlanStatus } from '@/types';
import { ChevronDown, ChevronRight, CheckCircle2, Circle, Loader2, XCircle, SkipForward, Trash2 } from 'lucide-react';


const stepStatusIcons: Record<AIPlanStep['status'], React.ReactNode> = {
  pending: <Circle className="h-3.5 w-3.5 text-zinc-400" />,
  running: <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />,
  completed: <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />,
  failed: <XCircle className="h-3.5 w-3.5 text-red-500" />,
  skipped: <SkipForward className="h-3.5 w-3.5 text-zinc-400" />,
};

interface PlanCardProps {
  plan: AIPlan;
  onApprove?: (planId: string) => void;
  onReject?: (planId: string) => void;
  onExecute?: (planId: string) => void;
  onDelete?: (planId: string) => void;
}

export function PlanCard({ plan, onApprove, onReject, onExecute, onDelete }: PlanCardProps) {
  const t = useTranslations('plans');
  const [expanded, setExpanded] = useState(false);

  const statusVariant: Record<PlanStatus, 'default' | 'secondary' | 'outline' | 'destructive'> = {
    planning: 'secondary',
    pending_approval: 'outline',
    approved: 'default',
    rejected: 'destructive',
    completed: 'default',
    failed: 'destructive',
    archived: 'secondary',
  };

  const version = plan.version ?? 1;
  const stepCount = plan.step_count ?? plan.steps?.length ?? 0;
  const stepsCompleted = plan.steps_completed ?? plan.steps?.filter((s) => s.status === 'completed').length ?? 0;
  const executionCount = plan.execution_count ?? 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="text-sm">计划 v{version}</CardTitle>
            <Badge variant={badge.variant}>{badge.label}</Badge>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => onDelete?.(plan.plan_id)}
              className="rounded p-1 text-zinc-300 hover:bg-red-50 hover:text-red-500 dark:text-zinc-600 dark:hover:bg-red-950/30 dark:hover:text-red-400"
              title="删除计划"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setExpanded(!expanded)}
              className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
            >
              {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        <FormattedText
          text={plan.analysis}
          className={cn(
            'text-zinc-600 dark:text-zinc-400 space-y-1',
            !expanded && 'line-clamp-3'
          )}
        />
        <div className="mt-3 flex items-center gap-3 text-xs text-zinc-400">
          <span>{stepCount} 个步骤</span>
          <span>{stepsCompleted} 已完成</span>
          {executionCount > 0 && <span>执行 {executionCount} 次</span>}
        </div>
      </CardContent>

      {/* Expanded details */}
      {expanded && (
        <>
          {/* Steps list */}
          {plan.steps.length > 0 && (
            <CardContent className="border-t border-zinc-100 pt-3 dark:border-zinc-800">
              <div className="flex flex-col gap-2">
                {plan.steps.map((step, i) => (
                  <div
                    key={`${step.id}-${i}`}
                    className={cn(
                      'flex items-start gap-2 rounded-md p-2.5 text-xs',
                      step.status === 'running' && 'bg-blue-50 dark:bg-blue-950/20',
                      step.status === 'failed' && 'bg-red-50 dark:bg-red-950/20',
                    )}
                  >
                    <span className="mt-0.5 shrink-0">{stepStatusIcons[step.status]}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-zinc-700 dark:text-zinc-300">
                          #{step.id} {step.action}
                        </span>
                        {step.type === 'manual' && (
                          <Badge variant="outline" className="text-[10px]">
                            手动
                          </Badge>
                        )}
                        {step.risk_level && step.risk_level !== 'low' && (
                          <Badge
                            variant={step.risk_level === 'high' ? 'destructive' : 'outline'}
                            className="text-[10px]"
                          >
                            {step.risk_level === 'high' ? '高风险' : '中风险'}
                          </Badge>
                        )}
                      </div>
                      {step.description && (
                        <div className="mt-1.5">
                          <FormattedText
                            text={step.description}
                            className="text-zinc-500 dark:text-zinc-400 space-y-1"
                          />
                        </div>
                      )}
                      {step.error && (
                        <p className="mt-1.5 text-red-500">{step.error}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          )}

          {/* Expected results */}
          {plan.expected_results && (
            <CardContent className="border-t border-zinc-100 pt-3 dark:border-zinc-800">
              <h4 className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-2">预期结果</h4>
              <FormattedText
                text={plan.expected_results}
                className="text-zinc-600 dark:text-zinc-400 space-y-1"
              />
            </CardContent>
          )}

          {/* Risks */}
          {plan.risks && (
            <CardContent className="border-t border-zinc-100 pt-3 dark:border-zinc-800">
              <h4 className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-2">风险评估</h4>
              <FormattedText
                text={plan.risks}
                className="text-zinc-600 dark:text-zinc-400 space-y-1"
              />
            </CardContent>
          )}
        </>
      )}

      {/* Actions based on status */}
      {(plan.status === 'pending_approval' || plan.status === 'approved') && (
        <CardFooter className="gap-2">
          {plan.status === 'pending_approval' && (
            <>
              <Button size="sm" onClick={() => onApprove?.(plan.plan_id)}>
                批准
              </Button>
              <Button size="sm" variant="destructive" onClick={() => onReject?.(plan.plan_id)}>
                拒绝
              </Button>
            </>
          )}
          {plan.status === 'approved' && (
            <Button size="sm" onClick={() => onExecute?.(plan.plan_id)}>
              执行
            </Button>
          )}
        </CardFooter>
      )}
    </Card>
  );
}
