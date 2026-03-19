'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { AgentDialogue, DialogueMessage, DialogueStatus } from '@/types';
import { ArrowLeft, Bot, Square, RotateCcw, Loader2 } from 'lucide-react';
import { useRouter } from '@/i18n/routing';

const STATUS_CONFIG: Record<DialogueStatus, { label: string; color: string }> = {
  pending: { label: '等待中', color: 'bg-zinc-200 dark:bg-zinc-700' },
  running: { label: '进行中', color: 'bg-blue-500' },
  completed: { label: '已完成', color: 'bg-emerald-500' },
  stopped: { label: '已停止', color: 'bg-amber-500' },
  error: { label: '出错', color: 'bg-red-500' },
};

interface Props {
  dialogueId: string;
}

export function DialogueView({ dialogueId }: Props) {
  const router = useRouter();
  const [dialogue, setDialogue] = useState<AgentDialogue | null>(null);
  const [loading, setLoading] = useState(true);
  const [stopping, setStopping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  // 加载初始数据
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/dialogues/${dialogueId}`);
        if (!res.ok) {
          setDialogue(null);
          return;
        }
        const data = await res.json();
        setDialogue(data);
      } catch {
        setDialogue(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [dialogueId]);

  // SSE 实时更新
  useEffect(() => {
    if (!dialogue || (dialogue.status !== 'running' && dialogue.status !== 'pending')) return;

    const es = new EventSource(`/api/dialogues/${dialogueId}/stream`);
    eventSourceRef.current = es;

    es.addEventListener('message', (e) => {
      try {
        const msg: DialogueMessage = JSON.parse(e.data);
        setDialogue(prev => {
          if (!prev) return prev;
          // 避免重复添加
          if (prev.messages.some(m => m.sessionId === msg.sessionId)) return prev;
          return {
            ...prev,
            messages: [...prev.messages, msg],
            currentRound: msg.round,
          };
        });
      } catch { /* ignore */ }
    });

    es.addEventListener('status', (e) => {
      try {
        const data = JSON.parse(e.data);
        setDialogue(prev => prev ? {
          ...prev,
          status: data.status,
          currentRound: data.currentRound ?? prev.currentRound,
        } : prev);
      } catch { /* ignore */ }
    });

    es.addEventListener('error', (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data ?? '{}');
        setDialogue(prev => prev ? { ...prev, status: 'error', error: data.error } : prev);
      } catch { /* SSE connection error, ignore */ }
    });

    es.addEventListener('done', () => {
      es.close();
    });

    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, [dialogueId, dialogue?.status]);

  // 新消息自动滚动
  useEffect(() => {
    scrollToBottom();
  }, [dialogue?.messages.length, scrollToBottom]);

  const handleStop = async () => {
    setStopping(true);
    try {
      await fetch(`/api/dialogues/${dialogueId}/stop`, { method: 'POST' });
    } catch { /* ignore */ }
    setStopping(false);
  };

  const handleRestart = async () => {
    if (!dialogue) return;
    try {
      const res = await fetch('/api/dialogues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: dialogue.title,
          description: dialogue.description,
          agentA: dialogue.agentA,
          agentB: dialogue.agentB,
          maxRounds: dialogue.maxRounds,
          projectKey: dialogue.projectKey,
        }),
      });
      if (res.ok) {
        const newDialogue = await res.json();
        router.push(`/flows/dialogues/${newDialogue.id}`);
      }
    } catch { /* ignore */ }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-zinc-400">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        加载中...
      </div>
    );
  }

  if (!dialogue) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-sm text-zinc-400">
        <p>对话不存在</p>
        <Button variant="ghost" size="sm" className="mt-2" onClick={() => router.push('/flows/dialogues')}>
          返回列表
        </Button>
      </div>
    );
  }

  const statusConfig = STATUS_CONFIG[dialogue.status];
  const isRunning = dialogue.status === 'running' || dialogue.status === 'pending';
  const isTerminal = dialogue.status === 'completed' || dialogue.status === 'stopped' || dialogue.status === 'error';
  const progressPct = dialogue.maxRounds > 0 ? (dialogue.currentRound / dialogue.maxRounds) * 100 : 0;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="shrink-0 border-b border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push('/flows/dialogues')}
            className="rounded p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                {dialogue.title}
              </h1>
              <div className="flex items-center gap-1.5">
                <span className={`h-2 w-2 rounded-full ${statusConfig.color}`} />
                <span className="text-xs text-zinc-500">{statusConfig.label}</span>
              </div>
            </div>
            <div className="mt-1 flex items-center gap-3 text-xs text-zinc-500">
              <span className="flex items-center gap-1">
                <Bot className="h-3 w-3 text-blue-500" />
                {dialogue.agentA.name}
              </span>
              <span className="text-zinc-300 dark:text-zinc-600">vs</span>
              <span className="flex items-center gap-1">
                <Bot className="h-3 w-3 text-emerald-500" />
                {dialogue.agentB.name}
              </span>
              <span className="text-zinc-300 dark:text-zinc-600">|</span>
              <span>{dialogue.currentRound}/{dialogue.maxRounds} 轮</span>
            </div>
          </div>
        </div>

        {/* Progress bar */}
        <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
          <div
            className="h-full rounded-full bg-blue-500 transition-all duration-500"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto max-w-3xl space-y-4">
          {dialogue.messages.length === 0 && isRunning && (
            <div className="flex items-center justify-center py-10 text-sm text-zinc-400">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              等待 Agent 发言...
            </div>
          )}

          {dialogue.messages.map((msg, i) => (
            <MessageBubble
              key={`${msg.sessionId}-${i}`}
              message={msg}
              agentA={dialogue.agentA}
              agentB={dialogue.agentB}
            />
          ))}

          {/* Loading indicator for next speaker */}
          {isRunning && dialogue.messages.length > 0 && (
            <div className="flex items-center gap-2 py-2 text-xs text-zinc-400">
              <Loader2 className="h-3 w-3 animate-spin" />
              等待回复中...
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Bottom action bar */}
      <div className="shrink-0 border-t border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <div className="text-xs text-zinc-500">
            {dialogue.error && (
              <span className="text-red-500">错误：{dialogue.error}</span>
            )}
            {!dialogue.error && dialogue.completedAt && (
              <span>完成于 {new Date(dialogue.completedAt).toLocaleString()}</span>
            )}
          </div>

          <div className="flex gap-2">
            {isRunning && (
              <Button
                variant="destructive"
                size="sm"
                disabled={stopping}
                onClick={handleStop}
              >
                <Square className="mr-1 h-3 w-3" />
                {stopping ? '停止中...' : '停止对话'}
              </Button>
            )}
            {isTerminal && (
              <Button variant="outline" size="sm" onClick={handleRestart}>
                <RotateCcw className="mr-1 h-3 w-3" />
                重新开始
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Message Bubble ──

function MessageBubble({
  message,
  agentA,
  agentB,
}: {
  message: DialogueMessage;
  agentA: { id: string; name: string };
  agentB: { id: string; name: string };
}) {
  const isA = message.speaker === 'agentA';
  const agent = isA ? agentA : agentB;
  const colorClass = isA ? 'text-blue-500' : 'text-emerald-500';
  const bgClass = isA
    ? 'bg-blue-50 border-blue-100 dark:bg-blue-950/30 dark:border-blue-900/30'
    : 'bg-emerald-50 border-emerald-100 dark:bg-emerald-950/30 dark:border-emerald-900/30';
  const alignClass = isA ? 'mr-12' : 'ml-12';

  return (
    <div className={`${alignClass}`}>
      <div className={`rounded-lg border p-3 ${bgClass}`}>
        <div className="mb-1.5 flex items-center gap-1.5">
          <Bot className={`h-3.5 w-3.5 ${colorClass}`} />
          <span className={`text-xs font-medium ${colorClass}`}>{agent.name}</span>
          <Badge variant="outline" className="ml-auto text-[10px]">R{message.round}</Badge>
        </div>
        <div className="whitespace-pre-wrap text-sm text-zinc-800 dark:text-zinc-200 leading-relaxed">
          {message.content}
        </div>
        <div className="mt-2 text-[10px] text-zinc-400">
          {new Date(message.timestamp).toLocaleTimeString()}
        </div>
      </div>
    </div>
  );
}
