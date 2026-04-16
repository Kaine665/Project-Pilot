'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from '@/client/i18n/use-translations';
import type { LucideIcon } from 'lucide-react';
import { Bot, ChevronDown, ChevronRight, Folder, FolderOpen, Globe, Layers, ListTodo, Package } from 'lucide-react';
import { AgentsRailPanelFrame } from '@/components/agents-rail-panel-frame';
import { FolderExplorerPanel } from '@/components/folder-explorer-panel';
import { AgentSessionPromptStack, type PromptStackSeedItem } from '@/components/agent-session-prompt-stack';
import { AgentsWorkspaceSimpleBrowser } from '@/components/agents-workspace-simple-browser';
import { ArtifactsPanelBody, type ArtifactsPanelPayload } from '@/components/agent-chat/artifacts-panel';
import { useMediaQuery } from '@/hooks/use-media-query';
import {
  readAgentsRailDetailPanelFractions,
  writeAgentsRailDetailPanelFractions,
} from '@/lib/agents-workspace-ui-shared';
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
  /**
   * 数据根下相对路径：`projects/workspaces/<projectKey>`（与 `agents/workspaces/<id>` 一致，由应用分配，非用户自选磁盘路径）。
   * 有当前项目 key 时传入；与 `projectRootPath` 并列展示。
   */
  projectWorkMaterialsRelativePath?: string | null;
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
/** 桌面「Agent 数据 / 提示词 / 能力」竖向分栏：各段是否收起 `[数据, 提示词, 能力]` */
const DETAIL_PANELS_COLLAPSED_KEY = 'pp.agentsRail.detailPanelsCollapsed.v1';

const DETAIL_PANEL_MIN_PX = 72;

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

function readDetailPanelsCollapsed(): [boolean, boolean, boolean] {
  try {
    const raw = localStorage.getItem(DETAIL_PANELS_COLLAPSED_KEY);
    if (!raw) return [false, false, false];
    const a = JSON.parse(raw) as unknown;
    if (Array.isArray(a) && a.length === 3 && a.every((x) => typeof x === 'boolean')) {
      return [a[0], a[1], a[2]];
    }
  } catch { /* ignore */ }
  return [false, false, false];
}

