'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CreateDialogueDialog } from '@/components/create-dialogue-dialog';
import type { AgentDialogueSummary, DialogueStatus } from '@/types';
import { Plus, Bot, Trash2, MessageCircle } from 'lucide-react';
import { useRouter } from '@/i18n/routing';

const STATUS_CONFIG: Record<DialogueStatus, { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }> = {
  pending: { label: '等待中', variant: 'secondary' },
  running: { label: '进行中', variant: 'default' },
  completed: { label: '已完成', variant: 'outline' },
  stopped: { label: '已停止', variant: 'secondary' },
  error: { label: '出错', variant: 'destructive' },
};

export function DialogueList() {
  const router = useRouter();
  const [dialogues, setDialogues] = useState<AgentDialogueSummary[]>([]);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchDialogues = useCallback(async () => {
    try {
      const res = await fetch('/api/dialogues');
      const data = await res.json();
      setDialogues(data.dialogues ?? []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDialogues();
    // 自动刷新（有 running 的对话时）
    const interval = setInterval(fetchDialogues, 5000);
    return () => clearInterval(interval);
  }, [fetchDialogues]);

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('确认删除这个对话吗？')) return;
    await fetch(`/api/dialogues/${id}`, { method: 'DELETE' });
    fetchDialogues();
  };

  const handleCreated = (dialogueId: string) => {
    setCreating(false);
    router.push(`/flows/dialogues/${dialogueId}`);
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-zinc-400">
        加载中...
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl p-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
            Agent 对话
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            让两个 Agent 围绕主题交替发言，碰撞出智慧火花
          </p>
        </div>
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus className="mr-1 h-3.5 w-3.5" />
          新建对话
        </Button>
      </div>

      {/* Empty state */}
      {dialogues.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-zinc-400">
          <MessageCircle className="mb-3 h-10 w-10 opacity-50" />
          <p className="text-sm">还没有对话</p>
          <p className="mt-1 text-xs">点击「新建对话」开始第一次 Agent 间对话</p>
        </div>
      )}

      {/* Dialogue cards */}
      <div className="space-y-3">
        {dialogues.map(d => {
          const statusConfig = STATUS_CONFIG[d.status];
          return (
            <div
              key={d.id}
              onClick={() => router.push(`/flows/dialogues/${d.id}`)}
              className="group cursor-pointer rounded-lg border border-zinc-200 bg-white p-4 transition-all hover:border-zinc-300 hover:shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      {d.title}
                    </h3>
                    <Badge variant={statusConfig.variant}>{statusConfig.label}</Badge>
                  </div>

                  {d.description && (
                    <p className="mt-1 truncate text-xs text-zinc-500">{d.description}</p>
                  )}

                  <div className="mt-2 flex items-center gap-4 text-xs text-zinc-500">
                    {/* Agent A */}
                    <span className="flex items-center gap-1">
                      <Bot className="h-3 w-3 text-blue-500" />
                      {d.agentA.name}
                    </span>
                    <span className="text-zinc-300 dark:text-zinc-600">vs</span>
                    {/* Agent B */}
                    <span className="flex items-center gap-1">
                      <Bot className="h-3 w-3 text-emerald-500" />
                      {d.agentB.name}
                    </span>
                    <span className="text-zinc-300 dark:text-zinc-600">|</span>
                    <span>
                      {d.currentRound}/{d.maxRounds} 轮
                    </span>
                    <span className="text-zinc-300 dark:text-zinc-600">|</span>
                    <span>{new Date(d.createdAt).toLocaleString()}</span>
                  </div>
                </div>

                {/* Delete */}
                <button
                  onClick={e => handleDelete(d.id, e)}
                  className="ml-2 rounded p-1 text-zinc-400 opacity-0 transition-opacity hover:bg-zinc-100 hover:text-red-500 group-hover:opacity-100 dark:hover:bg-zinc-800"
                  title="删除"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <CreateDialogueDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={handleCreated}
      />
    </div>
  );
}
