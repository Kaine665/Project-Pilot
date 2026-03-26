'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { X, Search } from 'lucide-react';
import { useTranslations } from '@/client/i18n/use-translations';
import type { Agent } from '@/types';
import { AgentAvatar } from '@/components/agent-form';

type FilterChip = 'all' | 'recent' | 'builtin' | 'project' | 'global';

interface AgentPickerModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (agent: Agent) => void;
  agents: Agent[];
  activeProjectKey?: string;
  recentAgentIds?: string[];
}

export function AgentPickerModal({
  open,
  onClose,
  onSelect,
  agents,
  activeProjectKey,
  recentAgentIds = [],
}: AgentPickerModalProps) {
  const t = useTranslations('agentsWorkspace.picker');
  const [query, setQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<FilterChip>('all');
  const [highlightIdx, setHighlightIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      const frame = requestAnimationFrame(() => {
        setQuery('');
        setActiveFilter('all');
        setHighlightIdx(0);
        inputRef.current?.focus();
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [open]);

  const categorized = useMemo(() => {
    const recentSet = new Set(recentAgentIds.slice(0, 5));
    const recent: Agent[] = [];
    const builtin: Agent[] = [];
    const project: Agent[] = [];
    const global: Agent[] = [];

    for (const agent of agents) {
      if (recentSet.has(agent.id)) recent.push(agent);
      if (agent.id.startsWith('agent-builtin-')) {
        builtin.push(agent);
      } else if (agent.projectKey && agent.projectKey === activeProjectKey) {
        project.push(agent);
      } else {
        global.push(agent);
      }
    }

    recent.sort((a, b) => recentAgentIds.indexOf(a.id) - recentAgentIds.indexOf(b.id));
    return { recent, builtin, project, global };
  }, [activeProjectKey, agents, recentAgentIds]);

  const filtered = useMemo(() => {
    let pool: Agent[];
    switch (activeFilter) {
      case 'recent':
        pool = categorized.recent;
        break;
      case 'builtin':
        pool = categorized.builtin;
        break;
      case 'project':
        pool = categorized.project;
        break;
      case 'global':
        pool = categorized.global;
        break;
      default:
        pool = agents;
        break;
    }

    if (!query.trim()) return pool;
    const normalized = query.toLowerCase();
    return pool.filter((agent) =>
      agent.name.toLowerCase().includes(normalized)
      || (agent.description ?? '').toLowerCase().includes(normalized)
      || agent.id.toLowerCase().includes(normalized),
    );
  }, [activeFilter, agents, categorized, query]);

  const activeIndex = Math.min(highlightIdx, Math.max(0, filtered.length - 1));

  useEffect(() => {
    const el = listRef.current?.children[activeIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightIdx((idx) => (idx + 1) % Math.max(1, filtered.length));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightIdx((idx) => (idx - 1 + filtered.length) % Math.max(1, filtered.length));
        break;
      case 'Enter':
        e.preventDefault();
        if (filtered[activeIndex]) {
          onSelect(filtered[activeIndex]);
          onClose();
        }
        break;
      case 'Escape':
        e.preventDefault();
        onClose();
        break;
      default:
        break;
    }
  }, [activeIndex, filtered, onClose, onSelect]);

  if (!open) return null;

  const filterChips: { key: FilterChip; label: string; count: number }[] = [
    { key: 'all', label: t('filter.all'), count: agents.length },
    { key: 'recent', label: t('filter.recent'), count: categorized.recent.length },
    { key: 'builtin', label: t('filter.builtin'), count: categorized.builtin.length },
    ...(categorized.project.length > 0
      ? [{ key: 'project' as const, label: t('filter.project'), count: categorized.project.length }]
      : []),
    { key: 'global', label: t('filter.global'), count: categorized.global.length },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[15vh] backdrop-blur-[2px]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={handleKeyDown}
    >
      <div className="w-full max-w-[480px] overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900">
        <div className="flex items-center gap-3 border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
          <Search className="h-4 w-4 shrink-0 text-zinc-400" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('searchPlaceholder')}
            className="flex-1 bg-transparent text-sm text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-100 dark:placeholder:text-zinc-500"
          />
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
            title={t('close')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center gap-1.5 border-b border-zinc-100 px-4 py-2 dark:border-zinc-800">
          {filterChips.map((chip) => (
            <button
              key={chip.key}
              onClick={() => {
                setActiveFilter(chip.key);
                setHighlightIdx(0);
              }}
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

        <div ref={listRef} className="max-h-[360px] overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-zinc-400 dark:text-zinc-500">
              {query ? t('noMatch') : t('emptyInFilter')}
            </div>
          ) : (
            filtered.map((agent, idx) => (
              <button
                key={agent.id}
                onClick={() => {
                  onSelect(agent);
                  onClose();
                }}
                onMouseEnter={() => setHighlightIdx(idx)}
                className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                    idx === activeIndex
                    ? 'bg-zinc-100 dark:bg-zinc-800'
                    : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                }`}
              >
                <AgentAvatar slug={agent.slug} iconKey={agent.icon} className="h-9 w-9 shrink-0 rounded-lg" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {agent.name}
                  </div>
                  {agent.description ? (
                    <div className="truncate text-xs text-zinc-400 dark:text-zinc-500">
                      {agent.description}
                    </div>
                  ) : null}
                </div>
                {agent.projectKey ? (
                  <span className="shrink-0 rounded-md bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
                    {agent.projectKey}
                  </span>
                ) : null}
              </button>
            ))
          )}
        </div>

        <div className="flex items-center justify-between border-t border-zinc-100 px-4 py-2 dark:border-zinc-800">
          <div className="flex items-center gap-3 text-[10px] text-zinc-400 dark:text-zinc-500">
            <span><kbd className="rounded border border-zinc-200 px-1 py-0.5 font-mono dark:border-zinc-700">↑↓</kbd> {t('keyboard.navigate')}</span>
            <span><kbd className="rounded border border-zinc-200 px-1 py-0.5 font-mono dark:border-zinc-700">Enter</kbd> {t('keyboard.select')}</span>
            <span><kbd className="rounded border border-zinc-200 px-1 py-0.5 font-mono dark:border-zinc-700">Esc</kbd> {t('keyboard.close')}</span>
          </div>
          <div className="text-[10px] text-zinc-400 dark:text-zinc-500">
            {t('count', { count: filtered.length })}
          </div>
        </div>
      </div>
    </div>
  );
}