export function AgentsWorkspaceRail({
  className,
  projectRootPath,
  projectWorkMaterialsRelativePath,
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

  /** 桌面竖向三分栏：各段是否收起；默认全展开，持久化到 localStorage */
  const [detailPanelsCollapsed, setDetailPanelsCollapsed] = useState<[boolean, boolean, boolean]>([
    false,
    false,
    false,
  ]);
  useEffect(() => {
    setDetailPanelsCollapsed(readDetailPanelsCollapsed());
  }, []);

  const toggleDetailPanel = useCallback((slot: 0 | 1 | 2) => {
    setDetailPanelsCollapsed((prev) => {
      const next: [boolean, boolean, boolean] = [prev[0], prev[1], prev[2]];
      next[slot] = !next[slot];
      try {
        localStorage.setItem(DETAIL_PANELS_COLLAPSED_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const [detailPanelFractions, setDetailPanelFractions] = useState(() => readAgentsRailDetailPanelFractions());

  const detailStackRef = useRef<HTMLDivElement | null>(null);
  const detailFractionsLiveRef = useRef<[number, number, number]>([1 / 3, 1 / 3, 1 / 3]);
  detailFractionsLiveRef.current = detailPanelFractions;

  const dragSessionRef = useRef<{
    which: 0 | 1;
    pointerId: number;
    startClientY: number;
    startFractions: [number, number, number];
    containerHeight: number;
  } | null>(null);

  const allDetailPanelsExpanded =
    !detailPanelsCollapsed[0] && !detailPanelsCollapsed[1] && !detailPanelsCollapsed[2];

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const sess = dragSessionRef.current;
      if (!sess || e.pointerId !== sess.pointerId) return;
      const dy = e.clientY - sess.startClientY;
      const H = sess.containerHeight;
      if (H < DETAIL_PANEL_MIN_PX * 3 + 4) return;
      const [f0, f1, f2] = sess.startFractions;
      const h0 = H * f0;
      const h1 = H * f1;
      const h2 = H * f2;
      const MIN = DETAIL_PANEL_MIN_PX;
      let nf0 = f0;
      let nf1 = f1;
      let nf2 = f2;
      if (sess.which === 0) {
        let nh0 = h0 + dy;
        nh0 = Math.max(MIN, Math.min(nh0, H - h2 - MIN));
        const nh1 = H - h2 - nh0;
        nf0 = nh0 / H;
        nf1 = nh1 / H;
        nf2 = f2;
      } else {
        let nh1 = h1 + dy;
        nh1 = Math.max(MIN, Math.min(nh1, H - h0 - MIN));
        const nh2 = H - h0 - nh1;
        nf0 = f0;
        nf1 = nh1 / H;
        nf2 = nh2 / H;
      }
      const sum = nf0 + nf1 + nf2;
      if (sum <= 0) return;
      const next: [number, number, number] = [nf0 / sum, nf1 / sum, nf2 / sum];
      detailFractionsLiveRef.current = next;
      setDetailPanelFractions(next);
    };
    const onUp = (e: PointerEvent) => {
      const sess = dragSessionRef.current;
      if (!sess || e.pointerId !== sess.pointerId) return;
      dragSessionRef.current = null;
      writeAgentsRailDetailPanelFractions(detailFractionsLiveRef.current);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, []);

  const onDetailResizePointerDown = useCallback(
    (which: 0 | 1) => (e: React.PointerEvent<HTMLDivElement>) => {
      if (!detailStackRef.current || !allDetailPanelsExpanded) return;
      e.preventDefault();
      const rect = detailStackRef.current.getBoundingClientRect();
      const H = Math.max(0, rect.height);
      if (H < DETAIL_PANEL_MIN_PX * 3 + 4) return;
      dragSessionRef.current = {
        which,
        pointerId: e.pointerId,
        startClientY: e.clientY,
        startFractions: [...detailFractionsLiveRef.current] as [number, number, number],
        containerHeight: H,
      };
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    },
    [allDetailPanelsExpanded],
  );

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

  const renderDetailAgentDataBody = () =>
    workspaceAgentDataPath ? (
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

  const renderDetailPromptBody = () => (
    <div className="min-h-0 flex-1 overflow-hidden [overflow-anchor:none]" data-rail-panel-body="prompt">
      <AgentSessionPromptStack key={promptStackKey} items={promptStackItems} hideHeader />
    </div>
  );

  const renderDetailCapabilitiesBody = () => (
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

  const renderActivePanel = () => {
    switch (activeTab) {
      case 0: {
        const hasCode = Boolean(projectRootPath?.trim());
        const wm = projectWorkMaterialsRelativePath?.trim() ?? null;

        if (!wm) {
          return (
            <div className="flex min-h-[72px] flex-1 items-center justify-center px-4 py-4 text-center text-[11px] leading-snug text-muted-foreground">
              {t('repoWorkspace.empty')}
            </div>
          );
        }

        const workExplorer = (
          <FolderExplorerPanel
            key={`proj-wm:${wm}`}
            embedded
            hideFolderSummaryBar
            lockToInitialDataPath
            onClose={() => {}}
            initialPath={wm}
            initialResolveMode="data"
          />
        );

        if (!hasCode) {
          return (
            <div
              className="flex min-h-0 flex-1 flex-col overflow-hidden [overflow-anchor:none]"
              data-rail-panel-body="project-root"
            >
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{workExplorer}</div>
            </div>
          );
        }

        return (
          <div
            className="flex min-h-0 flex-1 flex-col overflow-hidden [overflow-anchor:none]"
            data-rail-panel-body="project-root"
          >
            <div className="flex min-h-0 min-h-[30%] flex-1 flex-col overflow-hidden border-b border-border/60">
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                <FolderExplorerPanel
                  key={`proj:${projectRootPath}`}
                  embedded
                  hideFolderSummaryBar
                  onClose={() => {}}
                  initialPath={projectRootPath!}
                />
              </div>
            </div>
            <div className="flex min-h-0 min-h-[30%] flex-1 flex-col overflow-hidden">
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{workExplorer}</div>
            </div>
          </div>
        );
      }
      case 1:
        return renderDetailAgentDataBody();
      case 2:
        return renderDetailPromptBody();
      case 3:
        return renderDetailCapabilitiesBody();
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

        {/* 桌面（lg+）：Agent 数据 / 提示词 / 能力 → VS Code 式竖向分栏；全展开时可拖动分隔条调比例 */}
        {isDetailTab && lgUp ? (
          <div
            ref={detailStackRef}
            role="region"
            id="agents-rail-main-panel"
            aria-labelledby="agents-rail-panel-title"
            className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
          >
            {allDetailPanelsExpanded ? (
              <>
                {/* 1 Agent 数据 */}
                <section
                  data-rail-detail-section={1}
                  className="flex min-h-0 min-w-0 flex-col overflow-hidden"
                  style={{ flex: `${detailPanelFractions[0]} 1 0%`, minHeight: 0 }}
                >
                  <button
                    type="button"
                    id="agents-rail-detail-1"
                    aria-expanded
                    title={fullTitles[1]}
                    onClick={() => toggleDetailPanel(0)}
                    className="flex h-8 shrink-0 items-center gap-1.5 border-b border-border/50 bg-muted/35 px-2 text-left text-[11px] font-medium text-foreground transition-colors hover:bg-muted/55 dark:bg-muted/25 dark:hover:bg-muted/40"
                  >
                    <span className="text-muted-foreground" aria-hidden>
                      <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                    </span>
                    <span className="text-muted-foreground/80">{tabIcons[1]}</span>
                    <span className="min-w-0 flex-1 truncate">{tabLabels[1]}</span>
                  </button>
                  <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{renderDetailAgentDataBody()}</div>
                </section>
                {/* 接缝处零占位，透明层跨缝接收拖动，界面上无任何可见「条」 */}
                <div className="pointer-events-none relative z-[5] h-0 shrink-0 overflow-visible">
                  <div
                    role="presentation"
                    aria-hidden
                    className="pointer-events-auto absolute inset-x-0 top-0 z-[5] h-10 -translate-y-1/2 cursor-ns-resize touch-none select-none"
                    onPointerDown={onDetailResizePointerDown(0)}
                  />
                </div>
                {/* 2 提示词 */}
                <section
                  data-rail-detail-section={2}
                  className="flex min-h-0 min-w-0 flex-col overflow-hidden"
                  style={{ flex: `${detailPanelFractions[1]} 1 0%`, minHeight: 0 }}
                >
                  <button
                    type="button"
                    id="agents-rail-detail-2"
                    aria-expanded
                    title={fullTitles[2]}
                    onClick={() => toggleDetailPanel(1)}
                    className="flex h-8 shrink-0 items-center gap-1.5 border-b border-border/50 bg-muted/35 px-2 text-left text-[11px] font-medium text-foreground transition-colors hover:bg-muted/55 dark:bg-muted/25 dark:hover:bg-muted/40"
                  >
                    <span className="text-muted-foreground" aria-hidden>
                      <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                    </span>
                    <span className="text-muted-foreground/80">{tabIcons[2]}</span>
                    <span className="min-w-0 flex-1 truncate">{tabLabels[2]}</span>
                  </button>
                  <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{renderDetailPromptBody()}</div>
                </section>
                <div className="pointer-events-none relative z-[5] h-0 shrink-0 overflow-visible">
                  <div
                    role="presentation"
                    aria-hidden
                    className="pointer-events-auto absolute inset-x-0 top-0 z-[5] h-10 -translate-y-1/2 cursor-ns-resize touch-none select-none"
                    onPointerDown={onDetailResizePointerDown(1)}
                  />
                </div>
                {/* 3 能力 */}
                <section
                  data-rail-detail-section={3}
                  className="flex min-h-0 min-w-0 flex-col overflow-hidden"
                  style={{ flex: `${detailPanelFractions[2]} 1 0%`, minHeight: 0 }}
                >
                  <button
                    type="button"
                    id="agents-rail-detail-3"
                    aria-expanded
                    title={fullTitles[3]}
                    onClick={() => toggleDetailPanel(2)}
                    className="flex h-8 shrink-0 items-center gap-1.5 border-b border-border/50 bg-muted/35 px-2 text-left text-[11px] font-medium text-foreground transition-colors hover:bg-muted/55 dark:bg-muted/25 dark:hover:bg-muted/40"
                  >
                    <span className="text-muted-foreground" aria-hidden>
                      <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                    </span>
                    <span className="text-muted-foreground/80">{tabIcons[3]}</span>
                    <span className="min-w-0 flex-1 truncate">{tabLabels[3]}</span>
                  </button>
                  <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{renderDetailCapabilitiesBody()}</div>
                </section>
              </>
            ) : (
              (
                [
                  { slot: 0 as const, tabIdx: 1 as const, body: renderDetailAgentDataBody },
                  { slot: 1 as const, tabIdx: 2 as const, body: renderDetailPromptBody },
                  { slot: 2 as const, tabIdx: 3 as const, body: renderDetailCapabilitiesBody },
                ] as const
              ).map(({ slot, tabIdx, body }) => {
                const collapsed = detailPanelsCollapsed[slot];
                return (
                  <section
                    key={tabIdx}
                    data-rail-detail-section={tabIdx}
                    className={cn(
                      'flex min-h-0 flex-col border-b border-border/60 last:border-b-0 dark:border-border/50',
                      collapsed ? 'shrink-0' : 'min-h-[72px] flex-1',
                    )}
                  >
                    <button
                      type="button"
                      id={`agents-rail-detail-${tabIdx}`}
                      aria-expanded={!collapsed}
                      title={fullTitles[tabIdx]}
                      onClick={() => toggleDetailPanel(slot)}
                      className={cn(
                        'flex h-8 shrink-0 items-center gap-1.5 border-b border-border/50 bg-muted/35 px-2 text-left text-[11px] font-medium text-foreground transition-colors hover:bg-muted/55 dark:bg-muted/25 dark:hover:bg-muted/40',
                        collapsed && 'border-transparent',
                      )}
                    >
                      <span className="text-muted-foreground" aria-hidden>
                        {collapsed ? (
                          <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                        )}
                      </span>
                      <span className="text-muted-foreground/80">{tabIcons[tabIdx]}</span>
                      <span className="min-w-0 flex-1 truncate">{tabLabels[tabIdx]}</span>
                    </button>
                    {!collapsed ? (
                      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{body()}</div>
                    ) : null}
                  </section>
                );
              })
            )}
          </div>
        ) : (
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
                        : 'agents-rail-activity-agent')
                : `agents-rail-tab-${activeTab}`
            }
            className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
          >
            <AgentsRailPanelFrame title={fullTitles[activeTab] ?? ''} hideHeader={isDetailTab}>
              {renderActivePanel()}
            </AgentsRailPanelFrame>
          </div>
        )}
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
