'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Search, Maximize2 } from 'lucide-react';
import type { Agent } from '@/types';
import { AgentIcon } from '@/components/agent-form';

interface AgentPickerDropdownProps {
  open: boolean;
  onClose: () => void;
  onSelect: (agent: Agent) => void;
  onExpand: () => void;
  agents: Agent[];
  activeProjectKey?: string;
  recentAgentIds?: string[];
}

export function AgentPickerDropdown({
  open,
  onClose,
  onSelect,
  onExpand,
  agents,
  activeProjectKey,
  recentAgentIds = [],
}: AgentPickerDropdownProps) {
  const [query, setQuery] = useState('');
  const [highlightIdx, setHighlightIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Reset state when dropdown opens
  useEffect(() => {
    if (open) {
      setQuery('');
      setHighlightIdx(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, onClose]);

  // ── Categorize agents ──
  const groups = useMemo(() => {
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

    recent.sort((a, b) => recentAgentIds.indexOf(a.id) - recentAgentIds.indexOf(b.id));

    const result: { label: string; items: Agent[] }[] = [];
    if (recent.length > 0) result.push({ label: '最近使用', items: recent });
    if (builtin.length > 0) result.push({ label: '内置', items: builtin });
    if (project.length > 0) result.push({ label: '项目专属', items: project });
    if (global.length > 0) result.push({ label: '全局', items: global });

    return result;
  }, [agents, activeProjectKey, recentAgentIds]);

  // ── Filtered flat list (for search + keyboard nav) ──
  const filtered = useMemo(() => {
    if (!query.trim()) return agents;
    const q = query.toLowerCase();
    return agents.filter(a =>
      a.name.toLowerCase().includes(q) ||
      (a.description ?? '').toLowerCase().includes(q) ||
      a.id.toLowerCase().includes(q)
    );
  }, [agents, query]);

  // Clamp highlight index
  useEffect(() => {
    setHighlightIdx(i => Math.min(i, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  // Scroll highlighted into view
  useEffect(() => {
    const items = listRef.current?.querySelectorAll('[data-agent-item]');
    const el = items?.[highlightIdx] as HTMLElement | undefined;
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

  const isSearching = query.trim().length > 0;

  // Build flat index map for highlighting during grouped view
  const agentIndexMap = new Map<string, number>();
  if (!isSearching) {
    let idx = 0;
    for (const g of groups) {
      for (const a of g.items) {
        // Only map first occurrence
        if (!agentIndexMap.has(a.id)) agentIndexMap.set(a.id, idx++);
      }
    }
  }

  const renderItem = (a: Agent, flatIdx: number) => (
    <button
      key={a.id + '-' + flatIdx}
      data-agent-item
      onClick={() => { onSelect(a); onClose(); }}
      onMouseEnter={() => setHighlightIdx(flatIdx)}
      className={`flex w-full items-center gap-2.5 rounded-md px-3 py-1.5 text-left transition-colors ${
        flatIdx === highlightIdx
          ? 'bg-zinc-100 dark:bg-zinc-800'
          : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
      }`}
    >
      <AgentIcon iconKey={a.icon} className="h-4 w-4 shrink-0 text-zinc-400" />
      <span className="min-w-0 flex-1 truncate text-[13px] text-zinc-800 dark:text-zinc-200">
        {a.name}
      </span>
      {a.projectKey && (
        <span className="shrink-0 text-[10px] text-zinc-400 dark:text-zinc-500">
          {a.projectKey}
        </span>
      )}
    </button>
  );

  return (
    <div
      ref={containerRef}
      className="absolute right-0 top-full z-50 mt-1 w-64 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
      onKeyDown={handleKeyDown}
    >
      {/* Search */}
      <div className="flex items-center gap-2 border-b border-zinc-100 px-3 py-2 dark:border-zinc-800">
        <Search className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="搜索 Agent..."
          className="flex-1 bg-transparent text-[13px] text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-100 dark:placeholder:text-zinc-500"
        />
        <button
          onClick={(e) => { e.stopPropagation(); onExpand(); }}
          className="rounded p-0.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
          title="展开为面板"
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Agent list */}
      <div ref={listRef} className="max-h-[320px] overflow-y-auto py-1 px-1">
        {isSearching ? (
          // Flat search results
          filtered.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-zinc-400 dark:text-zinc-500">
              没有匹配的 Agent
            </div>
          ) : (
            filtered.map((a, i) => renderItem(a, i))
          )
        ) : (
          // Grouped view
          groups.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-zinc-400 dark:text-zinc-500">
              暂无 Agent
            </div>
          ) : (
            groups.map(g => (
              <div key={g.label}>
                <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                  {g.label}
                </div>
                {g.items.map(a => renderItem(a, agentIndexMap.get(a.id) ?? 0))}
              </div>
            ))
          )
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-zinc-100 px-3 py-1.5 dark:border-zinc-800">
        <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
          {agents.length} 个 Agent
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); onExpand(); }}
          className="flex items-center gap-1 text-[10px] text-zinc-400 transition-colors hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300"
        >
          <Maximize2 className="h-3 w-3" />
          展开面板
        </button>
      </div>
    </div>
  );
}
