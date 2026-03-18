'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { X, Search } from 'lucide-react';
import type { Agent } from '@/types';
import { AgentIcon } from '@/components/agent-form';

// ── Types ──

type FilterChip = 'all' | 'recent' | 'builtin' | 'project' | 'global';

interface AgentPickerModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (agent: Agent) => void;
  agents: Agent[];
  /** Current active project key for categorization */
  activeProjectKey?: string;
  /** Recently used agent IDs (ordered, most recent first) */
  recentAgentIds?: string[];
}

// ── Component ──

export function AgentPickerModal({
  open,
  onClose,
  onSelect,
  agents,
  activeProjectKey,
  recentAgentIds = [],
}: AgentPickerModalProps) {
  const [query, setQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<FilterChip>('all');
  const [highlightIdx, setHighlightIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveFilter('all');
      setHighlightIdx(0);
      // Focus search input after mount
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // ── Categorize agents ──
  const categorized = useMemo(() => {
    const recentSet = new Set(recentAgentIds.slice(0, 5));
    const recent: Agent[] = [];
    const builtin: Agent[] = [];
    const project: Agent[] = [];
    const global: Agent[] = [];

    for (const a of agents) {
      if (recentSet.has(a.id)) recent.push(a);
      if (a.id.startsWith('agent-builtin-')) {
        builtin.push(a);
      } else if (a.projectKey && a.projectKey === activeProjectKey) {
        project.push(a);
      } else {
        global.push(a);
      }
    }

    // Sort recent by original order
    recent.sort((a, b) => recentAgentIds.indexOf(a.id) - recentAgentIds.indexOf(b.id));

    return { recent, builtin, project, global };
  }, [agents, activeProjectKey, recentAgentIds]);

  // ── Filter + search ──
  const filtered = useMemo(() => {
    let pool: Agent[];
    switch (activeFilter) {
      case 'recent':  pool = categorized.recent; break;
      case 'builtin': pool = categorized.builtin; break;
      case 'project': pool = categorized.project; break;
      case 'global':  pool = categorized.global; break;
      default:        pool = agents;
    }

    if (!query.trim()) return pool;

    const q = query.toLowerCase();
    return pool.filter(a =>
      a.name.toLowerCase().includes(q) ||
      (a.description ?? '').toLowerCase().includes(q) ||
      a.id.toLowerCase().includes(q)
    );
  }, [agents, categorized, activeFilter, query]);

  // Clamp highlight index
  useEffect(() => {
    setHighlightIdx(i => Math.min(i, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  // Scroll highlighted item into view
  useEffect(() => {
    const el = listRef.current?.children[highlightIdx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [highlightIdx]);

  // ── Keyboard navigation ──
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightIdx(i => (i + 1) % Math.max(1, filtered.length));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightIdx(i => (i - 1 + filtered.length) % Math.max(1, filtered.length));
        break;
      case 'Enter':
        e.preventDefault();
        if (filtered[highlightIdx]) {
          onSelect(filtered[highlightIdx]);
          onClose();
        }
        break;
      case 'Escape':
        e.preventDefault();
        onClose();
        break;
    }
  }, [filtered, highlightIdx, onSelect, onClose]);

  if (!open) return null;

  const filterChips: { key: FilterChip; label: string; count: number }[] = [
    { key: 'all', label: '全部', count: agents.length },
    { key: 'recent', label: '最近', count: categorized.recent.length },
    { key: 'builtin', label: '内置', count: categorized.builtin.length },
    ...(categorized.project.length > 0
      ? [{ key: 'project' as FilterChip, label: '项目', count: categorized.project.length }]
      : []),
    { key: 'global', label: '全局', count: categorized.global.length },
  ];

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[15vh] backdrop-blur-[2px]"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onKeyDown={handleKeyDown}
    >
      {/* Panel */}
      <div className="w-full max-w-[480px] overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900">
        {/* Header: search */}
        <div className="flex items-center gap-3 border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
          <Search className="h-4 w-4 shrink-0 text-zinc-400" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="搜索 Agent..."
            className="flex-1 bg-transparent text-sm text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-100 dark:placeholder:text-zinc-500"
          />
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Filter chips */}
        <div className="flex items-center gap-1.5 border-b border-zinc-100 px-4 py-2 dark:border-zinc-800">
          {filterChips.map(chip => (
            <button
              key={chip.key}
              onClick={() => { setActiveFilter(chip.key); setHighlightIdx(0); }}
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors ${
                activeFilter === chip.key
                  ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                  : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700'
              }`}
            >
              {chip.label}
              <span className="ml-1 opacity-60">{chip.count}</span>
            </button>
          ))}
        </div>

        {/* Agent list */}
        <div ref={listRef} className="max-h-[360px] overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-zinc-400 dark:text-zinc-500">
              {query ? '没有匹配的 Agent' : '此分类下没有 Agent'}
            </div>
          ) : (
            filtered.map((a, i) => (
              <button
                key={a.id}
                onClick={() => { onSelect(a); onClose(); }}
                onMouseEnter={() => setHighlightIdx(i)}
                className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                  i === highlightIdx
                    ? 'bg-zinc-100 dark:bg-zinc-800'
                    : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                }`}
              >
                <AgentIcon iconKey={a.icon} className="h-5 w-5 shrink-0 text-zinc-400" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {a.name}
                  </div>
                  {a.description && (
                    <div className="truncate text-xs text-zinc-400 dark:text-zinc-500">
                      {a.description}
                    </div>
                  )}
                </div>
                {a.projectKey && (
                  <span className="shrink-0 rounded-md bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
                    {a.projectKey}
                  </span>
                )}
              </button>
            ))
          )}
        </div>

        {/* Footer hint */}
        <div className="flex items-center justify-between border-t border-zinc-100 px-4 py-2 dark:border-zinc-800">
          <div className="flex items-center gap-3 text-[10px] text-zinc-400 dark:text-zinc-500">
            <span><kbd className="rounded border border-zinc-200 px-1 py-0.5 font-mono dark:border-zinc-700">↑↓</kbd> 导航</span>
            <span><kbd className="rounded border border-zinc-200 px-1 py-0.5 font-mono dark:border-zinc-700">Enter</kbd> 选择</span>
            <span><kbd className="rounded border border-zinc-200 px-1 py-0.5 font-mono dark:border-zinc-700">Esc</kbd> 关闭</span>
          </div>
          <div className="text-[10px] text-zinc-400 dark:text-zinc-500">
            {filtered.length} 个 Agent
          </div>
        </div>
      </div>
    </div>
  );
}
