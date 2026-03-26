'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { Agent } from '@/types';
import { X, Bot } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (dialogueId: string) => void;
}

export function CreateDialogueDialog({ open, onClose, onCreated }: Props) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [agentAId, setAgentAId] = useState('');
  const [agentBId, setAgentBId] = useState('');
  const [maxRounds, setMaxRounds] = useState(10);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      fetch('/api/agents')
        .then(r => r.json())
        .then(data => setAgents((data.agents ?? []).filter((a: Agent) => !a.archived)))
        .catch(() => {});
    }
  }, [open]);

  if (!open) return null;

  const agentA = agents.find(a => a.id === agentAId);
  const agentB = agents.find(a => a.id === agentBId);
  const canSubmit = title.trim() && agentAId && agentBId && agentAId !== agentBId;

  const handleSubmit = async () => {
    if (!canSubmit || !agentA || !agentB) return;
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/dialogues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || undefined,
          agentA: { id: agentA.id, name: agentA.name },
          agentB: { id: agentB.id, name: agentB.name },
          maxRounds,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to create dialogue');
      }

      const dialogue = await res.json();
      onCreated(dialogue.id);
      // Reset
      setTitle('');
      setDescription('');
      setAgentAId('');
      setAgentBId('');
      setMaxRounds(10);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-xl bg-white p-6 shadow-2xl dark:bg-zinc-900"
        onClick={e => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">创建 Agent 对话</h2>
          <button onClick={onClose} className="rounded p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4">
          {/* Title */}
          <div>
            <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              对话主题 *
            </label>
            <Input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="例：讨论 API 设计方案"
              maxLength={500}
            />
          </div>

          {/* Description */}
          <div>
            <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              背景描述
            </label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="可选：描述对话的目标和上下文"
              className="w-full rounded-md border border-zinc-200 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:focus:border-zinc-500"
              rows={2}
            />
          </div>

          {/* Agent A */}
          <div>
            <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Agent A（先发言） *
            </label>
            <select
              value={agentAId}
              onChange={e => setAgentAId(e.target.value)}
              className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-500"
            >
              <option value="">选择 Agent...</option>
              {agents.map(a => (
                <option key={a.id} value={a.id} disabled={a.id === agentBId}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>

          {/* Agent B */}
          <div>
            <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Agent B *
            </label>
            <select
              value={agentBId}
              onChange={e => setAgentBId(e.target.value)}
              className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-500"
            >
              <option value="">选择 Agent...</option>
              {agents.map(a => (
                <option key={a.id} value={a.id} disabled={a.id === agentAId}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>

          {/* Preview */}
          {agentA && agentB && (
            <div className="flex items-center justify-center gap-4 rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800/50">
              <div className="flex items-center gap-1.5 text-sm">
                <Bot className="h-4 w-4 text-blue-500" />
                <span className="font-medium">{agentA.name}</span>
              </div>
              <span className="text-zinc-400">vs</span>
              <div className="flex items-center gap-1.5 text-sm">
                <Bot className="h-4 w-4 text-emerald-500" />
                <span className="font-medium">{agentB.name}</span>
              </div>
            </div>
          )}

          {/* Max Rounds */}
          <div>
            <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              最大轮数
            </label>
            <Input
              type="number"
              value={maxRounds}
              onChange={e => setMaxRounds(Math.max(1, Math.min(50, Number(e.target.value) || 10)))}
              min={1}
              max={50}
            />
          </div>

          {error && (
            <p className="text-sm text-red-500">{error}</p>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>
              取消
            </Button>
            <Button size="sm" disabled={!canSubmit || loading} onClick={handleSubmit}>
              {loading ? '创建中...' : '创建并启动'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
