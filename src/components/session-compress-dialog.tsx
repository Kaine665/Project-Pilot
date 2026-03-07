'use client';

import { memo, useState, useEffect, useCallback } from 'react';
import { FileDown, X, Loader2, AlertCircle } from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
import type { ChatMessage } from '@/types';

// ── Props ──

interface SessionCompressDialogProps {
  open: boolean;
  onClose: () => void;
  sessionId: string | null;
  messages: ChatMessage[];
  onConfirm: (compressedMessages: ChatMessage[]) => void;
}

// ── 假数据压缩逻辑（fallback） ──

/** 保留最后 N 条消息不压缩 */
const KEEP_LAST = 4;

function generateFakeCompression(messages: ChatMessage[]): ChatMessage[] {
  if (messages.length <= KEEP_LAST) return messages;

  const compressed = messages.slice(0, -KEEP_LAST);
  const kept = messages.slice(-KEEP_LAST);

  const userMsgs = compressed.filter(m => m.role === 'user');
  const rounds = Math.ceil(compressed.length / 2);

  // 从用户消息中提取摘要要点
  const bulletPoints = userMsgs.slice(0, 3).map((m, i) => {
    const preview = m.content.slice(0, 40).replace(/\n/g, ' ');
    const labels = ['提出了', '讨论了', '完成了'];
    return `${i + 1}. 用户${labels[i] ?? '提到了'} ${preview}${m.content.length > 40 ? '...' : ''}`;
  });

  const summaryContent = [
    `[会话摘要] 本次对话共 ${rounds} 轮，主要内容：`,
    ...bulletPoints,
    '',
    '（以上为模拟压缩，实际压缩将由 AI 生成）',
  ].join('\n');

  const summaryMsg: ChatMessage = {
    id: `compress-summary-${Date.now()}`,
    role: 'assistant',
    content: summaryContent,
    timestamp: new Date().toISOString(),
  };

  return [summaryMsg, ...kept];
}

// ── 工具函数 ──

function charCount(messages: ChatMessage[]): number {
  return messages.reduce((sum, m) => sum + m.content.length, 0);
}

function truncate(text: string, max: number): string {
  const oneLine = text.replace(/\n/g, ' ');
  return oneLine.length > max ? oneLine.slice(0, max) + '...' : oneLine;
}

// ── 组件 ──

