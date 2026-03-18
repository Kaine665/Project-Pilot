'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  X, ChevronDown, FileText, FolderOpen, Folder, Plus,
  Terminal, Globe, Users, ShieldOff, ListTodo, Eye, HardDrive,
} from 'lucide-react';
import type { Agent, AgentCapabilities, ContextEntry } from '@/types';
import { DEFAULT_AGENT_CAPABILITIES } from '@/types';
import type { SessionConfig } from '@/types/agent-chat';
import { CAPABILITY_ITEMS } from '@/components/agent-form';
import { PROVIDER_REGISTRY } from '@/lib/provider-registry';

// ── Types ──

interface RuntimePanelProps {
  agent: Agent;
  sessionConfig: SessionConfig;
  onSaveConfig: (config: SessionConfig) => void;
  onClose: () => void;
}

// ── Accordion Section ──

function AccordionSection({
  title,
  open,
  onToggle,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-zinc-200 dark:border-zinc-700 last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between bg-zinc-100 dark:bg-zinc-800 px-3 py-1.5 hover:bg-zinc-150 dark:hover:bg-zinc-750 transition-colors"
      >
        <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-400 select-none">
          {title}
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 text-zinc-400 transition-transform duration-150 ${
            open ? '' : '-rotate-90'
          }`}
        />
      </button>
      {open && <div className="px-3 py-2">{children}</div>}
    </div>
  );
}

// ── Sub-group header (for PROMPT PAYLOAD) ──

function SubGroup({
  label,
  open,
  onToggle,
  children,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-1.5">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-1 py-1 text-[11px] font-medium text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors"
      >
        <ChevronDown
          className={`h-3 w-3 transition-transform duration-150 ${
            open ? '' : '-rotate-90'
          }`}
        />
        {label}
      </button>
      {open && <div className="ml-4">{children}</div>}
    </div>
  );
}

// ── Item row ──

function ItemRow({
  icon: Icon,
  name,
  badge,
  badgeColor,
}: {
  icon?: typeof FileText;
  name: string;
  badge?: string;
  badgeColor?: string;
}) {
  return (
    <div className="flex items-center gap-2 py-0.5 px-1 rounded hover:bg-zinc-50 dark:hover:bg-zinc-800/60 transition-colors group">
      {Icon && <Icon className="h-3.5 w-3.5 text-zinc-400 dark:text-zinc-500 shrink-0" />}
      <span className="text-xs text-zinc-700 dark:text-zinc-300 truncate flex-1">{name}</span>
      {badge && (
        <span
          className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
            badgeColor ?? 'bg-zinc-100 dark:bg-zinc-700 text-zinc-500'
          }`}
        >
          {badge}
        </span>
      )}
    </div>
  );
}

// ── Capability Chip ──

