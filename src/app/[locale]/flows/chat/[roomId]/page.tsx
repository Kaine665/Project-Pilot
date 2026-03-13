'use client';

import { useState, useEffect, useRef, use } from 'react';
import { useRouter } from '@/i18n/routing';
import { ArrowLeft, Send, Sparkles, X, Copy, Check } from 'lucide-react';
import type { ChatMessage, ChatUser } from '@/lib/chat-store';

const USER_KEY = 'pp_chat_user';

function getSavedUser(): ChatUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ChatUser;
  } catch {
    return null;
  }
}

export default function ChatRoomPage({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = use(params);
  const router = useRouter();

  const [user, setUser] = useState<ChatUser | null>(null);
  const [roomName, setRoomName] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);

  const [summary, setSummary] = useState('');
  const [summarizing, setSummarizing] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const sseRef = useRef<EventSource | null>(null);

  // Load user
  useEffect(() => {
    const saved = getSavedUser();
    if (!saved) {
      router.push('/flows/chat');
      return;
    }
    setUser(saved);
  }, [router]);

  // Load room info + history
  useEffect(() => {
    if (!user) return;

    fetch(`/api/chat/rooms`)
      .then(r => r.json())
      .then(data => {
        const room = (data.rooms ?? []).find((r: { id: string; name: string }) => r.id === roomId);
        if (room) setRoomName(room.name);
        else router.push('/flows/chat');
      })
      .catch(() => {});

    fetch(`/api/chat/${roomId}/messages`)
      .then(r => r.json())
      .then(data => setMessages(data.messages ?? []))
      .catch(() => {});
  }, [user, roomId, router]);

  // SSE subscription
  useEffect(() => {
    if (!user) return;

    const es = new EventSource(`/api/chat/${roomId}/sse`);
    sseRef.current = es;

    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data) as ChatMessage;
        if (msg.id) {
          setMessages(prev => {
            // Deduplicate
            if (prev.some(m => m.id === msg.id)) return prev;
            return [...prev, msg];
          });
        }
      } catch {
        // ignore
      }
    };

    return () => {
      es.close();
      sseRef.current = null;
    };
  }, [user, roomId]);

  // Auto-scroll on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function handleSend() {
    if (!user || !input.trim() || sending) return;
    const content = input.trim();
    setInput('');
    setSending(true);
    try {
      await fetch(`/api/chat/${roomId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ senderId: user.id, senderName: user.username, content }),
      });
    } catch {
      // ignore — message will appear via SSE if succeeded
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  async function handleSummarize() {
    setSummarizing(true);
    setSummaryOpen(true);
    setSummary('');
    try {
      const res = await fetch(`/api/chat/${roomId}/summarize`, { method: 'POST' });
      const data = await res.json();
      setSummary(data.summary ?? data.error ?? '生成失败');
    } catch {
      setSummary('网络错误，请重试');
    } finally {
      setSummarizing(false);
    }
  }

  async function handleCopy() {
    if (!summary) return;
    await navigator.clipboard.writeText(summary).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function formatTime(iso: string) {
    return new Date(iso).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }

  const isMine = (msg: ChatMessage) => msg.senderId === user?.id;

  return (
    <div className="flex h-full flex-col bg-zinc-50 dark:bg-zinc-950">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center gap-2">
          <button
            onClick={() => router.push('/flows/chat')}
            className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{roomName || '加载中...'}</h2>
        </div>
        <button
          onClick={handleSummarize}
          disabled={summarizing || messages.length === 0}
          className="flex items-center gap-1.5 rounded-lg bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-200 disabled:opacity-50 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
        >
          <Sparkles className="h-3.5 w-3.5" />
          {summarizing ? 'AI 分析中...' : 'AI 总结'}
        </button>
      </div>

      {/* AI Summary panel */}
      {summaryOpen && (
        <div className="border-b border-zinc-200 bg-amber-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900/50">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
              <span className="text-xs font-medium text-amber-700 dark:text-amber-400">AI 对话摘要</span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={handleCopy}
                disabled={!summary || summarizing}
                className="rounded p-1 text-zinc-400 hover:text-zinc-600 disabled:opacity-40 dark:hover:text-zinc-300"
              >
                {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
              <button
                onClick={() => setSummaryOpen(false)}
                className="rounded p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <div className="mt-2 text-sm text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap">
            {summarizing ? (
              <span className="text-zinc-400 animate-pulse">生成中，请稍候...</span>
            ) : (
              summary
            )}
          </div>
        </div>
      )}

      {/* Message list */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-zinc-400">暂无消息，发送第一条消息开始对话</p>
          </div>
        ) : (
          <div className="space-y-3">
            {messages.map((msg) => {
              const mine = isMine(msg);
              return (
                <div key={msg.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[72%] ${mine ? 'items-end' : 'items-start'} flex flex-col gap-0.5`}>
                    {!mine && (
                      <span className="px-1 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                        {msg.senderName}
                      </span>
                    )}
                    <div
                      className={`rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                        mine
                          ? 'rounded-tr-sm bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                          : 'rounded-tl-sm bg-white text-zinc-900 shadow-sm ring-1 ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-100 dark:ring-zinc-700'
                      }`}
                    >
                      {msg.content}
                    </div>
                    <span className="px-1 text-[11px] text-zinc-400">{formatTime(msg.createdAt)}</span>
                  </div>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="border-t border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="输入消息，Enter 发送，Shift+Enter 换行"
            rows={1}
            style={{ resize: 'none' }}
            className="flex-1 rounded-xl border border-zinc-300 bg-zinc-50 px-3 py-2.5 text-sm outline-none transition-colors focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:border-zinc-500"
            onInput={e => {
              const t = e.currentTarget;
              t.style.height = 'auto';
              t.style.height = Math.min(t.scrollHeight, 120) + 'px';
            }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || sending}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-zinc-900 text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
        {user && (
          <p className="mt-1.5 text-xs text-zinc-400">
            以 <span className="font-medium text-zinc-500 dark:text-zinc-400">{user.username}</span> 身份发送
          </p>
        )}
      </div>
    </div>
  );
}
