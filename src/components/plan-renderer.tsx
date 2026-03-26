'use client';

import React from 'react';
import { useTranslations } from '@/client/i18n/use-translations';
import { FormattedText } from '@/components/formatted-text';
import { CheckCircle2, Circle, AlertTriangle } from 'lucide-react';

interface PlanStep {
  id: number;
  type: 'auto' | 'manual' | 'confirm';
  action: string;
  description?: string;
  status?: string;
  risk_level?: 'low' | 'medium' | 'high';
}

interface PlanData {
  analysis: string;
  steps: PlanStep[];
  expected_results?: string;
  risks?: string;
}

interface PlanRendererProps {
  planJson: string;
}

/**
 * 将 JSON 格式的计划渲染为友好的文本格式
 */
export function PlanRenderer({ planJson }: PlanRendererProps) {
  const t = useTranslations('plans');
  let plan: PlanData;

  try {
    plan = JSON.parse(planJson);
  } catch (e) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
        {t('invalidFormat')}
      </div>
    );
  }

  const riskBadge = (level?: string) => {
    if (!level || level === 'low') return null;
    return (
      <span
        className={`ml-2 rounded px-1.5 py-0.5 text-xs ${
          level === 'high'
            ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
            : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
        }`}
      >
        {level === 'high' ? t('highRisk') : t('mediumRisk')}
      </span>
    );
  };

  const typeIcon = (type: string) => {
    if (type === 'manual') {
      return <span className="text-blue-600 dark:text-blue-400 text-xs">{t('stepTypes.manual')}</span>;
    }
    if (type === 'confirm') {
      return <span className="text-purple-600 dark:text-purple-400 text-xs">{t('stepTypes.confirm')}</span>;
    }
    return <span className="text-green-600 dark:text-green-400 text-xs">{t('stepTypes.auto')}</span>;
  };

  return (
    <div className="space-y-4 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900">
      {/* 任务分析 */}
      {plan.analysis && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            {t('sections.taskAnalysis')}
          </h3>
          <FormattedText text={plan.analysis} className="space-y-1.5 text-zinc-700 dark:text-zinc-300" />
        </div>
      )}

      {/* 执行步骤 */}
      {plan.steps && plan.steps.length > 0 && (
        <div>
          <h3 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            {t('sections.executionSteps', { count: plan.steps.length })}
          </h3>
          <div className="space-y-3">
            {plan.steps.map((step) => (
              <div
                key={step.id}
                className="rounded-md border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-800/50"
              >
                <div className="flex items-start gap-2">
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-xs font-semibold text-zinc-700 dark:bg-zinc-700 dark:text-zinc-300">
                    {step.id}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-zinc-900 dark:text-zinc-100">
                        {step.action}
                      </span>
                      {typeIcon(step.type)}
                      {riskBadge(step.risk_level)}
                    </div>
                    {step.description && (
                      <div className="mt-1.5">
                        <FormattedText
                          text={step.description}
                          className="space-y-1 text-sm text-zinc-600 dark:text-zinc-400"
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 预期结果 */}
      {plan.expected_results && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            {t('sections.expectedResult')}
          </h3>
          <FormattedText
            text={plan.expected_results}
            className="space-y-1.5 text-zinc-700 dark:text-zinc-300"
          />
        </div>
      )}

      {/* 风险评估 */}
      {plan.risks && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            {t('sections.riskAssessment')}
          </h3>
          <FormattedText text={plan.risks} className="space-y-1.5 text-zinc-700 dark:text-zinc-300" />
        </div>
      )}
    </div>
  );
}