function CapChip({
  icon: Icon,
  label,
  active,
}: {
  icon: typeof Terminal;
  label: string;
  active: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors ${
        active
          ? 'bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-800 dark:text-zinc-200'
          : 'bg-transparent border border-dashed border-zinc-200 dark:border-zinc-700 text-zinc-400 dark:text-zinc-500'
      }`}
    >
      <Icon className="h-3 w-3 shrink-0" />
      <span className="truncate">{label}</span>
      <span
        className={`h-1.5 w-1.5 rounded-full shrink-0 ${
          active ? 'bg-emerald-500' : 'bg-zinc-300 dark:bg-zinc-600'
        }`}
      />
    </div>
  );
}

// ── Main Component ──

export function RuntimePanel({
  agent,
  sessionConfig,
  onSaveConfig,
  onClose,
}: RuntimePanelProps) {
  // Accordion open states — all default to expanded
  const [folderOpen, setFolderOpen] = useState(true);
  const [promptOpen, setPromptOpen] = useState(true);
  const [capsOpen, setCapsOpen] = useState(true);

  // Sub-group states for PROMPT PAYLOAD
  const [systemPromptsOpen, setSystemPromptsOpen] = useState(true);
  const [knowledgeOpen, setKnowledgeOpen] = useState(true);
  const [skillsOpen, setSkillsOpen] = useState(true);
  const [sessionAdditionsOpen, setSessionAdditionsOpen] = useState(true);

  // Fetched data
  const [contextEntries, setContextEntries] = useState<ContextEntry[]>([]);
  const [skills, setSkills] = useState<{ name: string; description: string }[]>([]);

  // Fetch context entries
  useEffect(() => {
    fetch('/api/context')
      .then((r) => r.json())
      .then((data) => {
        const entries: ContextEntry[] = data.entries ?? [];
        setContextEntries(entries.filter((e) => e.status !== 'draft'));
      })
      .catch(() => {});
  }, []);

  // Fetch skills
  useEffect(() => {
    fetch('/api/skills')
      .then((r) => r.json())
      .then((data) => {
        setSkills(data.skills ?? []);
      })
      .catch(() => {});
  }, []);

  // Resolve capabilities: agent defaults merged with session overrides
  const resolvedCaps = useMemo<AgentCapabilities>(() => {
    const base = agent.capabilities ?? { ...DEFAULT_AGENT_CAPABILITIES };
    const overrides = sessionConfig.capabilities ?? {};
    return { ...base, ...overrides };
  }, [agent.capabilities, sessionConfig.capabilities]);

  // Resolve provider/model display
  const providerModelLabel = useMemo(() => {
    const providerId = sessionConfig.provider ?? agent.defaultProvider;
    const modelId = sessionConfig.model ?? agent.defaultModel;
    if (!providerId && !modelId) return '默认（全局设置）';
    const preset = PROVIDER_REGISTRY.find((p) => p.id === providerId);
    const providerName = preset?.nameKey ?? providerId ?? '?';
    return `${providerName} / ${modelId || '默认'}`;
  }, [sessionConfig.provider, sessionConfig.model, agent.defaultProvider, agent.defaultModel]);

  // Folder section content
  const folderContent = useMemo(() => {
    if (resolvedCaps.exposePromptPath) {
      return `~/.project-pilot/data/agents/${agent.id}/prompt.md`;
    }
    return null;
  }, [resolvedCaps.exposePromptPath, agent.id]);

  // Handle "Add Resource" — dispatch event to open session config panel
  const handleAddResource = useCallback(() => {
    window.dispatchEvent(new CustomEvent('toggle-session-config'));
  }, []);

  // Active context entries (those bound to this session or agent)
  const boundContextIds = useMemo(() => {
    const sessionCtx = sessionConfig.contextIds ?? [];
    const agentCtx = agent.contextIds ?? [];
    return new Set([...sessionCtx, ...agentCtx]);
  }, [sessionConfig.contextIds, agent.contextIds]);

  const activeContextEntries = useMemo(
    () => contextEntries.filter((e) => boundContextIds.has(e.id)),
    [contextEntries, boundContextIds],
  );

  // Bound skills
  const boundSkillNames = useMemo(() => {
    const sessionSkills = sessionConfig.skillNames ?? [];
    const agentSkills = (agent.defaultResources ?? [])
      .filter((r) => r.type === 'skill')
      .map((r) => r.id);
    return new Set([...sessionSkills, ...agentSkills]);
  }, [sessionConfig.skillNames, agent.defaultResources]);

  const activeSkills = useMemo(
    () => skills.filter((s) => boundSkillNames.has(s.name)),
    [skills, boundSkillNames],
  );

  return (
    <div className="flex h-full flex-col border-l border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-200 dark:border-zinc-700">
        <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">运行时</span>
        <button
          type="button"
          onClick={onClose}
          className="p-0.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          aria-label="关闭运行时面板"
        >
          <X className="h-4 w-4 text-zinc-500" />
        </button>
      </div>

      {/* Body — scrollable */}
      <div className="flex-1 overflow-y-auto">
        {/* Section 1: FOLDER */}
        <AccordionSection
          title="文件夹"
          open={folderOpen}
          onToggle={() => setFolderOpen((v) => !v)}
        >
          {folderContent ? (
            <div className="flex items-start gap-2">
              <FolderOpen className="h-3.5 w-3.5 text-amber-500 dark:text-amber-400 shrink-0 mt-0.5" />
              <span className="text-xs text-zinc-600 dark:text-zinc-400 break-all font-mono">
                {folderContent}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Folder className="h-3.5 w-3.5 text-zinc-300 dark:text-zinc-600 shrink-0" />
              <span className="text-xs text-zinc-400 dark:text-zinc-500 italic">
                无文件夹访问权限
              </span>
            </div>
          )}
        </AccordionSection>

        {/* Section 2: PROMPT PAYLOAD */}
        <AccordionSection
          title="提示词载荷"
          open={promptOpen}
          onToggle={() => setPromptOpen((v) => !v)}
        >
          {/* System Prompts */}
          <SubGroup
            label="系统提示词"
            open={systemPromptsOpen}
            onToggle={() => setSystemPromptsOpen((v) => !v)}
          >
            <ItemRow icon={FileText} name="全局提示词" />
            <ItemRow icon={FileText} name="项目提示词" />
            <ItemRow icon={FileText} name="Agent 主提示词" />
          </SubGroup>

          {/* Knowledge & Blocks */}
          <SubGroup
            label="知识 & 组块"
            open={knowledgeOpen}
            onToggle={() => setKnowledgeOpen((v) => !v)}
          >
            {activeContextEntries.length === 0 ? (
              <span className="text-[11px] text-zinc-400 dark:text-zinc-500 italic pl-1">
                暂无绑定的知识条目
              </span>
            ) : (
              activeContextEntries.map((entry) => (
                <ItemRow
                  key={entry.id}
                  icon={FileText}
                  name={entry.label}
                  badge="知识"
                  badgeColor="bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400"
                />
              ))
            )}
          </SubGroup>

          {/* Skills & Tools */}
          <SubGroup
            label="技能 & 工具"
            open={skillsOpen}
            onToggle={() => setSkillsOpen((v) => !v)}
          >
            {activeSkills.length === 0 ? (
              <span className="text-[11px] text-zinc-400 dark:text-zinc-500 italic pl-1">
                暂无绑定的技能
              </span>
            ) : (
              activeSkills.map((skill) => (
                <ItemRow
                  key={skill.name}
                  name={skill.name}
                  badge="技能"
                  badgeColor="bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-400"
                />
              ))
            )}
          </SubGroup>

          {/* Session Additions */}
          <SubGroup
            label="会话追加"
            open={sessionAdditionsOpen}
            onToggle={() => setSessionAdditionsOpen((v) => !v)}
          >
            {sessionConfig.supplementaryPrompt ? (
              <div className="text-xs text-zinc-600 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-800/50 rounded px-2 py-1.5 whitespace-pre-wrap break-words max-h-24 overflow-y-auto">
                {sessionConfig.supplementaryPrompt}
              </div>
            ) : (
              <span className="text-[11px] text-zinc-400 dark:text-zinc-500 italic pl-1">
                无补充提示词
              </span>
            )}
          </SubGroup>

          {/* Add Resource button */}
          <button
            type="button"
            onClick={handleAddResource}
            className="flex items-center gap-1.5 mt-2 px-2 py-1 text-xs text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800/60 rounded transition-colors w-full"
          >
            <Plus className="h-3 w-3" />
            添加资源
          </button>
        </AccordionSection>

        {/* Section 3: CAPABILITIES */}
        <AccordionSection
          title="能力"
          open={capsOpen}
          onToggle={() => setCapsOpen((v) => !v)}
        >
          {/* Provider / Model pill */}
          <div className="mb-2">
            <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-[11px] text-zinc-600 dark:text-zinc-400 max-w-full">
              <span className="truncate">{providerModelLabel}</span>
            </div>
          </div>

          {/* 2-col x 4-row capability grid */}
          <div className="grid grid-cols-2 gap-1.5">
            {CAPABILITY_ITEMS.map((item) => (
              <CapChip
                key={item.key}
                icon={item.icon}
                label={item.label}
                active={resolvedCaps[item.key]}
              />
            ))}
          </div>
        </AccordionSection>
      </div>
    </div>
  );
}
