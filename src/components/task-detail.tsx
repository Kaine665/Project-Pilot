'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { PlanList } from '@/components/plan-list';
import { ArtifactViewer } from '@/components/artifact-viewer';
import type { Task, ProjectConfig } from '@/types';
import { Play, CheckCircle2, Sparkles, MessageSquare, FileText } from 'lucide-react';

interface TaskDetailProps {
  taskId: string | null;
}

const statusLabels: Record<string, string> = {
  todo: '待办',
  doing: '进行中',
  done: '已完成',
};

const statusBadgeVariant: Record<string, 'secondary' | 'default' | 'outline'> = {
  todo: 'secondary',
  doing: 'default',
  done: 'outline',
};

export function TaskDetail({ taskId }: TaskDetailProps) {
  const [task, setTask] = useState<Task | null>(null);
  const [projects, setProjects] = useState<Record<string, ProjectConfig>>({});
  const [loading, setLoading] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchTask = useCallback(async () => {
    if (!taskId) return;
    try {
      setLoading(true);
      const res = await fetch(`/api/tasks/${taskId}`);
      if (res.ok) {
        const data = await res.json();
        setTask(data);
        setEditTitle(data.title);
        setEditContent(data.content ?? '');
      }
    } catch (err) {
      console.error('Failed to fetch task:', err);
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  const fetchProjects = useCallback(async () => {
    try {
      const res = await fetch('/api/projects');
      if (res.ok) {
        const data = await res.json();
        setProjects(data.projects ?? {});
      }
    } catch (err) {
      console.error('Failed to fetch projects:', err);
    }
  }, []);

  useEffect(() => {
    fetchTask();
    fetchProjects();
  }, [fetchTask, fetchProjects]);

  const saveTask = async (updates: Partial<Task>) => {
    if (!taskId) return;
    try {
      setSaving(true);
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (res.ok) {
        fetchTask();
      }
    } catch (err) {
      console.error('Failed to update task:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleTitleBlur = () => {
    if (editTitle !== task?.title && editTitle.trim()) {
      saveTask({ title: editTitle.trim() });
    }
  };

  const handleContentBlur = () => {
    if (editContent !== (task?.content ?? '')) {
      saveTask({ content: editContent });
    }
  };

  const handleStatusChange = (newStatus: 'doing' | 'done') => {
    saveTask({ status: newStatus });
  };

  const handleGeneratePlan = async () => {
    if (!taskId) return;
    try {
      await fetch(`/api/ai-plans`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId }),
      });
      // Plans tab will auto-refresh since PlanList re-fetches on mount
    } catch (err) {
      console.error('Failed to generate plan:', err);
    }
  };

  // Empty state
  if (!taskId) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-zinc-400">
          <FileText className="h-12 w-12 stroke-1" />
          <p className="text-sm">选择一个任务开始</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-zinc-400">加载中...</p>
      </div>
    );
  }

  if (!task) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-zinc-400">任务未找到</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Task header */}
      <div className="border-b border-zinc-200 p-4 dark:border-zinc-800">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <Input
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              onBlur={handleTitleBlur}
              className="border-none text-lg font-semibold shadow-none focus-visible:ring-0 px-0"
            />
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Badge variant={statusBadgeVariant[task.status]}>{statusLabels[task.status]}</Badge>
            <Badge variant="secondary">{projects[task.projectKey]?.name ?? task.projectKey}</Badge>
          </div>
        </div>

        <Textarea
          value={editContent}
          onChange={(e) => setEditContent(e.target.value)}
          onBlur={handleContentBlur}
          placeholder="添加任务描述..."
          className="mt-2 min-h-[60px] border-none shadow-none focus-visible:ring-0 px-0 resize-none"
        />

        {/* Action buttons */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {task.status === 'todo' && (
            <Button size="sm" onClick={() => handleStatusChange('doing')}>
              <Play className="h-3.5 w-3.5" />
              开始
            </Button>
          )}
          {task.status === 'doing' && (
            <Button size="sm" onClick={() => handleStatusChange('done')}>
              <CheckCircle2 className="h-3.5 w-3.5" />
              完成
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={handleGeneratePlan}>
            <Sparkles className="h-3.5 w-3.5" />
            生成计划
          </Button>
          <Button size="sm" variant="outline" disabled>
            <MessageSquare className="h-3.5 w-3.5" />
            讨论计划
          </Button>
          {saving && <span className="text-xs text-zinc-400">保存中...</span>}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex-1 p-4">
        <Tabs defaultValue="plans">
          <TabsList>
            <TabsTrigger value="plans">计划</TabsTrigger>
            <TabsTrigger value="executions">执行</TabsTrigger>
            <TabsTrigger value="artifacts">验证产物</TabsTrigger>
          </TabsList>

          <TabsContent value="plans">
            <PlanList taskId={task.id} />
          </TabsContent>

          <TabsContent value="executions">
            <div className="flex flex-col items-center gap-2 p-8 text-center">
              <p className="text-sm text-zinc-400">执行记录将在此显示</p>
            </div>
          </TabsContent>

          <TabsContent value="artifacts">
            <ArtifactViewer taskId={task.id} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
