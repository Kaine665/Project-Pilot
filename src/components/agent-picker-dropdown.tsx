'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Search, Maximize2 } from 'lucide-react';
import { useTranslations } from '@/client/i18n/use-translations';
import type { Agent } from '@/types';
import { AgentAvatar } from '@/components/agent-form';

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
  const t = useTranslations('agentsWorkspace.picker');
  const [query, setQuery] = useState('');
  const [highlightIdx, setHighlightIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setHighlightIdx(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

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

  const groups = useMemo(() => {
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

    const result: { label: string; items: Agent[] }[] = [];
    if (recent.length > 0) result.push({ label: t('group.recent'), items: recent });
    if (builtin.length > 0) result.push({ label: t('group.builtin'), items: builtin });
    if (project.length > 0) result.push({ label: t('group.project'), items: project });
    if (global.length > 0) result.push({ label: t('group.global'), items: global });
    return result;
  }, [activeProjectKey, agents, recentAgentIds, t]);

  const isSearching = query.trim().length > 0;

  const groupedFlat = useMemo(() => {
    const result: { agent: Agent; group: string }[] = [];
    for (const group of groups) {
      for (const agent of group.items) {
        result.push({ agent, group: group.label });
      }
    }
    return result;
  }, [groups]);

  const searchResults = useMemo(() => {
    if (!isSearching) return [];
    const normalized = query.toLowerCase();
    return agents.filter((agent) =>
      agent.name.toLowerCase().includes(normalized)
      || (agent.description ?? '').toLowerCase().includes(normalized)
      || agent.id.toLowerCase().includes(normalized),
    );
  }, [agents, isSearching, query]);

  const totalItems = isSearching ? searchResults.length : groupedFlat.length;

  useEffect(() => {
    setHighlightIdx((idx) => Math.min(idx, Math.max(0, totalItems - 1)));
  }, [totalItems]);

  useEffect(() => {
    const items = listRef.current?.querySelectorAll('[data-agent-item]');
    const el = items?.[highlightIdx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [highlightIdx]);

  const getAgentAt = useCallback((idx: number): Agent | undefined => {
    if (isSearching) return searchResults[idx];
    return groupedFlat[idx]?.agent;
  }, [groupedFlat, isSearching, searchResults]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightIdx((idx) => (idx + 1) % Math.max(1, totalItems));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightIdx((idx) => (idx - 1 + totalItems) % Math.max(1, totalItems));
        break;
      case 'Enter': {
        e.preventDefault();
        const agent = getAgentAt(highlightIdx);
        if (agent) {
          onSelect(agent);
          onClose();
        }
        break;
      }
      case 'Escape':
        e.preventDefault();
        onClose();
        break;
      default:
        break;
    }
  }, [getAgentAt, highlightIdx, onClose, onSelect, totalItems]);

  if (!open) return null;

  const renderItem = (agent: Agent, flatIdx: number, keyPrefix: string) => (
    <button
      key={`${keyPrefix}-${agent.id}`}
      data-agent-item
      onClick={() => {
        onSelect(agent);
        onClose();
      }}
      onMouseEnter={() => setHighlightIdx(flatIdx)}
      className={`flex w-full items-center gap-2.5 rounded-md px-3 py-1.5 text-left transition-colors ${
        flatIdx === highlightIdx
          ? 'bg-zinc-100 dark:bg-zinc-800'
          : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
      }`}
    >
      <AgentAvatar slug={agent.slug} iconKey={agent.icon} className="h-7 w-7 shrink-0 rounded-md" />
      <span className="min-w-0 flex-1 truncate text-[13px] text-zinc-800 dark:text-zinc-200">
        {agent.name}
      </span>
      {agent.projectKey ? (
        <span className="shrink-0 text-[10px] text-zinc-400 dark:text-zinc-500">
          {agent.projectKey}
        </span>
      ) : null}
    </button>
  );

  return (
    <div
      ref={containerRef}
      className="absolute right-0 top-full z-50 mt-1 w-64 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
      onKeyDown={handleKeyDown}
    >
      <div className="flex items-center gap-2 border-b border-zinc-100 px-3 py-2 dark:border-zinc-800">
        <Search className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('searchPlaceholder')}
          className="flex-1 bg-transparent text-[13px] text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-100 dark:placeholder:text-zinc-500"
        />
        <button
          onClick={(e) => {
            e.stopPropagation();
            onExpand();
          }}
          className="rounded p-0.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
          title={t('expandPanel')}
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
      </div>

      <div ref={listRef} className="max-h-[320px] overflow-y-auto px-1 py-1">
        {isSearching ? (
          searchResults.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-zinc-400 dark:text-zinc-500">
              {t('noMatch')}
            </div>
          ) : (
            searchResults.map((agent, idx) => renderItem(agent, idx, 'search'))
          )
        ) : (
          groups.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-zinc-400 dark:text-zinc-500">
              {t('empty')}
            </div>
          ) : (
            (() => {
              let flatIdx = 0;
              return groups.map((group) => (
                <div key={group.label}>
                  <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                    {group.label}
                  </div>
                  {group.items.map((agent) => {
                    const idx = flatIdx++;
                    return renderItem(agent, idx, group.label);
                  })}
                </div>
              ));
            })()
          )
        )}
      </div>

      <div className="flex items-center justify-between border-t border-zinc-100 px-3 py-1.5 dark:border-zinc-800">
        <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
          {t('count', { count: agents.length })}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onExpand();
          }}
          className="flex items-center gap-1 text-[10px] text-zinc-400 transition-colors hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300"
        >
          <Maximize2 className="h-3 w-3" />
          {t('expandPanel')}
        </button>
      </div>
    </div>
  );
}
