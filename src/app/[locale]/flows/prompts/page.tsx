'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bot,
  ChevronDown,
  ChevronRight,
  Clock,
  CheckCircle2,
  File as FileIcon,
  FileText,
  Folder,
  GripVertical,
  Layers,
  PlusCircle,
  Search,
} from 'lucide-react';
import { useProject } from '@/components/project-context';
import type { Agent } from '@/types';

// ─── Types ──────────────────────────────────────────────────────────────────

interface PromptBlock {
  id: string;
  name: string;
  description: string;
  source: 'global' | 'project' | 'agent' | 'skill' | 'injected';
  tokenEstimate: number;
  enabled: boolean;
  contentPreview: string;
  location?: string;
}

type TreeSection = 'global' | 'project' | 'agent';

interface TreeItem {
  id: string;
  label: string;
  section: TreeSection;
  icon: 'file' | 'folder' | 'bot';
  tokenEstimate: number;
  badge?: { text: string; color: 'blue' | 'amber' };
  agentId?: string;
}

// ─── Source badge styles ────────────────────────────────────────────────────

const sourceBadge: Record<string, { bg: string; text: string; label: string }> = {
  global: { bg: 'bg-blue-50 dark:bg-blue-900/30', text: 'text-blue-600 dark:text-blue-400', label: 'GLOBAL' },
  project: { bg: 'bg-amber-50 dark:bg-amber-900/30', text: 'text-amber-600 dark:text-amber-400', label: 'PROJECT' },
  agent: { bg: 'bg-purple-50 dark:bg-purple-900/30', text: 'text-purple-600 dark:text-purple-400', label: 'AGENT' },
  skill: { bg: 'bg-emerald-50 dark:bg-emerald-900/30', text: 'text-emerald-600 dark:text-emerald-400', label: 'SKILL' },
  injected: { bg: 'bg-zinc-100 dark:bg-zinc-800', text: 'text-zinc-600 dark:text-zinc-400', label: 'INJECTED' },
};

// ─── Format tokens ──────────────────────────────────────────────────────────

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

// ─── Tabs ───────────────────────────────────────────────────────────────────

type FilterTab = 'all' | 'global' | 'project' | 'agent' | 'skill' | 'injected';

// ─── Component ──────────────────────────────────────────────────────────────

