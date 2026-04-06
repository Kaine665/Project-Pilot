'use client';

import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Blocks,
  BookOpen,
  Bot,
  FolderKanban,
  Layers,
  ListTodo,
  Store,
  Plug,
  ScrollText,
  Settings,
  Timer,
  Zap,
} from 'lucide-react';
import { useTranslations } from '@/client/i18n/use-translations';
import { useProject } from '@/components/project-context';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useRouter, usePathname } from '@/client/i18n/routing';
import { cn } from '@/lib/utils';

/** 迷你导览宽度（仅图标）。与 `w-10` 按钮同宽时：`px-4` → 左右各 16px，与 40px 图标合计 72px，避免 `px-2` 左贴右空。 */
const WIDTH_MINI_PX = 72;
/** 展开宽度（图标 + 文案），约为原 240 的 2/3，避免占用过宽 */
const WIDTH_EXPANDED_PX = 160;

/**
 * 左侧固定 40×40 图标槽 + 可选文案；迷你时仅收起文案（不占布局），图标相对侧栏左缘位置与展开一致，
 * 避免「居中 vs 左对齐」在宽度动画时产生漂移。
 */
function SidebarNavRow({
  mini,
  icon: Icon,
  label,
  tooltip,
  active,
  onClick,
}: {
  mini: boolean;
  icon: LucideIcon;
  label: string;
  tooltip: string;
  active: boolean;
  onClick: () => void;
}) {
  const button = (
    <button
      type="button"
      onClick={onClick}
      title={mini ? undefined : label}
      aria-label={label}
      className={cn(
        'flex h-10 items-center rounded-lg text-left text-sm font-medium transition-colors',
        mini ? 'w-10 shrink-0 gap-0' : 'w-full min-w-0 gap-2',
        active
          ? 'bg-zinc-900 text-white shadow-sm dark:bg-zinc-100 dark:text-zinc-900'
          : 'text-zinc-600 hover:bg-white hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200',
      )}
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center" aria-hidden>
        <Icon className="h-5 w-5 shrink-0" />
      </span>
      <span
        className={cn(
          'min-w-0 truncate transition-opacity duration-200 ease-out',
          mini ? 'w-0 shrink-0 overflow-hidden opacity-0' : 'flex-1 opacity-100',
        )}
      >
        {label}
      </span>
    </button>
  );

  if (mini) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent side="right">{tooltip}</TooltipContent>
      </Tooltip>
    );
  }

  return button;
}

function RailDivider() {
  return (
    <div
      className="my-1 w-full shrink-0 border-t border-zinc-200 dark:border-zinc-700"
      role="separator"
    />
  );
}

export interface WorkspaceSidebarRailProps {
  /** true = 迷你条；false = 展开带文字（折叠切换在顶栏，状态由 WorkspaceShell 持有） */
  mini: boolean;
  schedulesPageEnabled?: boolean;
  taskTriggersPageEnabled?: boolean;
}

