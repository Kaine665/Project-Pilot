'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from '@/client/i18n/use-translations';
import type { LucideIcon } from 'lucide-react';
import { Bot, Folder, FolderOpen, Globe, Layers, ListTodo, Package } from 'lucide-react';
import { AgentsRailPanelFrame } from '@/components/agents-rail-panel-frame';
import { FolderExplorerPanel } from '@/components/folder-explorer-panel';
import { AgentSessionPromptStack, type PromptStackSeedItem } from '@/components/agent-session-prompt-stack';
import { AgentsWorkspaceSimpleBrowser } from '@/components/agents-workspace-simple-browser';
import { ArtifactsPanelBody, type ArtifactsPanelPayload } from '@/components/agent-chat/artifacts-panel';
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
  /** 简单浏览器是否以 Portal 铺满 Agents 页（顶栏以下）；由页面包容器 */
  simpleBrowserWorkspaceFill?: boolean;
  onSimpleBrowserWorkspaceFillChange?: (expanded: boolean) => void;
}

const NUM_TABS = 6;
const ACTIVE_TAB_KEY = 'pp.agentsRail.activeTab';

/** 一级活动栏外宽 52px；水平内边距 `px-1.5`；图标钮 `w-10` 与左侧迷你栏按钮同宽 */
const ACTIVITY_BAR_WIDTH_CLASS = 'w-[52px]';

/** 活动栏图标未选中态：hover 与轨道 `bg-muted/25` 拉开对比 */
const ACTIVITY_BTN_IDLE =
  'text-muted-foreground hover:bg-muted hover:text-foreground hover:shadow-sm hover:ring-1 hover:ring-border/70 dark:hover:bg-muted/80 dark:hover:ring-border/50';

function readStoredActiveTab(): number {
  try {
    const raw = localStorage.getItem(ACTIVE_TAB_KEY);
    if (raw == null) return 0;
    const n = parseInt(raw, 10);
    if (Number.isFinite(n) && n >= 0 && n < NUM_TABS) return n;
  } catch { /* ignore */ }
  return 0;
}

