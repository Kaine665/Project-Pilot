'use client';

import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from '@/client/i18n/use-translations';
import type { LucideIcon } from 'lucide-react';
import { Bot, Folder, FolderOpen, Layers, ListTodo } from 'lucide-react';
import { FolderExplorerPanel } from '@/components/folder-explorer-panel';
import { AgentSessionPromptStack, type PromptStackSeedItem } from '@/components/agent-session-prompt-stack';
import { useMediaQuery } from '@/hooks/use-media-query';
import { cn } from '@/lib/utils';
import type { AgentCapabilities } from '@/types';
import { DEFAULT_AGENT_CAPABILITIES } from '@/types';

export interface AgentsRailCapabilityItem {
  label: string;
  hint: string;
  icon: LucideIcon;
  capabilityKey: keyof AgentCapabilities;
}

export interface AgentsWorkspaceRailProps {
  className?: string;
  projectRootPath?: string | null;
  workspaceAgentDataPath: string | null | undefined;
  promptStackItems: PromptStackSeedItem[];
  promptStackKey: string;
  capabilityCards: readonly AgentsRailCapabilityItem[];
  capabilityAgentId?: string | null;
  capabilities?: AgentCapabilities;
  onCapabilitiesUpdated?: (next: AgentCapabilities) => void;
}

const NUM_TABS = 4;
const ACTIVE_TAB_KEY = 'pp.agentsRail.activeTab';

/** 一级活动栏外宽 72px（与左侧迷你栏一致）；水平内边距 `px-2` 为原 `px-4` 的一半 */
const ACTIVITY_BAR_WIDTH_CLASS = 'w-[72px]';

function readStoredActiveTab(): number {
  try {
    const raw = localStorage.getItem(ACTIVE_TAB_KEY);
    if (raw == null) return 0;
    const n = parseInt(raw, 10);
    if (Number.isFinite(n) && n >= 0 && n < NUM_TABS) return n;
  } catch { /* ignore */ }
  return 0;
}

