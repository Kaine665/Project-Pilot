'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useTranslations } from '@/client/i18n/use-translations';
import type { LucideIcon } from 'lucide-react';
import { FolderOpen, ListTodo } from 'lucide-react';
import { FolderExplorerPanel } from '@/components/folder-explorer-panel';
import { AgentSessionPromptStack, type PromptStackSeedItem } from '@/components/agent-session-prompt-stack';
import { WorkspaceRailPanelHeader, WorkspaceRailResizeHandle } from '@/components/workspace-rail-panel-header';
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
  workspaceAgentDataPath: string | null | undefined;
  promptStackItems: PromptStackSeedItem[];
  promptStackKey: string;
  capabilityCards: readonly AgentsRailCapabilityItem[];
  /** 当前侧栏能力开关对应的 Agent；为空则开关禁用 */
  capabilityAgentId?: string | null;
  /** 与 capabilityCards 一致的当前能力快照（已与 DEFAULT 合并） */
  capabilities?: AgentCapabilities;
  /** PATCH 成功后由父级更新 agents / 表单 */
  onCapabilitiesUpdated?: (next: AgentCapabilities) => void;
}

const STORAGE_KEY = 'pp.agentsRail.folderRatio';
const FOLDER_COLLAPSED_STORAGE_KEY = 'pp.agentsRail.folderCollapsed';

const FOLDER_HEADER_PX = 32;
/** resize handle 现在是 0 高度（隐形线），只保留 1px 视觉分隔 */
const FOLDER_GAP_BELOW_PX = 1;
const MIN_FOLDER_BODY_PX = 72;
const MIN_BOTTOM_STACK_PX = 140;

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function readStoredFolderRatio(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw == null) return 0.38;
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0.12 && n <= 0.82) return n;
  } catch {
    /* ignore */
  }
  return 0.38;
}

/** 首次打开默认折叠（true）；用户手动切换后记住偏好 */
function readStoredFolderCollapsed(): boolean {
  try {
    const raw = localStorage.getItem(FOLDER_COLLAPSED_STORAGE_KEY);
    if (raw === 'false') return false;
    if (raw === 'true') return true;
  } catch {
    /* ignore */
  }
  return true;
}

