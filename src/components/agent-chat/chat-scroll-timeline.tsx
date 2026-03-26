'use client';

import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import type { ChatMessage, ChatToolCall, ContentBlock } from '@/types';

type TimelineStatus = 'running' | 'completed' | 'failed';

interface TimelineEntry {
  id: string;
  role: ChatMessage['role'];
  title: string;
  detail: string | null;
  status: TimelineStatus;
  kind: 'user' | 'tool' | 'reply';
}

export interface ChatScrollTimelineProps {
  messages: ChatMessage[];
  isStreaming: boolean;
  streamingBlocks: ContentBlock[];
  currentMessageId: string | null;
  onSelectMessage: (messageId: string) => void;
}

const STEP_GAP = 14;
const MAX_VISIBLE_STEPS = 13;

function normalizeText(text: string): string {
  return text
    .replace(/<session-title>[\s\S]*?<\/session-title>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function summarizeText(text: string, maxLength = 26): string {
  const normalized = normalizeText(text);
  if (!normalized) return '';
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength).trimEnd()}...`;
}

function getMessageText(message: ChatMessage, blocks?: ContentBlock[]): string {
  const sourceBlocks = blocks ?? message.contentBlocks ?? [];
  const blockText = sourceBlocks
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map((block) => block.text)
    .join(' ')
    .trim();

  return blockText || message.content || '';
}

function getToolCalls(message: ChatMessage, blocks?: ContentBlock[]): ChatToolCall[] {
  const sourceBlocks = blocks ?? message.contentBlocks ?? [];
  const blockTools = sourceBlocks
    .filter((block): block is Extract<ContentBlock, { type: 'tool_call' }> => block.type === 'tool_call')
    .map((block) => block.toolCall);

  if (blockTools.length > 0) return blockTools;
  return message.toolCalls ?? [];
}

function categorizeTool(toolName: string): 'read' | 'shell' | 'write' | 'other' {
  if (toolName === 'Read' || toolName === 'Grep' || toolName === 'Glob') return 'read';
  if (toolName === 'Bash') return 'shell';
  if (toolName === 'Edit' || toolName === 'Write' || toolName === 'NotebookEdit') return 'write';
  return 'other';
}

function summarizeTools(toolCalls: ChatToolCall[]): string {
  if (toolCalls.length === 0) return '';

  const counts = new Map<string, number>();
  for (const toolCall of toolCalls) {
    const category = categorizeTool(toolCall.toolName);
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }

  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const [kind, count] = ranked[0] ?? ['other', toolCalls.length];

  if (kind === 'read') return `Read ${count}`;
  if (kind === 'shell') return `Run ${count}`;
  if (kind === 'write') return `Edit ${count}`;
  return `Tools ${toolCalls.length}`;
}

function buildEntries(messages: ChatMessage[], isStreaming: boolean, streamingBlocks: ContentBlock[]): TimelineEntry[] {
  const entries = messages.map<TimelineEntry>((message) => {
    const toolCalls = getToolCalls(message);
    const textSummary = summarizeText(getMessageText(message));
    const failed = toolCalls.some((toolCall) => toolCall.status === 'failed');

    if (message.role === 'user') {
      return {
        id: message.id,
        role: 'user',
        title: textSummary || 'User turn',
        detail: message.images?.length ? `${message.images.length} image(s)` : null,
        status: 'completed',
        kind: 'user',
      };
    }

    if (toolCalls.length > 0) {
      return {
        id: message.id,
        role: 'assistant',
        title: summarizeTools(toolCalls),
        detail: textSummary || null,
        status: failed ? 'failed' : 'completed',
        kind: 'tool',
      };
    }

    return {
      id: message.id,
      role: 'assistant',
      title: textSummary || 'Assistant reply',
      detail: null,
      status: 'completed',
      kind: 'reply',
    };
  });

  if (isStreaming) {
    const syntheticMessage: ChatMessage = {
      id: 'streaming',
      role: 'assistant',
      content: '',
      timestamp: '',
    };
    const toolCalls = getToolCalls(syntheticMessage, streamingBlocks);
    const textSummary = summarizeText(getMessageText(syntheticMessage, streamingBlocks));
    const failed = toolCalls.some((toolCall) => toolCall.status === 'failed');

    entries.push({
      id: 'streaming',
      role: 'assistant',
      title: toolCalls.length > 0 ? summarizeTools(toolCalls) : textSummary || 'Thinking',
      detail: toolCalls.length > 0 ? textSummary || null : 'Waiting for output',
      status: failed ? 'failed' : 'running',
      kind: toolCalls.length > 0 ? 'tool' : 'reply',
    });
  }

  return entries;
}

function NodeBar({ active }: { active: boolean }) {
  return (
    <div
      className={cn(
        'rounded-full transition-all',
        active
          ? 'h-1.5 w-8 bg-blue-500 dark:bg-blue-400'
          : 'h-1 w-5 bg-white ring-1 ring-zinc-300 dark:bg-zinc-100 dark:ring-zinc-600',
      )}
    />
  );
}

export function ChatScrollTimeline({
  messages,
  isStreaming,
  streamingBlocks,
  currentMessageId,
  onSelectMessage,
}: ChatScrollTimelineProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const entries = useMemo(
    () => buildEntries(messages, isStreaming, streamingBlocks),
    [messages, isStreaming, streamingBlocks],
  );

  const activeIndex = useMemo(() => {
    if (entries.length === 0) return -1;
    const currentIndex = entries.findIndex((entry) => entry.id === currentMessageId);
    if (currentIndex >= 0) return currentIndex;
    return entries.length - 1;
  }, [entries, currentMessageId]);

  const visibleEntries = useMemo(() => {
    if (entries.length === 0 || activeIndex < 0) return [];

    const visibleCount = Math.min(MAX_VISIBLE_STEPS, entries.length);
    const half = Math.floor(visibleCount / 2);
    let start = Math.max(0, activeIndex - half);
    let end = start + visibleCount;

    if (end > entries.length) {
      end = entries.length;
      start = Math.max(0, end - visibleCount);
    }

    return entries.slice(start, end).map((entry, index) => ({
      ...entry,
      offset: index - (activeIndex - start),
    }));
  }, [entries, activeIndex]);

  const hoveredEntry = visibleEntries.find((entry) => entry.id === hoveredId) ?? null;

  if (visibleEntries.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-y-0 right-16 z-20 hidden items-center md:flex lg:right-20">
      <div className="relative h-[280px] w-14">
        <div className="pointer-events-none absolute inset-y-6 left-1/2 w-px -translate-x-1/2 rounded-full bg-zinc-300/80 dark:bg-zinc-700/80" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-10 bg-gradient-to-b from-white via-white/85 to-transparent dark:from-zinc-950 dark:via-zinc-950/85" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-white via-white/85 to-transparent dark:from-zinc-950 dark:via-zinc-950/85" />

        {visibleEntries.map((entry) => {
          const active = entry.id === currentMessageId;
          const top = 140 + entry.offset * STEP_GAP;

          return (
            <button
              key={entry.id}
              type="button"
              aria-label={entry.title}
              title={entry.detail ? `${entry.title} - ${entry.detail}` : entry.title}
              onClick={() => onSelectMessage(entry.id)}
              onMouseEnter={() => setHoveredId(entry.id)}
              onMouseLeave={() => setHoveredId((prev) => (prev === entry.id ? null : prev))}
              onFocus={() => setHoveredId(entry.id)}
              onBlur={() => setHoveredId((prev) => (prev === entry.id ? null : prev))}
              className={cn(
                'pointer-events-auto absolute left-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center transition-all',
                active
                  ? 'shadow-[0_0_0_3px_rgba(59,130,246,0.12)]'
                  : 'hover:scale-110',
              )}
              style={{ top: `${top}px` }}
            >
              <NodeBar active={active} />
            </button>
          );
        })}

        {hoveredEntry && (
          <div
            className="pointer-events-none absolute left-0 z-30 w-48 -translate-x-full -translate-y-1/2 rounded-xl border border-zinc-200 bg-white/96 px-3 py-2 text-left shadow-lg backdrop-blur dark:border-zinc-700 dark:bg-zinc-950/96"
            style={{ top: `${140 + hoveredEntry.offset * STEP_GAP}px` }}
          >
            <div className="text-[11px] font-semibold text-zinc-800 dark:text-zinc-100">
              {hoveredEntry.title}
            </div>
            {hoveredEntry.detail && (
              <div className="mt-1 text-[10px] leading-4 text-zinc-500 dark:text-zinc-400">
                {hoveredEntry.detail}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
