'use client';

import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useTranslations } from '@/client/i18n/use-translations';
import type { LucideIcon } from 'lucide-react';
import { Folder, FolderOpen, Layers, ListTodo } from 'lucide-react';
import { FolderExplorerPanel } from '@/components/folder-explorer-panel';
import { AgentSessionPromptStack, type PromptStackSeedItem } from '@/components/agent-session-prompt-stack';
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

  const [activeTab, setActiveTab] = useState(readStoredActiveTab);

  const setTab = useCallback((idx: number) => {
    setActiveTab(idx);
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

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col overflow-hidden [overflow-anchor:none]', className)}>
      <div
        role="tablist"
        aria-label={t('workspaceRail.tablistAria')}
        className="flex h-9 shrink-0 items-stretch gap-0.5 overflow-x-auto border-b border-border/80 bg-muted/35 px-1.5 pt-1 [-ms-overflow-style:none] [scrollbar-width:none] dark:bg-muted/25 [&::-webkit-scrollbar]:hidden"
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
              aria-controls={`agents-rail-panel-${i}`}
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

      <div
        role="tabpanel"
        id={`agents-rail-panel-${activeTab}`}
        aria-labelledby={`agents-rail-tab-${activeTab}`}
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      >
        {renderActivePanel()}
      </div>
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