export function AgentsWorkspaceRail({
  className,
  projectRootPath,
  workspaceAgentDataPath,
  promptStackItems,
  promptStackKey,
  capabilityCards,
  capabilityAgentId,
  capabilities: capabilitiesProp,
  onCapabilitiesUpdated,
}: AgentsWorkspaceRailProps) {
  const t = useTranslations('agentsWorkspace');
  const tCap = useTranslations('agentsWorkspace.capabilities');
  const lgUp = useMediaQuery('(min-width: 1024px)');

  const [activeTab, setActiveTab] = useState(readStoredActiveTab);
  const lastDetailTabRef = useRef<number>(() => {
    const s = readStoredActiveTab();
    return s >= 1 && s <= 3 ? s : 1;
  });

  const isDetailTab = activeTab >= 1 && activeTab <= 3;

  const setTab = useCallback((idx: number) => {
    setActiveTab(idx);
    if (idx >= 1 && idx <= 3) lastDetailTabRef.current = idx;
    try {
      localStorage.setItem(ACTIVE_TAB_KEY, String(idx));
    } catch { /* ignore */ }
  }, []);

  const [capabilitySavingKey, setCapabilitySavingKey] = useState<keyof AgentCapabilities | null>(null);

  const effectiveCapabilities = useMemo(
    () => ({ ...DEFAULT_AGENT_CAPABILITIES, ...capabilitiesProp }),
    [capabilitiesProp],
  );

  const patchCapability = useCallback(
    async (key: keyof AgentCapabilities, enabled: boolean) => {
      if (!capabilityAgentId || !onCapabilitiesUpdated) return;
      const next = { ...effectiveCapabilities, [key]: enabled };
      setCapabilitySavingKey(key);
      try {
        const res = await fetch('/api/agents', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: capabilityAgentId, capabilities: next }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : `HTTP ${res.status}`);
        onCapabilitiesUpdated(next);
      } catch { /* silent */ } finally {
        setCapabilitySavingKey(null);
      }
    },
    [capabilityAgentId, effectiveCapabilities, onCapabilitiesUpdated],
  );

  const fullTitles = useMemo(
    () => [
      t('repoWorkspace.title'),
      t('projectWorkspace.title'),
      t('promptStack.title'),
      t('capabilities.title'),
    ],
    [t],
  );

  const tabLabels = useMemo(
    () => [
      t('workspaceRail.tabProject'),
      t('workspaceRail.tabAgentData'),
      t('workspaceRail.tabPromptStack'),
      t('workspaceRail.tabCapabilities'),
    ],
    [t],
  );

  const tabIcons: ReactNode[] = useMemo(
    () => [
      <FolderOpen key="i0" className="h-3.5 w-3.5 shrink-0" aria-hidden />,
      <Folder key="i1" className="h-3.5 w-3.5 shrink-0" aria-hidden />,
      <Layers key="i2" className="h-3.5 w-3.5 shrink-0" aria-hidden />,
      <ListTodo key="i3" className="h-3.5 w-3.5 shrink-0" aria-hidden />,
    ],
    [],
  );

  const renderActivePanel = () => {
    switch (activeTab) {
      case 0:
        return projectRootPath ? (
          <div
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain [overflow-anchor:none]"
            data-rail-panel-body="project-root"
          >
            <FolderExplorerPanel key={`proj:${projectRootPath}`} embedded onClose={() => {}} initialPath={projectRootPath} />
          </div>
        ) : (
          <div className="flex min-h-[72px] flex-1 items-center justify-center px-4 py-4 text-center text-[11px] leading-snug text-muted-foreground">
            {t('repoWorkspace.empty')}
          </div>
        );
      case 1:
        return workspaceAgentDataPath ? (
          <div
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain [overflow-anchor:none]"
            data-rail-panel-body="folder"
          >
            <FolderExplorerPanel
              key={workspaceAgentDataPath}
              embedded
              lockToInitialDataPath
              onClose={() => {}}
              initialPath={workspaceAgentDataPath}
              initialResolveMode="data"
            />
          </div>
        ) : (
          <div className="flex min-h-[120px] flex-1 items-center justify-center px-4 py-6 text-center text-[11px] leading-snug text-muted-foreground">
            {t('projectWorkspace.empty')}
          </div>
        );
      case 2:
        return (
          <div className="min-h-0 flex-1 overflow-hidden [overflow-anchor:none]" data-rail-panel-body="prompt">
            <AgentSessionPromptStack key={promptStackKey} items={promptStackItems} hideHeader />
          </div>
        );
      case 3:
      default:
        return (
          <div
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1.5 pb-2 pt-1 [overflow-anchor:none]"
            data-rail-panel-body="capabilities"
          >
            <div className="grid grid-cols-2 gap-1.5" role="list">
              {capabilityCards.map((item) => {
                const Icon = item.icon;
                const canToggle = Boolean(capabilityAgentId && onCapabilitiesUpdated);
                const busy = capabilitySavingKey === item.capabilityKey;
                const on = effectiveCapabilities[item.capabilityKey];
                return (
                  <div
                    key={item.capabilityKey}
                    role="listitem"
                    className={cn(
                      'flex items-center gap-1.5 rounded-lg border border-border/30 bg-card/50 px-1.5 py-1.5',
                      !on && 'opacity-80',
                    )}
                    title={item.hint}
                  >
                    <Icon className={cn('h-3.5 w-3.5 shrink-0', on ? 'text-muted-foreground' : 'text-muted-foreground/35')} />
                    <span className="min-w-0 flex-1 truncate text-[10px] font-medium leading-tight">{item.label}</span>
                    <RailCapabilitySwitch
                      checked={on}
                      disabled={!canToggle || busy}
                      ariaLabel={on ? tCap('enabledAria', { label: item.label }) : tCap('disabledAria', { label: item.label })}
                      onCheckedChange={(next) => patchCapability(item.capabilityKey, next)}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        );
    }
  };

  const detailTabIndices = [1, 2, 3] as const;

  const handleActivityClick = useCallback((group: 'project' | 'agent') => {
    if (group === 'project') {
      setTab(0);
    } else {
      setTab(isDetailTab ? activeTab : lastDetailTabRef.current);
    }
  }, [activeTab, isDetailTab, setTab]);

  return (
    <div className={cn('flex min-h-0 flex-1 flex-row overflow-hidden [overflow-anchor:none]', className)}>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {/* 窄屏：顶栏四个入口（项目 / 数据 / 提示词 / 能力），扁平 */}
        <div
          role="tablist"
          aria-label={t('workspaceRail.tablistAria')}
          className="flex h-9 shrink-0 items-stretch gap-0.5 overflow-x-auto border-b border-border/80 bg-muted/35 px-1.5 pt-1 [-ms-overflow-style:none] [scrollbar-width:none] dark:bg-muted/25 lg:hidden [&::-webkit-scrollbar]:hidden"
        >
          {tabLabels.map((label, i) => {
            const selected = activeTab === i;
            return (
              <button
                key={i}
                type="button"
                role="tab"
                id={`agents-rail-tab-${i}`}
                aria-selected={selected}
                aria-controls="agents-rail-main-panel"
                title={fullTitles[i]}
                onClick={() => setTab(i)}
                className={cn(
                  'flex min-h-8 max-w-[min(11rem,42vw)] shrink-0 items-center gap-1.5 rounded-t-md border border-transparent px-2.5 py-1 text-left text-[11px] font-medium transition-colors',
                  selected
                    ? 'border-border border-b-background bg-background text-foreground shadow-sm dark:border-border dark:bg-card'
                    : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground',
                )}
              >
                <span className="text-muted-foreground/80">{tabIcons[i]}</span>
                <span className="min-w-0 flex-1 truncate">{label}</span>
              </button>
            );
          })}
        </div>

        {/* 桌面：二级横排标签（Agent 数据 / 提示词 / 能力），仅一级选中「Agent 配置」时显示 */}
        {isDetailTab && (
          <div
            role="tablist"
            aria-label={t('workspaceRail.detailTabsAria')}
            className="hidden h-8 shrink-0 items-stretch gap-0.5 border-b border-border/80 bg-muted/30 px-1.5 dark:bg-muted/20 lg:flex"
          >
            {detailTabIndices.map((idx) => {
              const selected = activeTab === idx;
              return (
                <button
                  key={idx}
                  type="button"
                  role="tab"
                  id={`agents-rail-detail-${idx}`}
                  aria-selected={selected}
                  aria-controls="agents-rail-main-panel"
                  title={fullTitles[idx]}
                  onClick={() => setTab(idx)}
                  className={cn(
                    'flex min-h-7 min-w-0 flex-1 items-center justify-center gap-1 rounded-md border border-transparent px-2 text-[11px] font-medium transition-colors',
                    selected
                      ? 'border-border bg-background text-foreground shadow-sm dark:border-border dark:bg-card'
                      : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground',
                  )}
                >
                  <span className="text-muted-foreground/80">{tabIcons[idx]}</span>
                  <span className="min-w-0 truncate">{tabLabels[idx]}</span>
                </button>
              );
            })}
          </div>
        )}

        <div
          role="tabpanel"
          id="agents-rail-main-panel"
          aria-labelledby={
            lgUp
              ? (activeTab === 0 ? 'agents-rail-activity-project' : `agents-rail-detail-${activeTab}`)
              : `agents-rail-tab-${activeTab}`
          }
          className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
        >
          {renderActivePanel()}
        </div>
      </div>

      {/* 桌面：一级入口（项目工作区 / Agent 配置），尺寸对齐左侧 SidebarNavRow 迷你态 */}
      <nav
        aria-label={t('workspaceRail.activityBarAria')}
        className={cn(
          'hidden shrink-0 flex-col items-center gap-2 border-l border-border/80 bg-muted/25 px-2 py-3 dark:bg-muted/15 lg:flex',
          ACTIVITY_BAR_WIDTH_CLASS,
        )}
      >
        <button
          type="button"
          id="agents-rail-activity-project"
          title={fullTitles[0]}
          aria-label={fullTitles[0]}
          aria-pressed={activeTab === 0}
          aria-controls="agents-rail-main-panel"
          onClick={() => handleActivityClick('project')}
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg transition-colors',
            activeTab === 0
              ? 'bg-background text-foreground shadow-sm ring-1 ring-border dark:bg-card'
              : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground',
          )}
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center" aria-hidden>
            <FolderOpen className="h-5 w-5 shrink-0" />
          </span>
        </button>
        <button
          type="button"
          id="agents-rail-activity-agent"
          title={t('workspaceRail.agentConfigGroup')}
          aria-label={t('workspaceRail.agentConfigGroup')}
          aria-pressed={isDetailTab}
          aria-controls="agents-rail-main-panel"
          onClick={() => handleActivityClick('agent')}
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg transition-colors',
            isDetailTab
              ? 'bg-background text-foreground shadow-sm ring-1 ring-border dark:bg-card'
              : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground',
          )}
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center" aria-hidden>
            <Bot className="h-5 w-5 shrink-0" />
          </span>
        </button>
      </nav>
    </div>
  );
}

function RailCapabilitySwitch({
  checked,
  disabled,
  ariaLabel,
  onCheckedChange,
}: {
  checked: boolean;
  disabled?: boolean;
  ariaLabel: string;
  onCheckedChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => { if (!disabled) onCheckedChange(!checked); }}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors',
        disabled && 'cursor-not-allowed opacity-45',
        checked ? 'bg-primary' : 'bg-muted',
      )}
    >
      <span
        className={cn(
          'pointer-events-none mt-px inline-block h-3.5 w-3.5 rounded-full bg-background shadow-sm ring-0 transition-transform',
          checked ? 'translate-x-[18px]' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}