function initialLastDetailTabIndex(): number {
  const s = readStoredActiveTab();
  return s >= 1 && s <= 3 ? s : 1;
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
  simpleBrowserWorkspaceFill = false,
  onSimpleBrowserWorkspaceFillChange,
}: AgentsWorkspaceRailProps) {
  const t = useTranslations('agentsWorkspace');
  const tCap = useTranslations('agentsWorkspace.capabilities');
  const lgUp = useMediaQuery('(min-width: 1024px)');

  const [activeTab, setActiveTab] = useState(readStoredActiveTab);
  const lastDetailTabRef = useRef<number>(initialLastDetailTabIndex());

  const isDetailTab = activeTab >= 1 && activeTab <= 3;

  const setTab = useCallback((idx: number) => {
    setActiveTab(idx);
    if (idx >= 1 && idx <= 3) lastDetailTabRef.current = idx;
    try {
      localStorage.setItem(ACTIVE_TAB_KEY, String(idx));
    } catch { /* ignore */ }
  }, []);

  /** 与 `AgentChatPanel`（workspaceMode）通过 `pp:artifacts-payload` 同步，避免聊天区内再嵌一层产物栏 */
  const [railArtifactsPayload, setRailArtifactsPayload] = useState<ArtifactsPanelPayload | null>(null);

  useEffect(() => {
    const onPayload = (e: Event) => {
      const d = (e as CustomEvent<{ payload: ArtifactsPanelPayload | null }>).detail;
      setRailArtifactsPayload(d?.payload ?? null);
    };
    window.addEventListener('pp:artifacts-payload', onPayload);
    return () => window.removeEventListener('pp:artifacts-payload', onPayload);
  }, []);

  useEffect(() => {
    if (activeTab !== 4) onSimpleBrowserWorkspaceFillChange?.(false);
  }, [activeTab, onSimpleBrowserWorkspaceFillChange]);

  useEffect(() => {
    const focusArtifactsTab = () => setTab(5);
    window.addEventListener('pp:artifacts-rail-focus', focusArtifactsTab);
    window.addEventListener('open-artifacts-panel', focusArtifactsTab);
    window.addEventListener('open-distiller-panel', focusArtifactsTab);
    return () => {
      window.removeEventListener('pp:artifacts-rail-focus', focusArtifactsTab);
      window.removeEventListener('open-artifacts-panel', focusArtifactsTab);
      window.removeEventListener('open-distiller-panel', focusArtifactsTab);
    };
  }, [setTab]);

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
      t('simpleBrowser.title'),
      t('workspaceRail.artifactsActivityTitle'),
    ],
    [t],
  );

  const tabLabels = useMemo(
    () => [
      t('workspaceRail.tabProject'),
      t('workspaceRail.tabAgentData'),
      t('workspaceRail.tabPromptStack'),
      t('workspaceRail.tabCapabilities'),
      t('workspaceRail.tabBrowser'),
      t('workspaceRail.tabArtifacts'),
    ],
    [t],
  );

  const tabIcons: ReactNode[] = useMemo(
    () => [
      <FolderOpen key="i0" className="h-3.5 w-3.5 shrink-0" aria-hidden />,
      <Folder key="i1" className="h-3.5 w-3.5 shrink-0" aria-hidden />,
      <Layers key="i2" className="h-3.5 w-3.5 shrink-0" aria-hidden />,
      <ListTodo key="i3" className="h-3.5 w-3.5 shrink-0" aria-hidden />,
      <Globe key="i4" className="h-3.5 w-3.5 shrink-0" aria-hidden />,
      <Package key="i5" className="h-3.5 w-3.5 shrink-0" aria-hidden />,
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
            <FolderExplorerPanel
              key={`proj:${projectRootPath}`}
              embedded
              hideFolderSummaryBar
              onClose={() => {}}
              initialPath={projectRootPath}
            />
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
              hideFolderSummaryBar
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
      case 4:
        return (
          <AgentsWorkspaceSimpleBrowser
            className="min-h-0 flex-1"
            workspaceFill={simpleBrowserWorkspaceFill}
            onWorkspaceFillChange={onSimpleBrowserWorkspaceFillChange}
          />
        );
      case 5:
        return (
          <div
            className="flex min-h-0 flex-1 flex-col overflow-hidden border-border/40 bg-muted/5 dark:bg-muted/10"
            data-rail-panel-body="artifacts"
          >
            <ArtifactsPanelBody payload={railArtifactsPayload} />
          </div>
        );
      default:
        return null;
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
        {/* 窄屏：顶栏入口（项目 / 数据 / 提示词 / 能力 / 浏览器），扁平 */}
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
                onClick={() => {
                  setTab(i);
                  if (i === 5) {
                    window.dispatchEvent(new CustomEvent('open-artifacts-panel'));
                  }
                }}
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

        {/* Agent 数据 / 提示词 / 能力：共用顶栏标题，位于二级标签之上（桌面与窄屏一致） */}
        {isDetailTab ? (
          <header className="shrink-0 border-b border-border/80 bg-muted/30 px-3 py-2 dark:bg-muted/20">
            <h2
              id="agents-rail-panel-title"
              className="truncate text-xs font-semibold leading-tight tracking-tight text-foreground"
            >
              {t('workspaceRail.agentControlCenterTitle')}
            </h2>
          </header>
        ) : null}

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
              ? (activeTab === 0
                  ? 'agents-rail-activity-project'
                  : activeTab === 4
                    ? 'agents-rail-activity-browser'
                    : activeTab === 5
                      ? 'agents-rail-activity-artifacts'
                      : `agents-rail-detail-${activeTab}`)
              : `agents-rail-tab-${activeTab}`
          }
          className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
        >
          <AgentsRailPanelFrame title={fullTitles[activeTab] ?? ''} hideHeader={isDetailTab}>
            {renderActivePanel()}
          </AgentsRailPanelFrame>
        </div>
      </div>

      {/* 桌面：一级入口（项目 / Agent 配置 / 简单浏览器），尺寸对齐左侧 SidebarNavRow 迷你态 */}
      <nav
        aria-label={t('workspaceRail.activityBarAria')}
        className={cn(
          'hidden shrink-0 flex-col items-center gap-2 border-l border-border/80 bg-muted/25 px-1.5 py-3 dark:bg-muted/15 lg:flex',
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
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg transition-all duration-150',
            activeTab === 0
              ? 'bg-background text-foreground shadow-sm ring-1 ring-border dark:bg-card'
              : ACTIVITY_BTN_IDLE,
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
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg transition-all duration-150',
            isDetailTab
              ? 'bg-background text-foreground shadow-sm ring-1 ring-border dark:bg-card'
              : ACTIVITY_BTN_IDLE,
          )}
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center" aria-hidden>
            <Bot className="h-5 w-5 shrink-0" />
          </span>
        </button>
        <button
          type="button"
          id="agents-rail-activity-artifacts"
          title={t('workspaceRail.artifactsActivityTitle')}
          aria-label={t('workspaceRail.tabArtifacts')}
          aria-pressed={activeTab === 5}
          aria-controls="agents-rail-main-panel"
          onClick={() => {
            setTab(5);
            window.dispatchEvent(new CustomEvent('open-artifacts-panel'));
          }}
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg transition-all duration-150',
            activeTab === 5
              ? 'bg-background text-foreground shadow-sm ring-1 ring-border dark:bg-card'
              : ACTIVITY_BTN_IDLE,
          )}
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center" aria-hidden>
            <Package className="h-5 w-5 shrink-0" />
          </span>
        </button>
        <button
          type="button"
          id="agents-rail-activity-browser"
          title={fullTitles[4]}
          aria-label={fullTitles[4]}
          aria-pressed={activeTab === 4}
          aria-controls="agents-rail-main-panel"
          onClick={() => setTab(4)}
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg transition-all duration-150',
            activeTab === 4
              ? 'bg-background text-foreground shadow-sm ring-1 ring-border dark:bg-card'
              : ACTIVITY_BTN_IDLE,
          )}
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center" aria-hidden>
            <Globe className="h-5 w-5 shrink-0" />
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