export default function PromptsPage() {
  const { projects, activeKey } = useProject();

  // Data state
  const [agents, setAgents] = useState<Agent[]>([]);
  const [blocks, setBlocks] = useState<PromptBlock[]>([]);
  const [totalTokens, setTotalTokens] = useState(0);
  const [loading, setLoading] = useState(true);

  // UI state
  const [selectedTreeItem, setSelectedTreeItem] = useState<string | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [expandedSections, setExpandedSections] = useState<Set<TreeSection>>(new Set(['global', 'project', 'agent']));
  const [filterText, setFilterText] = useState('');
  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const [expandedBlock, setExpandedBlock] = useState<string | null>(null);
  const [enabledMap, setEnabledMap] = useState<Record<string, boolean>>({});

  // Context window (default 128k)
  const contextWindow = 128000;

  // ── Fetch agents ──
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/agents');
        const data = await res.json();
        setAgents((data.agents ?? []).filter((a: Agent) => !a.archived));
      } catch { /* ignore */ }
    })();
  }, []);

  // ── Fetch blocks ──
  const fetchBlocks = useCallback(async (agentId?: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (agentId) params.set('agentId', agentId);
      if (activeKey) params.set('projectKey', activeKey);
      const res = await fetch(`/api/prompt-blocks?${params}`);
      const data = await res.json();
      const fetchedBlocks: PromptBlock[] = data.blocks ?? [];
      setBlocks(fetchedBlocks);
      setTotalTokens(data.totalTokens ?? 0);
      // Initialize enabled map
      const map: Record<string, boolean> = {};
      for (const b of fetchedBlocks) {
        map[b.id] = b.enabled;
      }
      setEnabledMap(map);
    } catch { /* ignore */ }
    setLoading(false);
  }, [activeKey]);

  // Initial load
  useEffect(() => {
    fetchBlocks();
  }, [fetchBlocks]);

  // ── Build tree items ──
  const treeItems = useMemo((): TreeItem[] => {
    const items: TreeItem[] = [];

    // Global
    const globalBlock = blocks.find(b => b.source === 'global');
    if (globalBlock) {
      items.push({
        id: 'tree-global',
        label: '_global.md',
        section: 'global',
        icon: 'file',
        tokenEstimate: globalBlock.tokenEstimate,
      });
    }

    // Project
    const projectBlocks = blocks.filter(b => b.source === 'project');
    for (const pb of projectBlocks) {
      items.push({
        id: `tree-${pb.id}`,
        label: pb.name,
        section: 'project',
        icon: 'folder',
        tokenEstimate: pb.tokenEstimate,
      });
    }

    // Agent
    for (const agent of agents) {
      items.push({
        id: `tree-agent-${agent.id}`,
        label: agent.name,
        section: 'agent',
        icon: 'bot',
        tokenEstimate: 0, // Will be filled when selected
        badge: agent.builtIn ? { text: 'BUILTIN', color: 'blue' } : undefined,
        agentId: agent.id,
      });
    }

    return items;
  }, [blocks, agents]);

  // ── Filter tree items ──
  const filteredTreeItems = useMemo(() => {
    if (!filterText) return treeItems;
    const lower = filterText.toLowerCase();
    return treeItems.filter(item => item.label.toLowerCase().includes(lower));
  }, [treeItems, filterText]);

  // ── Handle tree item click ──
  const handleTreeItemClick = useCallback((item: TreeItem) => {
    setSelectedTreeItem(item.id);
    if (item.agentId) {
      const agent = agents.find(a => a.id === item.agentId);
      setSelectedAgent(agent ?? null);
      fetchBlocks(item.agentId);
    } else {
      setSelectedAgent(null);
      fetchBlocks();
    }
  }, [agents, fetchBlocks]);

  // ── Toggle section ──
  const toggleSection = useCallback((section: TreeSection) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  }, []);

  // ── Toggle block enabled ──
  const toggleBlock = useCallback((blockId: string) => {
    setEnabledMap(prev => ({ ...prev, [blockId]: !prev[blockId] }));
  }, []);

  // ── Filter blocks by tab ──
  const filteredBlocks = useMemo(() => {
    if (activeTab === 'all') return blocks;
    return blocks.filter(b => b.source === activeTab);
  }, [blocks, activeTab]);

  // ── Token usage ──
  const activeTokens = useMemo(() => {
    return blocks.filter(b => enabledMap[b.id] !== false).reduce((sum, b) => sum + b.tokenEstimate, 0);
  }, [blocks, enabledMap]);

  const usagePercent = Math.round((activeTokens / contextWindow) * 100);
  const circumference = 2 * Math.PI * 16; // r=16
  const dashOffset = circumference - (circumference * Math.min(usagePercent, 100)) / 100;

  // ── Section rendering helpers ──
  const sectionConfig: Record<TreeSection, { label: string; emoji: string }> = {
    global: { label: '全局提示词', emoji: '🌐' },
    project: { label: '项目级提示词', emoji: '📁' },
    agent: { label: 'Agent 提示词', emoji: '🤖' },
  };

  const activeBlockCount = blocks.filter(b => enabledMap[b.id] !== false).length;

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Left Sidebar: Prompt Navigation ── */}
      <aside className="flex w-72 shrink-0 flex-col border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-100 p-4 dark:border-zinc-800">
          <h2 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">提示词</h2>
        </div>

        {/* Search */}
        <div className="px-3 py-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-zinc-400" />
            <input
              type="text"
              placeholder="筛选提示词..."
              value={filterText}
              onChange={e => setFilterText(e.target.value)}
              className="w-full rounded-md border border-zinc-200 bg-zinc-50 py-1.5 pl-8 pr-3 text-xs outline-none focus:ring-1 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
            />
          </div>
        </div>

        {/* Tree */}
        <nav className="flex-1 overflow-y-auto py-2">
          {(['global', 'project', 'agent'] as TreeSection[]).map(section => {
            const sectionItems = filteredTreeItems.filter(item => item.section === section);
            const isExpanded = expandedSections.has(section);
            const cfg = sectionConfig[section];

            return (
              <div key={section} className="mb-1">
                {/* Section header */}
                <button
                  onClick={() => toggleSection(section)}
                  className="flex w-full items-center gap-1.5 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-zinc-400 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900"
                >
                  {isExpanded ? (
                    <ChevronDown className="h-2.5 w-2.5" />
                  ) : (
                    <ChevronRight className="h-2.5 w-2.5" />
                  )}
                  <span>{cfg.emoji} {cfg.label}</span>
                </button>

                {/* Section items */}
                {isExpanded && (
                  <div className="space-y-0.5 pr-2">
                    {sectionItems.map(item => {
                      const isActive = selectedTreeItem === item.id;
                      const IconComp = item.icon === 'bot' ? Bot : item.icon === 'folder' ? Folder : FileText;

                      return (
                        <button
                          key={item.id}
                          onClick={() => handleTreeItemClick(item)}
                          className={`flex w-full items-center justify-between rounded-r-md py-1.5 pl-8 pr-3 transition-colors ${
                            isActive
                              ? 'border-l-2 border-zinc-900 bg-zinc-100 dark:border-zinc-100 dark:bg-zinc-800'
                              : 'hover:bg-zinc-50 dark:hover:bg-zinc-900'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <IconComp className={`h-3.5 w-3.5 ${isActive ? 'text-zinc-900 dark:text-zinc-100' : 'text-zinc-400'}`} />
                            <span className={`text-sm ${isActive ? 'font-semibold text-zinc-900 dark:text-zinc-100' : 'text-zinc-600 dark:text-zinc-400 group-hover:text-zinc-900'}`}>
                              {item.label}
                            </span>
                            {item.badge && (
                              <span className={`rounded border px-1 py-0.5 text-[9px] font-bold leading-none ${
                                item.badge.color === 'blue'
                                  ? 'border-blue-100 bg-blue-50 text-blue-600 dark:border-blue-800 dark:bg-blue-900/30 dark:text-blue-400'
                                  : 'border-amber-100 bg-amber-50 text-amber-600 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-400'
                              }`}>
                                {item.badge.text}
                              </span>
                            )}
                          </div>
                          {item.tokenEstimate > 0 && (
                            <span className={`font-mono text-[10px] ${isActive ? 'font-bold text-zinc-500' : 'text-zinc-400'}`}>
                              {formatTokens(item.tokenEstimate)}
                            </span>
                          )}
                        </button>
                      );
                    })}
                    {section === 'agent' && agents.length > 5 && sectionItems.length >= 5 && (
                      <div className="flex items-center gap-2 py-2 pl-8 text-[10px] italic text-zinc-400">
                        <span className="h-1 w-1 rounded-full bg-zinc-300" />
                        <span>... 更多项目</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* Bottom sync status */}
        <div className="border-t border-zinc-100 p-4 dark:border-zinc-800">
          <div className="flex items-center gap-3 rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900">
            <div className="rounded bg-blue-100 p-2 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
              <CheckCircle2 className="h-4 w-4" />
            </div>
            <div className="flex-1">
              <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">已同步</p>
              <p className="text-[10px] text-zinc-500">所有提示词均为最新</p>
            </div>
          </div>
        </div>
      </aside>

      {/* ── Main Content: Block Composition Area ── */}
      <main className="flex flex-1 flex-col overflow-hidden bg-zinc-50 dark:bg-zinc-950">
        {/* Composition Header */}
        <header className="shrink-0 border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
          <div className="flex h-16 items-center justify-between px-6">
            <div className="flex items-center gap-6">
              {/* Title */}
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400">
                  {selectedAgent ? (
                    <Bot className="h-5 w-5" />
                  ) : (
                    <Layers className="h-5 w-5" />
                  )}
                </div>
                <div>
                  <h1 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                    {selectedAgent ? selectedAgent.name : '提示词总览'}
                  </h1>
                  <p className="text-xs text-zinc-500">
                    {selectedAgent ? 'Prompt Composition' : '全部 Prompt Block'}
                  </p>
                </div>
              </div>

              <div className="h-10 w-px bg-zinc-200 dark:bg-zinc-700" />

              {/* Token Usage Ring */}
              <div className="flex items-center gap-3">
                <div className="relative flex items-center justify-center">
                  <svg className="h-10 w-10">
                    <circle
                      cx="20" cy="20" r="16"
                      strokeWidth="3" stroke="currentColor" fill="transparent"
                      className="text-zinc-100 dark:text-zinc-800"
                    />
                    <circle
                      cx="20" cy="20" r="16"
                      strokeWidth="3" stroke="currentColor" fill="transparent"
                      strokeDasharray={circumference}
                      strokeDashoffset={dashOffset}
                      strokeLinecap="round"
                      className="text-zinc-900 dark:text-zinc-100"
                      style={{
                        transition: 'stroke-dashoffset 0.35s',
                        transform: 'rotate(-90deg)',
                        transformOrigin: '50% 50%',
                      }}
                    />
                  </svg>
                  <span className="absolute text-[10px] font-bold text-zinc-900 dark:text-zinc-100">
                    {usagePercent}%
                  </span>
                </div>
                <div className="flex flex-col">
                  <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                    {formatTokens(activeTokens)} / {formatTokens(contextWindow)}
                  </span>
                  <span className="text-[10px] text-zinc-500">上下文窗口占用</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button className="rounded-md border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 shadow-sm transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700">
                测试 Agent
              </button>
              <button className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200">
                发布更改
              </button>
            </div>
          </div>

          {/* Filter Tabs */}
          <div className="flex items-center gap-6 overflow-x-auto px-6">
            {([
              { key: 'all' as FilterTab, label: `全部 (${blocks.length})` },
              { key: 'global' as FilterTab, label: '全局' },
              { key: 'project' as FilterTab, label: '项目' },
              { key: 'agent' as FilterTab, label: 'Agent' },
              { key: 'skill' as FilterTab, label: 'Skills' },
              { key: 'injected' as FilterTab, label: '注入' },
            ]).map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`h-10 px-1 text-sm font-medium transition-colors ${
                  activeTab === tab.key
                    ? 'border-b-2 border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100'
                    : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </header>

        {/* Blocks Area */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="mx-auto max-w-4xl space-y-2">
            {loading ? (
              <div className="flex items-center justify-center py-20 text-sm text-zinc-400">
                加载中...
              </div>
            ) : filteredBlocks.length === 0 ? (
              <div className="flex items-center justify-center py-20 text-sm text-zinc-400">
                暂无提示词 Block
              </div>
            ) : (
              filteredBlocks.map(block => {
                const isEnabled = enabledMap[block.id] !== false;
                const isExpanded = expandedBlock === block.id;
                const badge = sourceBadge[block.source];

                if (!isEnabled) {
                  // Disabled block
                  return (
                    <div
                      key={block.id}
                      className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 opacity-60 dark:border-zinc-800 dark:bg-zinc-900"
                    >
                      <div className="flex items-start gap-4">
                        <div className="mt-1 text-zinc-200 dark:text-zinc-700">
                          <GripVertical className="h-4 w-4" />
                        </div>
                        <div className="flex-1">
                          <div className="mb-1 flex items-center gap-2">
                            <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${badge.bg} ${badge.text}`}>
                              {badge.label}
                            </span>
                            <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{block.name}</h3>
                          </div>
                          <p className="text-xs text-zinc-500">{block.description}</p>
                        </div>
                        <div className="flex items-center gap-4">
                          <span className="rounded bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-400 dark:bg-zinc-800">
                            ~{formatTokens(block.tokenEstimate)}
                          </span>
                          <button
                            onClick={() => toggleBlock(block.id)}
                            className="relative flex h-5 w-9 items-center rounded-full bg-zinc-200 px-0.5 transition-colors dark:bg-zinc-700"
                          >
                            <span className="h-4 w-4 translate-x-0 rounded-full bg-white shadow-sm" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                }

                if (isExpanded) {
                  // Expanded block
                  return (
                    <div
                      key={block.id}
                      className="overflow-hidden rounded-lg border-2 border-zinc-900 shadow-md dark:border-zinc-200"
                    >
                      <div className="flex items-start gap-4 bg-zinc-50/50 p-4 dark:bg-zinc-900/50">
                        <div className="mt-1 text-zinc-400">
                          <GripVertical className="h-4 w-4" />
                        </div>
                        <div className="flex-1">
                          <div className="mb-1 flex items-center gap-2">
                            <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${badge.bg} ${badge.text}`}>
                              {badge.label}
                            </span>
                            <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{block.name}</h3>
                          </div>
                          <p className="text-xs text-zinc-500">{block.description}</p>
                        </div>
                        <div className="flex items-center gap-4">
                          <span className="rounded bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-400 dark:bg-zinc-800">
                            ~{formatTokens(block.tokenEstimate)}
                          </span>
                          <button
                            onClick={() => toggleBlock(block.id)}
                            className="relative flex h-5 w-9 items-center rounded-full bg-zinc-900 px-0.5 transition-colors dark:bg-zinc-200"
                          >
                            <span className="h-4 w-4 translate-x-4 rounded-full bg-white shadow-sm dark:bg-zinc-900" />
                          </button>
                        </div>
                      </div>
                      <div className="border-t border-zinc-100 px-12 py-4 text-xs leading-relaxed text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
                        <p className="mb-2 rounded border border-zinc-100 bg-zinc-50 p-3 font-mono dark:border-zinc-800 dark:bg-zinc-900">
                          {block.contentPreview}
                        </p>
                        <div className="flex items-center gap-3">
                          <button className="font-medium text-zinc-900 hover:underline dark:text-zinc-100">编辑内容</button>
                          <button
                            onClick={() => setExpandedBlock(null)}
                            className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                          >
                            收起
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                }

                // Normal block
                return (
                  <div
                    key={block.id}
                    onClick={() => setExpandedBlock(block.id)}
                    className="group cursor-default rounded-lg border border-zinc-200 bg-white p-4 shadow-sm transition-all hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700"
                  >
                    <div className="flex items-start gap-4">
                      <div className="mt-1 cursor-grab text-zinc-300 active:cursor-grabbing group-hover:text-zinc-400 dark:text-zinc-600 dark:group-hover:text-zinc-500">
                        <GripVertical className="h-4 w-4" />
                      </div>
                      <div className="flex-1">
                        <div className="mb-1 flex items-center gap-2">
                          <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${badge.bg} ${badge.text}`}>
                            {badge.label}
                          </span>
                          <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{block.name}</h3>
                        </div>
                        <p className="text-xs text-zinc-500">{block.description}</p>
                      </div>
                      <div className="flex items-center gap-4">
                        <span className="rounded bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-400 dark:bg-zinc-800">
                          ~{formatTokens(block.tokenEstimate)}
                        </span>
                        <button
                          onClick={e => { e.stopPropagation(); toggleBlock(block.id); }}
                          className="relative flex h-5 w-9 items-center rounded-full bg-zinc-900 px-0.5 transition-colors dark:bg-zinc-200"
                        >
                          <span className="h-4 w-4 translate-x-4 rounded-full bg-white shadow-sm dark:bg-zinc-900" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}

            {/* Add Block button */}
            {!loading && (
              <button className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-zinc-200 py-4 text-sm font-medium text-zinc-400 transition-all hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-600 dark:border-zinc-700 dark:hover:border-zinc-600 dark:hover:bg-zinc-900 dark:hover:text-zinc-300">
                <PlusCircle className="h-4 w-4" />
                添加 Prompt Block
              </button>
            )}
          </div>
        </div>

        {/* Footer */}
        <footer className="flex h-10 shrink-0 items-center justify-between border-t border-zinc-200 bg-white px-6 dark:border-zinc-800 dark:bg-zinc-950">
          <div className="flex items-center gap-4 text-[11px] font-medium text-zinc-500">
            <span className="flex items-center gap-1">
              <Layers className="h-3.5 w-3.5" />
              {activeBlockCount} 个活跃 Block
            </span>
            <span className="flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" />
              最近更新刚刚
            </span>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-zinc-500">
            <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
            结构已优化
          </div>
        </footer>
      </main>

      {/* ── Right Sidebar: History & Stats ── */}
      <aside className="flex w-80 shrink-0 flex-col border-l border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-200 p-4 dark:border-zinc-800">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">组合历史</h3>
          <button className="text-xs font-medium text-blue-600 dark:text-blue-400">对比</button>
        </div>

        {/* History timeline */}
        <div className="flex-1 overflow-y-auto bg-zinc-50/30 dark:bg-zinc-900/30">
          <div className="space-y-4 p-4">
            {/* Current */}
            <div className="relative pb-6 pl-6">
              <div className="absolute left-0 top-1 z-10 h-2.5 w-2.5 rounded-full bg-zinc-900 dark:bg-zinc-100" />
              <div className="absolute bottom-0 left-[4px] top-1 w-0.5 bg-zinc-200 dark:bg-zinc-700" />
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">当前组合</span>
                  <span className="text-[10px] text-zinc-400">活跃</span>
                </div>
                <p className="text-xs text-zinc-500">
                  {selectedAgent ? `${selectedAgent.name} 的提示词组合` : '全局提示词总览'}
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <div className="h-5 w-5 rounded-full bg-zinc-300 dark:bg-zinc-600" />
                  <span className="text-[10px] text-zinc-600 dark:text-zinc-400">你</span>
                </div>
              </div>
            </div>

            {/* Previous version */}
            <div className="relative pb-6 pl-6">
              <div className="absolute left-0 top-1 z-10 h-2.5 w-2.5 rounded-full border border-zinc-300 bg-zinc-200 dark:border-zinc-600 dark:bg-zinc-700" />
              <div className="absolute bottom-0 left-[4px] top-1 w-0.5 bg-zinc-200 dark:bg-zinc-700" />
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">v1.0</span>
                  <span className="text-[10px] text-zinc-400">初始版本</span>
                </div>
                <p className="text-xs text-zinc-500">初始提示词配置</p>
                <button className="mt-1 text-[10px] font-medium text-blue-600 hover:underline dark:text-blue-400">
                  恢复
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="space-y-4 border-t border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
          <div>
            <label className="mb-2 block text-[10px] font-bold uppercase tracking-widest text-zinc-400">
              组合统计
            </label>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-md border border-zinc-100 bg-zinc-50 p-2 dark:border-zinc-800 dark:bg-zinc-900">
                <p className="text-[10px] text-zinc-500">Tokens</p>
                <p className="text-xs font-bold text-zinc-900 dark:text-zinc-100">{formatTokens(activeTokens)}</p>
              </div>
              <div className="rounded-md border border-zinc-100 bg-zinc-50 p-2 dark:border-zinc-800 dark:bg-zinc-900">
                <p className="text-[10px] text-zinc-500">模块</p>
                <p className="text-xs font-bold text-zinc-900 dark:text-zinc-100">{blocks.length} 总计</p>
              </div>
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}
