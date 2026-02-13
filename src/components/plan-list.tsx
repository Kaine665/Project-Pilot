'use client';

import { useState, useEffect, useCallback } from 'react';
import { PlanCard } from '@/components/plan-card';
import type { AIPlan } from '@/types';

interface PlanListProps {
  taskId: string;
}

export function PlanList({ taskId }: PlanListProps) {
  const [plans, setPlans] = useState<AIPlan[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchPlans = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/ai-plans?taskId=${taskId}`);
      if (res.ok) {
        const data = await res.json();
        setPlans(data.plans ?? []);
      }
    } catch (err) {
      console.error('Failed to fetch plans:', err);
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    fetchPlans();
  }, [fetchPlans]);

  const handleAction = async (action: 'approve' | 'reject' | 'execute', planId: string) => {
    try {
      const res = await fetch(`/api/ai-plans/${planId}/${action}`, {
        method: 'POST',
      });
      if (res.ok) {
        fetchPlans();
      }
    } catch (err) {
      console.error(`Failed to ${action} plan:`, err);
    }
  };

  if (loading) {
    return <div className="p-4 text-center text-sm text-zinc-400">加载中...</div>;
  }

  if (plans.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 p-8 text-center">
        <p className="text-sm text-zinc-400">还没有执行计划</p>
        <p className="text-xs text-zinc-300 dark:text-zinc-600">点击"生成计划"让 AI 创建执行计划</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {plans.map((plan) => (
        <PlanCard
          key={plan.plan_id}
          plan={plan}
          onApprove={(id) => handleAction('approve', id)}
          onReject={(id) => handleAction('reject', id)}
          onExecute={(id) => handleAction('execute', id)}
        />
      ))}
    </div>
  );
}