export function WorkspaceSidebarRail({
  mini,
  schedulesPageEnabled = true,
  taskTriggersPageEnabled = true,
}: WorkspaceSidebarRailProps) {
  const { activeKey } = useProject();
  const router = useRouter();
  const pathname = usePathname();
  const tNav = useTranslations();
  const tr = useTranslations('workspaceSidebarRail');

  const isAgentsPage = pathname.startsWith('/workspace/agents');
  const isContextPage = pathname.startsWith('/workspace/context');
  const isDocsPage = pathname.startsWith('/workspace/docs');
  const isTodosPage = pathname.startsWith('/workspace/todos');
  const isTaskTriggersPage = pathname.startsWith('/workspace/task-triggers');
  const isSchedulesPage = pathname.startsWith('/workspace/schedules');
  const isChatPage = pathname.startsWith('/workspace/chat');
  const isSkillsPage = pathname.startsWith('/workspace/skills');
  const isPresetsPage = pathname.startsWith('/workspace/presets');
  const isCommunityPage = pathname.startsWith('/workspace/community');
  const isMcpPage = pathname.startsWith('/workspace/mcp');
  const isKnowledgePage = pathname.startsWith('/workspace/knowledge');
  const isPromptsPage = pathname.startsWith('/workspace/prompts');
  const isSettingsPage = pathname.startsWith('/workspace/settings');

  const isSubRoute =
    isAgentsPage ||
    isContextPage ||
    isDocsPage ||
    isTodosPage ||
    isTaskTriggersPage ||
    isSchedulesPage ||
    isChatPage ||
    isSkillsPage ||
    isPresetsPage ||
    isCommunityPage ||
    isMcpPage ||
    isKnowledgePage ||
    isPromptsPage ||
    isSettingsPage;

  const handleToggleProjects = () => {
    if (isSubRoute || !pathname.startsWith('/workspace/projects')) {
      router.push('/workspace/projects');
    }
  };

  const go = (path: string) => () => router.push(path);

  const settingsLabel = tNav('nav.settings');

  const scrollNav = (children: ReactNode) => (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden [-ms-overflow-style:none] [scrollbar-width:thin]">
      {children}
    </div>
  );

  return (
    <div
      data-sidebar
      data-state={mini ? 'mini' : 'expanded'}
      className={cn(
        'flex h-full shrink-0 overflow-hidden border-r border-zinc-200 bg-zinc-50/50 transition-[width] duration-200 ease-out dark:border-zinc-800 dark:bg-zinc-950',
      )}
      style={{ width: mini ? WIDTH_MINI_PX : WIDTH_EXPANDED_PX }}
    >
      <TooltipProvider delayDuration={mini ? 300 : 500} skipDelayDuration={0}>
        <div className="flex h-full min-w-0 flex-1 flex-col py-3">
          {scrollNav(
            <div className={cn('flex flex-col gap-2', mini ? 'px-4' : 'px-2')}>
              <SidebarNavRow
                mini={mini}
                icon={FolderKanban}
                label={tr('projects')}
                tooltip={tr('projects')}
                active={!isSubRoute}
                onClick={handleToggleProjects}
              />
              <SidebarNavRow
                mini={mini}
                icon={Bot}
                label={tr('agents')}
                tooltip={tr('agents')}
                active={isAgentsPage}
                onClick={go('/workspace/agents')}
              />
              <SidebarNavRow
                mini={mini}
                icon={Layers}
                label={tr('presets')}
                tooltip={tr('presets')}
                active={isPresetsPage}
                onClick={go('/workspace/presets')}
              />
              <RailDivider />
              <SidebarNavRow
                mini={mini}
                icon={BookOpen}
                label={tr('docs')}
                tooltip={tr('docs')}
                active={isContextPage || isDocsPage}
                onClick={() => router.push(activeKey ? `/workspace/docs/${activeKey}` : '/workspace/docs')}
              />
              <SidebarNavRow
                mini={mini}
                icon={Blocks}
                label={tr('skills')}
                tooltip={tr('skills')}
                active={isSkillsPage}
                onClick={go('/workspace/skills')}
              />
              <SidebarNavRow
                mini={mini}
                icon={Plug}
                label={tr('mcp')}
                tooltip={tr('mcp')}
                active={isMcpPage}
                onClick={go('/workspace/mcp')}
              />
              <SidebarNavRow
                mini={mini}
                icon={ScrollText}
                label={tr('prompts')}
                tooltip={tr('prompts')}
                active={isPromptsPage}
                onClick={go('/workspace/prompts')}
              />
              <RailDivider />
              <SidebarNavRow
                mini={mini}
                icon={ListTodo}
                label={tr('todos')}
                tooltip={tr('todos')}
                active={isTodosPage}
                onClick={go('/workspace/todos')}
              />
              {taskTriggersPageEnabled && (
                <SidebarNavRow
                  mini={mini}
                  icon={Zap}
                  label={tr('taskTriggers')}
                  tooltip={tr('taskTriggers')}
                  active={isTaskTriggersPage}
                  onClick={go('/workspace/task-triggers')}
                />
              )}
              {schedulesPageEnabled && (
                <SidebarNavRow
                  mini={mini}
                  icon={Timer}
                  label={tr('schedules')}
                  tooltip={tr('schedules')}
                  active={isSchedulesPage}
                  onClick={go('/workspace/schedules')}
                />
              )}
              <RailDivider />
              <SidebarNavRow
                mini={mini}
                icon={Store}
                label={tr('community')}
                tooltip={tr('community')}
                active={isCommunityPage}
                onClick={go('/workspace/community')}
              />
            </div>,
          )}

          <div
            className={cn(
              'shrink-0 pt-2',
              mini ? 'mt-auto px-4' : 'border-t border-zinc-200 px-2 dark:border-zinc-800',
            )}
          >
            <SidebarNavRow
              mini={mini}
              icon={Settings}
              label={settingsLabel}
              tooltip={settingsLabel}
              active={isSettingsPage}
              onClick={go('/workspace/settings')}
            />
          </div>
        </div>
      </TooltipProvider>
    </div>
  );
}
