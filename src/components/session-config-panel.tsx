'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { X, Check, ChevronDown, Search, FileText, BookOpen, Cpu } from 'lucide-react';
import type { ContextEntry, ProviderId } from '@/types';
import type { SessionConfig } from '@/types/agent-chat';
import { PROVIDER_REGISTRY, getProviderPreset } from '@/lib/provider-registry';

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
  const [sessionProvider, setSessionProvider] = useState<ProviderId | ''>(config.provider ?? '');
  const [sessionModel, setSessionModel] = useState(config.model ?? '');
  const [contextEntries, setContextEntries] = useState<ContextEntry[]>([]);
  const [saving, setSaving] = useState(false);
  const [contextOpen, setContextOpen] = useState(true);
  const [contextFilter, setContextFilter] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  const autoResize = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
  }, []);

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
    setSessionProvider(config.provider ?? '');
    setSessionModel(config.model ?? '');
  }, [config, sessionId]);

  // Auto-resize on content change
  useEffect(() => { autoResize(); }, [supplementaryPrompt, autoResize]);

  const toggleContext = useCallback((id: string) => {
    setContextIds(prev =>
      prev.includes(id) ? prev.filter(cid => cid !== id) : [...prev, id],
    );
  }, []);

  // Group context entries with optional filter
  const contextGroups = useMemo(() => {
    let filtered = contextEntries;
    if (contextFilter.trim()) {
      const q = contextFilter.toLowerCase();
      filtered = contextEntries.filter(e =>
        e.label.toLowerCase().includes(q) ||
        (e.description ?? '').toLowerCase().includes(q) ||
        (e.group ?? '').toLowerCase().includes(q)
      );
    }
    const groups: Array<{ group: string | null; entries: ContextEntry[] }> = [];
    const groupNames = [...new Set(filtered.map(e => e.group).filter((g): g is string => !!g))].sort();
    const ungrouped = filtered.filter(e => !e.group);
    if (ungrouped.length > 0) groups.push({ group: null, entries: ungrouped });
    for (const g of groupNames) {
      groups.push({ group: g, entries: filtered.filter(e => e.group === g) });
    }
    return groups;
  }, [contextEntries, contextFilter]);

  // Selected context entries for chips display
  const selectedEntries = useMemo(() => {
    return contextEntries.filter(e => contextIds.includes(e.id));
  }, [contextEntries, contextIds]);

  // Check if there are changes
  const hasChanges = useMemo(() => {
    const origIds = config.contextIds ?? [];
    const origPrompt = config.supplementaryPrompt ?? '';
    const idsChanged = JSON.stringify([...contextIds].sort()) !== JSON.stringify([...origIds].sort());
    const promptChanged = supplementaryPrompt !== origPrompt;
    const providerChanged = sessionProvider !== (config.provider ?? '');
    const modelChanged = sessionModel !== (config.model ?? '');
    return idsChanged || promptChanged || providerChanged || modelChanged;
  }, [contextIds, supplementaryPrompt, sessionProvider, sessionModel, config]);

  const handleSave = async () => {
    setSaving(true);
    const newConfig: SessionConfig = {};
    if (contextIds.length > 0) newConfig.contextIds = contextIds;
    if (supplementaryPrompt.trim()) newConfig.supplementaryPrompt = supplementaryPrompt.trim();
    if (sessionProvider) newConfig.provider = sessionProvider as ProviderId;
    if (sessionModel.trim()) newConfig.model = sessionModel.trim();
    onSave(newConfig);
    setSaving(false);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-100 dark:border-zinc-800">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">会话配置</span>
          {hasChanges && (
            <span className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" />
          )}
        </div>
        <div className="flex items-center gap-1">
          {hasChanges && (
            <button
              onClick={handleSave}
              disabled={saving}
              className="rounded-md bg-blue-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {saving ? '保存中...' : '保存'}
            </button>
          )}
          <button
            onClick={onClose}
            className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 transition-colors dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">

        {/* ── 模型配置 ── */}
        <div className="rounded-lg border border-zinc-150 bg-zinc-50/50 p-3 dark:border-zinc-700/50 dark:bg-zinc-800/30">
          <div className="mb-2 flex items-center gap-1.5">
            <Cpu className="h-3.5 w-3.5 text-zinc-400" />
            <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">模型配置</span>
            {(sessionProvider || sessionModel) && (
              <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-400">
                已自定义
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <select
              value={sessionProvider}
              onChange={e => {
                setSessionProvider(e.target.value as ProviderId | '');
                setSessionModel('');
              }}
              className="w-32 shrink-0 rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-xs outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400/30 dark:border-zinc-600 dark:bg-zinc-800 dark:focus:border-blue-500"
            >
              <option value="">继承默认</option>
              {PROVIDER_REGISTRY.map(p => (
                <option key={p.id} value={p.id}>{p.id}</option>
              ))}
            </select>
            {sessionProvider ? (
              <select
                value={sessionModel}
                onChange={e => setSessionModel(e.target.value)}
                className="flex-1 rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-xs outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400/30 dark:border-zinc-600 dark:bg-zinc-800 dark:focus:border-blue-500"
              >
                <option value="">继承默认</option>
                {getProviderPreset(sessionProvider as ProviderId).models.map(m => (
                  <option key={m.id} value={m.id}>{m.label || m.id}</option>
                ))}
              </select>
            ) : (
              <input
                disabled
                placeholder="先选择供应商"
                className="flex-1 rounded-md border border-zinc-200 px-2 py-1.5 text-[11px] text-zinc-400 dark:border-zinc-700 dark:bg-zinc-800/50"
              />
            )}
          </div>
          <p className="mt-1.5 text-[10px] text-zinc-400">
            覆盖此会话的模型，不影响其他会话
          </p>
        </div>

        {/* ── 补充提示词 ── */}
        <div className="rounded-lg border border-zinc-150 bg-zinc-50/50 p-3 dark:border-zinc-700/50 dark:bg-zinc-800/30">
          <div className="mb-2 flex items-center gap-1.5">
            <FileText className="h-3.5 w-3.5 text-zinc-400" />
            <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">补充提示词</span>
          </div>
          <textarea
            ref={textareaRef}
            value={supplementaryPrompt}
            onChange={e => setSupplementaryPrompt(e.target.value)}
            placeholder="为本次会话追加的额外指令…"
            rows={2}
            className="w-full resize-none rounded-md border border-zinc-200 bg-white px-2.5 py-2 text-xs leading-relaxed outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400/30 dark:border-zinc-600 dark:bg-zinc-800 dark:focus:border-blue-500 dark:focus:ring-blue-500/30"
          />
          <p className="mt-1.5 text-[10px] text-zinc-400">
            附加在 Agent 系统提示词之后，不替换原始提示词
          </p>
        </div>

        {/* ── 上下文绑定 ── */}
        {contextEntries.length > 0 && (
          <div className="rounded-lg border border-zinc-150 bg-zinc-50/50 p-3 dark:border-zinc-700/50 dark:bg-zinc-800/30">
            <button
              type="button"
              onClick={() => setContextOpen(v => !v)}
              className="mb-2 flex w-full items-center gap-1.5"
            >
              <BookOpen className="h-3.5 w-3.5 text-zinc-400" />
              <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">追加上下文</span>
              {contextIds.length > 0 && (
                <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-400">
                  {contextIds.length}
                </span>
              )}
              <ChevronDown className={`ml-auto h-3 w-3 text-zinc-400 transition-transform ${contextOpen ? 'rotate-180' : ''}`} />
            </button>

            {/* 已选上下文 chips */}
            {selectedEntries.length > 0 && !contextOpen && (
              <div className="flex flex-wrap gap-1 mt-1">
                {selectedEntries.map(entry => (
                  <button
                    key={entry.id}
                    onClick={() => toggleContext(entry.id)}
                    className="group flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] text-blue-700 hover:bg-red-50 hover:text-red-600 transition-colors dark:bg-blue-900/30 dark:text-blue-400 dark:hover:bg-red-900/30 dark:hover:text-red-400"
                  >
                    <span className="truncate max-w-[120px]">{entry.label}</span>
                    <X className="h-2.5 w-2.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </button>
                ))}
              </div>
            )}

            {contextOpen && (
              <div className="mt-1 space-y-2">
                {/* 搜索 */}
                {contextEntries.length > 5 && (
                  <div className="relative">
                    <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-zinc-400" />
                    <input
                      type="text"
                      value={contextFilter}
                      onChange={e => setContextFilter(e.target.value)}
                      placeholder="搜索上下文…"
                      className="w-full rounded-md border border-zinc-200 bg-white py-1.5 pl-7 pr-2 text-[11px] outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400/30 dark:border-zinc-600 dark:bg-zinc-800 dark:focus:border-blue-500"
                    />
                  </div>
                )}

                {/* 列表 */}
                <div className="max-h-52 space-y-2 overflow-y-auto">
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
                                  ? 'bg-blue-50 dark:bg-blue-900/20'
                                  : 'hover:bg-zinc-100 dark:hover:bg-zinc-700/50'
                              }`}
                            >
                              <div className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border transition-colors ${
                                checked
                                  ? 'border-blue-600 bg-blue-600 dark:border-blue-500 dark:bg-blue-500'
                                  : 'border-zinc-300 dark:border-zinc-600'
                              }`}>
                                {checked && <Check className="h-2.5 w-2.5 text-white" />}
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
                  {contextGroups.length === 0 && contextFilter && (
                    <p className="py-3 text-center text-[11px] text-zinc-400">无匹配结果</p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer - simplified */}
      {hasChanges && (
        <div className="border-t border-zinc-100 px-3 py-2 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {saving ? '保存中...' : '保存配置'}
            </button>
            <button
              onClick={() => {
                setContextIds(config.contextIds ?? []);
                setSupplementaryPrompt(config.supplementaryPrompt ?? '');
                setSessionProvider(config.provider ?? '');
                setSessionModel(config.model ?? '');
              }}
              className="px-2 py-1.5 text-xs text-zinc-400 hover:text-zinc-600 transition-colors"
            >
              撤销修改
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