export const SessionCompressDialog = memo(function SessionCompressDialog({
  open,
  onClose,
  sessionId,
  messages,
  onConfirm,
}: SessionCompressDialogProps) {
  const [compressedMessages, setCompressedMessages] = useState<ChatMessage[] | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [applyLoading, setApplyLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 打开对话框时调 preview API
  useEffect(() => {
    if (!open) {
      // 关闭时重置状态
      setCompressedMessages(null);
      setPreviewLoading(false);
      setApplyLoading(false);
      setError(null);
      return;
    }

    if (!sessionId) {
      setError('会话尚未创建，无法压缩');
      return;
    }

    let cancelled = false;
    setPreviewLoading(true);
    setError(null);
    setCompressedMessages(null);

    fetch(`/api/agent-chat/sessions/${sessionId}/compress`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'preview' }),
    })
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(text || `请求失败 (${res.status})`);
        }
        return res.json();
      })
      .then((data) => {
        if (cancelled || !data) return;
        setCompressedMessages(data.messages as ChatMessage[]);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn('[compress] preview API 失败，降级使用本地压缩:', err);
        // fallback 到假数据
        setCompressedMessages(generateFakeCompression(messages));
        setError(`预览 API 不可用，已降级为本地模拟压缩（${err instanceof Error ? err.message : '未知错误'}）`);
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });

    return () => { cancelled = true; };
  }, [open, sessionId, messages]);

  // 确认压缩
  const handleConfirm = useCallback(async () => {
    if (!compressedMessages || !sessionId) return;

    setApplyLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/agent-chat/sessions/${sessionId}/compress`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'apply', messages: compressedMessages }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || `保存失败 (${res.status})`);
      }

      onConfirm(compressedMessages);
    } catch (err) {
      setError(`保存失败：${err instanceof Error ? err.message : '未知错误'}`);
    } finally {
      setApplyLoading(false);
    }
  }, [compressedMessages, sessionId, onConfirm]);

  const originalCount = messages.length;
  const originalChars = charCount(messages);
  const compressedCount = compressedMessages?.length ?? 0;
  const compressedChars = compressedMessages ? charCount(compressedMessages) : 0;
  const savedPercent = originalChars > 0 && compressedMessages
    ? Math.round((1 - compressedChars / originalChars) * 100)
    : 0;

  // 被压缩掉的消息 = 原始消息中不在 "保留" 范围内的
  const keptOriginalIds = new Set(messages.slice(-KEEP_LAST).map(m => m.id));

  const isLoading = previewLoading || applyLoading;

  return (
    <Dialog.Root open={open} onOpenChange={(v) => { if (!v && !isLoading) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[90vw] max-w-4xl -translate-x-1/2 -translate-y-1/2 rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3 dark:border-zinc-700">
            <div className="flex items-center gap-2">
              <FileDown className="h-4 w-4 text-blue-500" />
              <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">压缩会话历史</span>
            </div>
            <Dialog.Close asChild>
              <button
                disabled={isLoading}
                className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 disabled:opacity-50"
              >
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          {/* Body: 左右对比 */}
          <div className="flex max-h-[60vh] min-h-[300px]">
            {/* 左侧：原始记录 */}
            <div className="flex w-1/2 flex-col border-r border-zinc-200 dark:border-zinc-700">
              <div className="border-b border-zinc-100 bg-zinc-50 px-4 py-2 dark:border-zinc-800 dark:bg-zinc-950">
                <span className="text-xs font-medium text-zinc-500">原始记录（{originalCount} 条）</span>
              </div>
              <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
                {messages.map((msg) => {
                  const isKept = keptOriginalIds.has(msg.id);
                  return (
                    <div
                      key={msg.id}
                      className={`rounded-md border px-3 py-2 text-xs transition-colors ${
                        isKept
                          ? 'border-green-200 bg-green-50/50 dark:border-green-800 dark:bg-green-950/30'
                          : 'border-zinc-100 bg-zinc-50/50 text-zinc-400 line-through dark:border-zinc-800 dark:bg-zinc-800/30 dark:text-zinc-500'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className={`font-medium ${
                          isKept
                            ? 'text-zinc-700 dark:text-zinc-300'
                            : 'text-zinc-400 dark:text-zinc-500'
                        }`}>
                          {msg.role === 'user' ? '用户' : '助手'}
                        </span>
                        <span className="text-zinc-300 dark:text-zinc-600">·</span>
                        <span className="text-zinc-300 dark:text-zinc-600">{msg.content.length} 字符</span>
                        {isKept && (
                          <span className="ml-auto text-[10px] text-green-600 dark:text-green-400">保留</span>
                        )}
                        {!isKept && (
                          <span className="ml-auto text-[10px] text-zinc-400 dark:text-zinc-500">压缩</span>
                        )}
                      </div>
                      <p className={`leading-relaxed ${
                        isKept
                          ? 'text-zinc-600 dark:text-zinc-400'
                          : 'text-zinc-400 dark:text-zinc-500'
                      }`}>
                        {truncate(msg.content, 80)}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 右侧：压缩后 / Loading / Error */}
            <div className="flex w-1/2 flex-col">
              <div className="border-b border-zinc-100 bg-blue-50/50 px-4 py-2 dark:border-zinc-800 dark:bg-blue-950/20">
                <span className="text-xs font-medium text-blue-600 dark:text-blue-400">
                  {previewLoading ? '生成中...' : `压缩后（${compressedCount} 条）`}
                </span>
              </div>
              <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
                {previewLoading && (
                  <div className="flex flex-col items-center justify-center h-full gap-3 text-zinc-400">
                    <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
                    <span className="text-xs">正在生成摘要...</span>
                  </div>
                )}
                {!previewLoading && compressedMessages && compressedMessages.map((msg, i) => {
                  const isSummary = i === 0 && msg.id.startsWith('compress-summary');
                  return (
                    <div
                      key={msg.id}
                      className={`rounded-md border px-3 py-2 text-xs ${
                        isSummary
                          ? 'border-blue-200 bg-blue-50/50 dark:border-blue-800 dark:bg-blue-950/30'
                          : 'border-green-200 bg-green-50/50 dark:border-green-800 dark:bg-green-950/30'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className="font-medium text-zinc-700 dark:text-zinc-300">
                          {msg.role === 'user' ? '用户' : '助手'}
                        </span>
                        <span className="text-zinc-300 dark:text-zinc-600">·</span>
                        <span className="text-zinc-300 dark:text-zinc-600">{msg.content.length} 字符</span>
                        {isSummary && (
                          <span className="ml-auto text-[10px] text-blue-600 dark:text-blue-400">摘要</span>
                        )}
                      </div>
                      <p className="text-zinc-600 dark:text-zinc-400 leading-relaxed whitespace-pre-line">
                        {truncate(msg.content, 120)}
                      </p>
                    </div>
                  );
                })}
                {!previewLoading && !compressedMessages && !error && (
                  <div className="flex items-center justify-center h-full text-xs text-zinc-400">
                    等待加载...
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Error banner */}
          {error && (
            <div className="mx-5 mb-0 mt-2 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
              <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Footer: 统计 + 按钮 */}
          <div className="flex items-center justify-between border-t border-zinc-200 px-5 py-3 dark:border-zinc-700">
            <div className="text-xs text-zinc-500 space-x-3">
              <span>原始 {originalCount} 条 / {originalChars.toLocaleString()} 字符</span>
              {compressedMessages && (
                <>
                  <span>→</span>
                  <span className="text-blue-600 dark:text-blue-400">
                    压缩后 {compressedCount} 条 / {compressedChars.toLocaleString()} 字符
                  </span>
                  <span className="text-green-600 dark:text-green-400">节省 {savedPercent}%</span>
                </>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={onClose}
                disabled={isLoading}
                className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 disabled:opacity-50"
              >
                取消
              </button>
              <button
                onClick={handleConfirm}
                disabled={!compressedMessages || isLoading}
                className="rounded-md bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5"
              >
                {applyLoading && <Loader2 className="h-3 w-3 animate-spin" />}
                {applyLoading ? '正在保存...' : '确认压缩'}
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
});