export function AgentsWorkspaceRail({
  className,
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
        if (!res.ok) {
          throw new Error(typeof data.error === 'string' ? data.error : `HTTP ${res.status}`);
        }
        onCapabilitiesUpdated(next);
      } catch {
        /* 静默失败；可后续接 toast */
      } finally {
        setCapabilitySavingKey(null);
      }
    },
    [capabilityAgentId, effectiveCapabilities, onCapabilitiesUpdated],
  );

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerHeight, setContainerHeight] = useState(0);
  const [folderCollapsed, setFolderCollapsed] = useState(readStoredFolderCollapsed);
  const [promptCollapsed, setPromptCollapsed] = useState(false);
  const [capCollapsed, setCapCollapsed] = useState(false);

  const [folderRatio, setFolderRatio] = useState(readStoredFolderRatio);
  const folderRatioRef = useRef(folderRatio);
  folderRatioRef.current = folderRatio;

  const [isDraggingResize, setIsDraggingResize] = useState(false);
  const dragRef = useRef<{ startY: number; startTopPx: number } | null>(null);
  const resizeHandleRef = useRef<HTMLButtonElement | null>(null);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setContainerHeight(el.getBoundingClientRect().height);
    });
    ro.observe(el);
    setContainerHeight(el.getBoundingClientRect().height);
    return () => ro.disconnect();
  }, []);

  const persistFolderRatio = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(folderRatioRef.current));
    } catch {
      /* ignore */
    }
  }, []);

  const onResizePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (folderCollapsed) return;
      event.preventDefault();
      const root = containerRef.current;
      if (!root) return;
      const h = root.getBoundingClientRect().height;
      const inner = Math.max(0, h - FOLDER_GAP_BELOW_PX);
      const startTopPx = folderRatioRef.current * inner;
      dragRef.current = { startY: event.clientY, startTopPx };
      event.currentTarget.setPointerCapture(event.pointerId);
      setIsDraggingResize(true);
    },
    [folderCollapsed],
  );

  useEffect(() => {
    if (!isDraggingResize) return;

    const onMove = (event: PointerEvent) => {
      const root = containerRef.current;
      const drag = dragRef.current;
      if (!root || !drag) return;

      const h = root.getBoundingClientRect().height;
      const inner = Math.max(1, h - FOLDER_GAP_BELOW_PX);
      const minTop = FOLDER_HEADER_PX + MIN_FOLDER_BODY_PX;
      const maxTop = Math.max(minTop, h - FOLDER_GAP_BELOW_PX - MIN_BOTTOM_STACK_PX);
      const delta = event.clientY - drag.startY;
      const nextTop = clamp(drag.startTopPx + delta, minTop, maxTop);
      setFolderRatio(nextTop / inner);
    };

    const onUp = (event: PointerEvent) => {
      const handle = resizeHandleRef.current;
      try {
        if (handle?.hasPointerCapture(event.pointerId)) {
          handle.releasePointerCapture(event.pointerId);
        }
      } catch {
        /* ignore */
      }
      dragRef.current = null;
      setIsDraggingResize(false);
      persistFolderRatio();
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';

    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isDraggingResize, persistFolderRatio]);

  const innerHeight = Math.max(0, containerHeight - FOLDER_GAP_BELOW_PX);
  const minTopPx = FOLDER_HEADER_PX + MIN_FOLDER_BODY_PX;
  const maxTopPx =
    containerHeight > 0
      ? Math.max(minTopPx, containerHeight - FOLDER_GAP_BELOW_PX - MIN_BOTTOM_STACK_PX)
      : minTopPx;

  const folderBlockHeightPx = folderCollapsed
    ? FOLDER_HEADER_PX
    : containerHeight > 0
      ? clamp(Math.round(folderRatio * innerHeight), minTopPx, maxTopPx)
      : undefined;

  return (
    <div
      ref={containerRef}
      className={cn('flex min-h-0 flex-1 flex-col overflow-hidden [overflow-anchor:none]', className)}
    >
      {/* ── Folder explorer panel ── */}
      <section
        className={cn(
          'flex min-h-0 shrink-0 flex-col overflow-hidden',
          !folderCollapsed && containerHeight === 0 && 'min-h-[min(40%,240px)] flex-1',
        )}
        style={
          folderCollapsed
            ? { height: FOLDER_HEADER_PX }
            : containerHeight > 0
              ? { height: folderBlockHeightPx }
              : undefined
        }
      >
        <WorkspaceRailPanelHeader
          title={t('projectWorkspace.title')}
          icon={<FolderOpen className="h-3.5 w-3.5" aria-hidden />}
          collapsed={folderCollapsed}
          onToggleCollapsed={() => setFolderCollapsed((v) => {
            const next = !v;
            try { localStorage.setItem(FOLDER_COLLAPSED_STORAGE_KEY, String(next)); } catch { /* ignore */ }
            return next;
          })}
          toggleTitle={folderCollapsed ? t('workspaceRail.expandSection') : t('workspaceRail.collapseSection')}
        />
        {!folderCollapsed ? (
          <div
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain [overflow-anchor:none]"
            data-rail-panel-body="folder"
          >
            {workspaceAgentDataPath ? (
              <FolderExplorerPanel
                key={workspaceAgentDataPath}
                embedded
                lockToInitialDataPath
                onClose={() => {}}
                initialPath={workspaceAgentDataPath}
                initialResolveMode="data"
              />
            ) : (
              <div className="flex min-h-[120px] flex-1 items-center justify-center px-4 py-6 text-center text-[11px] leading-snug text-muted-foreground">
                {t('projectWorkspace.empty')}
              </div>
            )}
          </div>
        ) : null}
      </section>

      {/* ── Resize handle (invisible line) ── */}
      <WorkspaceRailResizeHandle
        ref={resizeHandleRef}
        disabled={folderCollapsed}
        dragging={isDraggingResize}
        onResizeStart={onResizePointerDown}
      />

      {/* ── Bottom sections: Prompt Stack + Capabilities ── */}
      <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {/* Prompt stack */}
          <div
            className={cn(
              'flex min-h-0 flex-col overflow-hidden border-t border-border/50',
              !promptCollapsed && 'flex-1',
            )}
          >
            <WorkspaceRailPanelHeader
              title={t('promptStack.title')}
              collapsed={promptCollapsed}
              onToggleCollapsed={() => setPromptCollapsed((v) => !v)}
              toggleTitle={promptCollapsed ? t('workspaceRail.expandSection') : t('workspaceRail.collapseSection')}
            />
            {!promptCollapsed ? (
              <div className="min-h-0 flex-1 overflow-hidden [overflow-anchor:none]" data-rail-panel-body="prompt">
                <AgentSessionPromptStack key={promptStackKey} items={promptStackItems} hideHeader />
              </div>
            ) : null}
          </div>

          {/* Capabilities */}
          <div
            className={cn(
              'flex flex-col overflow-hidden border-t border-border/50',
              promptCollapsed ? 'min-h-0 flex-1' : 'shrink-0',
            )}
          >
            <WorkspaceRailPanelHeader
              title={t('capabilities.title')}
              icon={<ListTodo className="h-3.5 w-3.5" aria-hidden />}
              collapsed={capCollapsed}
              onToggleCollapsed={() => setCapCollapsed((v) => !v)}
              toggleTitle={capCollapsed ? t('workspaceRail.expandSection') : t('workspaceRail.collapseSection')}
            />
            {!capCollapsed ? (
              <div
                className={cn(
                  'overflow-y-auto overscroll-contain px-1.5 pb-2 pt-1 [overflow-anchor:none]',
                  promptCollapsed ? 'min-h-0 flex-1' : 'max-h-[min(320px,42vh)]',
                )}
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
                          ariaLabel={
                            on
                              ? tCap('enabledAria', { label: item.label })
                              : tCap('disabledAria', { label: item.label })
                          }
                          onCheckedChange={(next) => patchCapability(item.capabilityKey, next)}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </section>
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
      onClick={() => {
        if (!disabled) onCheckedChange(!checked);
      }}
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
