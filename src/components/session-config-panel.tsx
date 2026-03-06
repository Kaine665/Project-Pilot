'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { X, Check, ChevronDown } from 'lucide-react';
import type { ContextEntry } from '@/types';
import type { SessionConfig } from '@/types/agent-chat';

interface SessionConfigPanelProps {
  sessionId: string;
  config: SessionConfig;
  onSave: (config: SessionConfig) => void;
  onClose: () => void;
}

export function SessionConfigPanel({
  sessionId,
  config,
  onSave,
  onClose,
}: SessionConfigPanelProps) {
  const [contextIds, setContextIds] = useState<string[]>(config.contextIds ?? []);
  const [supplementaryPrompt, setSupplementaryPrompt] = useState(config.supplementaryPrompt ?? '');
  const [contextEntries, setContextEntries] = useState<ContextEntry[]>([]);
  const [saving, setSaving] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);

  // Fetch available context entries
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/context');
        const data = await res.json();
        setContextEntries((data.entries ?? []).filter((e: ContextEntry) => !e.status || e.status === 'active'));
      } catch { setContextEntries([]); }
    })();
  }, []);

  // Reset form when config changes (session switch)
  useEffect(() => {
    setContextIds(config.contextIds ?? []);
    setSupplementaryPrompt(config.supplementaryPrompt ?? '');
  }, [config, sessionId]);

  const toggleContext = useCallback((id: string) => {
    setContextIds(prev =>
      prev.includes(id) ? prev.filter(cid => cid !== id) : [...prev, id],
    );
  }, []);

  // Group context entries
  const contextGroups = useMemo(() => {
    const groups: Array<{ group: string | null; entries: ContextEntry[] }> = [];
    const groupNames = [...new Set(contextEntries.map(e => e.group).filter((g): g is string => !!g))].sort();
    const ungrouped = contextEntries.filter(e => !e.group);
    if (ungrouped.length > 0) groups.push({ group: null, entries: ungrouped });
    for (const g of groupNames) {
      groups.push({ group: g, entries: contextEntries.filter(e => e.group === g) });
    }
    return groups;
  }, [contextEntries]);

  // Check if there are changes
  const hasChanges = useMemo(() => {
    const origIds = config.contextIds ?? [];
    const origPrompt = config.supplementaryPrompt ?? '';
    const idsChanged = JSON.stringify([...contextIds].sort()) !== JSON.stringify([...origIds].sort());
    const promptChanged = supplementaryPrompt !== origPrompt;
    return idsChanged || promptChanged;
  }, [contextIds, supplementaryPrompt, config]);

  const handleSave = async () => {
    setSaving(true);
    const newConfig: SessionConfig = {};
    if (contextIds.length > 0) newConfig.contextIds = contextIds;
    if (supplementaryPrompt.trim()) newConfig.supplementaryPrompt = supplementaryPrompt.trim();
    onSave(newConfig);
    setSaving(false);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-100 px-3 py-2 dark:border-zinc-800">
        <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">会话配置</span>
        <button
          onClick={onClose}
          className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 transition-colors dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
        {/* Supplementary Prompt */}
        <div>
          <label className="mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
            补充提示词
          </label>
          <textarea
            value={supplementaryPrompt}
            onChange={e => setSupplementaryPrompt(e.target.value)}
            placeholder="为本次会话追加的额外指令（会附加在 Agent 系统提示词之后）"
            rows={4}
            className="w-full resize-y rounded-md border border-zinc-200 px-2.5 py-2 text-xs leading-relaxed outline-none focus:border-zinc-400 focus:ring-1 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 dark:focus:border-zinc-500 dark:focus:ring-zinc-500"
          />
          <p className="mt-1 text-[10px] text-zinc-400">
            追加到 Agent 系统提示词之后，不替换原始提示词
          </p>
        </div>

        {/* Context Binding */}
        {contextEntries.length > 0 && (
          <div>
            <button
              type="button"
              onClick={() => setContextOpen(v => !v)}
              className="mb-1.5 flex w-full items-center justify-between text-xs font-medium text-zinc-600 dark:text-zinc-400"
            >
              <span>追加上下文 {contextIds.length > 0 && `(${contextIds.length})`}</span>
              <ChevronDown className={`h-3 w-3 transition-transform ${contextOpen ? 'rotate-180' : ''}`} />
            </button>
            <p className="mb-2 text-[10px] text-zinc-400">
              选中的上下文内容将在对话时额外注入（与 Agent 默认上下文合并）
            </p>
            {contextOpen && (
              <div className="space-y-2 rounded-lg border border-zinc-200 p-2 dark:border-zinc-700 max-h-48 overflow-y-auto">
                {contextGroups.map(({ group, entries }) => (
                  <div key={group ?? '__ungrouped'}>
                    {group && (
                      <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                        {group}
                      </div>
                    )}
                    <div className="space-y-0.5">
                      {entries.map(entry => {
                        const checked = contextIds.includes(entry.id);
                        return (
                          <button
                            key={entry.id}
                            type="button"
                            onClick={() => toggleContext(entry.id)}
                            className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${
                              checked
                                ? 'bg-zinc-100 dark:bg-zinc-800'
                                : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                            }`}
                          >
                            <div className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border transition-colors ${
                              checked
                                ? 'border-zinc-900 bg-zinc-900 dark:border-zinc-100 dark:bg-zinc-100'
                                : 'border-zinc-300 dark:border-zinc-600'
                            }`}>
                              {checked && <Check className="h-2.5 w-2.5 text-white dark:text-zinc-900" />}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-xs text-zinc-900 dark:text-zinc-100">
                                {entry.label}
                              </div>
                              {entry.description && (
                                <div className="truncate text-[10px] text-zinc-400">
                                  {entry.description}
                                </div>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-zinc-100 px-3 py-2 dark:border-zinc-800">
        <div className="flex items-center gap-2">
          <button
            onClick={handleSave}
            disabled={!hasChanges || saving}
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {saving ? '保存中...' : '保存'}
          </button>
          <button
            onClick={onClose}
            className="px-2 py-1.5 text-xs text-zinc-400 hover:text-zinc-600 transition-colors"
          >
            取消
          </button>
          {!hasChanges && (
            <span className="text-[10px] text-zinc-400 ml-auto">无修改</span>
          )}
        </div>
      </div>
    </div>
  );
}
