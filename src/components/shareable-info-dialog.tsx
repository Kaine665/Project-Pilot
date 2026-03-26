'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from '@/client/i18n/use-translations';
import * as Dialog from '@radix-ui/react-dialog';
import { X, Share2, FileText, ListTree, Users, Layers, MessageSquare, Settings2, Check } from 'lucide-react';
import type { TreeItem } from '@/types/flow';

interface ShareableInfoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: TreeItem;
  rootItem: TreeItem;
  ancestors: TreeItem[];
}

type InfoSectionKey = 'task' | 'ancestors' | 'section' | 'siblings' | 'subTasks';

interface InfoConfig {
  task: boolean;
  ancestors: boolean;
  section: boolean;
  siblings: boolean;
  subTasks: boolean;
}

const STORAGE_KEY = 'pp:shareable-info-config';

const defaultConfig: InfoConfig = {
  task: true,
  ancestors: true,
  section: true,
  siblings: true,
  subTasks: true,
};

export function ShareableInfoDialog({
  open,
  onOpenChange,
  item,
  rootItem,
  ancestors,
}: ShareableInfoDialogProps) {
  const t = useTranslations();
  const [showConfig, setShowConfig] = useState(false);
  const [config, setConfig] = useState<InfoConfig>(defaultConfig);

  // Load config from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        setConfig({ ...defaultConfig, ...parsed });
      }
    } catch {
      // ignore
    }
  }, []);

  // Save config to localStorage
  const saveConfig = (newConfig: InfoConfig) => {
    setConfig(newConfig);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newConfig));
    } catch {
      // ignore
    }
  };

  const toggleSection = (key: InfoSectionKey) => {
    saveConfig({ ...config, [key]: !config[key] });
  };

  // Collect shareable information
  const shareableInfo = {
    task: {
      content: item.content,
      description: item.description,
      status: item.status,
    },
    ancestors: ancestors.map(a => ({
      content: a.content,
      description: a.description,
      status: a.status,
    })),
    section: {
      name: rootItem.content,
      description: rootItem.description,
    },
    siblings: ancestors.length > 0
      ? (ancestors[ancestors.length - 1].children || [])
          .filter(s => s.id !== item.id)
          .slice(0, 5)
          .map(s => ({ content: s.content, status: s.status }))
      : (rootItem.children ?? [])
          .filter(s => s.id !== item.id)
          .slice(0, 5)
          .map(s => ({ content: s.content, status: s.status })),
    subTasks: item.children?.map(c => ({
      content: c.content,
      status: c.status,
      description: c.description,
    })) || [],
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const copyAll = () => {
    const text = formatShareableInfo(shareableInfo, config, t);
    copyToClipboard(text);
  };

  const hasData = {
    task: true,
    ancestors: shareableInfo.ancestors.length > 0,
    section: true,
    siblings: shareableInfo.siblings.length > 0,
    subTasks: shareableInfo.subTasks.length > 0,
  };

  return (
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50" />
      <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg max-h-[80vh] bg-white dark:bg-zinc-900 rounded-xl shadow-2xl border border-zinc-200 dark:border-zinc-700 z-50 flex flex-col">
        {/* Hidden DialogTitle for accessibility */}
        <Dialog.Title className="sr-only">{t('flows.shareableInfo')}</Dialog.Title>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-200 dark:border-zinc-700">
          <div className="flex items-center gap-2.5">
            <Share2 className="h-5 w-5 text-emerald-500" />
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              {t('flows.shareableInfo')}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowConfig(!showConfig)}
              className={`p-1.5 rounded-md transition-colors ${
                showConfig
                  ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-zinc-100'
                  : 'text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300'
              }`}
              title={t('flows.configureInfo')}
            >
              <Settings2 className="h-4 w-4" />
            </button>
            <button
              onClick={copyAll}
              className="text-xs px-3 py-1.5 rounded-md bg-emerald-50 text-emerald-600 hover:bg-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-400 dark:hover:bg-emerald-950/50 transition-colors"
            >
              {t('flows.copyAll')}
            </button>
            <Dialog.Close asChild>
              <button className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 transition-colors dark:hover:bg-zinc-800 dark:hover:text-zinc-300">
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>
        </div>

        {/* Config Panel */}
        {showConfig && (
          <div className="px-5 py-3 border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50">
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-2">
              {t('flows.selectInfoToShow')}
            </p>
            <div className="flex flex-wrap gap-2">
              <ConfigCheckbox
                checked={config.task}
                onChange={() => toggleSection('task')}
                label={t('flows.currentTask')}
                disabled={true}
              />
              <ConfigCheckbox
                checked={config.ancestors}
                onChange={() => toggleSection('ancestors')}
                label={t('flows.ancestorPath')}
                disabled={!hasData.ancestors}
              />
              <ConfigCheckbox
                checked={config.section}
                onChange={() => toggleSection('section')}
                label={t('flows.sectionInfo')}
              />
              <ConfigCheckbox
                checked={config.siblings}
                onChange={() => toggleSection('siblings')}
                label={t('flows.siblingTasks')}
                disabled={!hasData.siblings}
              />
              <ConfigCheckbox
                checked={config.subTasks}
                onChange={() => toggleSection('subTasks')}
                label={t('flows.subTasks')}
                disabled={!hasData.subTasks}
              />
            </div>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Current Task - Always shown */}
          <InfoSectionCard icon={FileText} title={t('flows.currentTask')} color="emerald">
            <div className="space-y-1">
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                {shareableInfo.task.content}
              </p>
              {shareableInfo.task.description && (
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {shareableInfo.task.description}
                </p>
              )}
              <StatusBadge status={shareableInfo.task.status} />
            </div>
          </InfoSectionCard>

          {/* Ancestor Path */}
          {config.ancestors && shareableInfo.ancestors.length > 0 && (
            <InfoSectionCard icon={ListTree} title={t('flows.ancestorPath')} color="blue">
              <div className="space-y-1">
                {shareableInfo.ancestors.map((ancestor, idx) => (
                  <div
                    key={idx}
                    className="flex items-center gap-2 text-sm"
                    style={{ paddingLeft: `${idx * 12}px` }}
                  >
                    <span className="text-zinc-400">{idx === 0 ? '└' : '├'}</span>
                    <span className="text-zinc-700 dark:text-zinc-300">{ancestor.content}</span>
                  </div>
                ))}
              </div>
            </InfoSectionCard>
          )}

          {/* Section Info */}
          {config.section && (
            <InfoSectionCard icon={Layers} title={t('flows.sectionInfo')} color="amber">
              <div className="space-y-1">
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  {shareableInfo.section.name}
                </p>
                {shareableInfo.section.description && (
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    {shareableInfo.section.description}
                  </p>
                )}
              </div>
            </InfoSectionCard>
          )}

          {/* Sibling Tasks */}
          {config.siblings && shareableInfo.siblings.length > 0 && (
            <InfoSectionCard icon={Users} title={t('flows.siblingTasks')} color="violet">
              <div className="space-y-1">
                {shareableInfo.siblings.map((sibling, idx) => (
                  <div key={idx} className="flex items-center gap-2 text-sm">
                    <span className="text-zinc-400">•</span>
                    <span className="text-zinc-700 dark:text-zinc-300 truncate">{sibling.content}</span>
                    <StatusBadge status={sibling.status} compact />
                  </div>
                ))}
              </div>
            </InfoSectionCard>
          )}

          {/* Sub Tasks */}
          {config.subTasks && shareableInfo.subTasks.length > 0 && (
            <InfoSectionCard icon={MessageSquare} title={t('flows.subTasks')} color="rose">
              <div className="space-y-1">
                {shareableInfo.subTasks.map((sub, idx) => (
                  <div key={idx} className="flex items-start gap-2 text-sm">
                    <span className="text-zinc-400 mt-0.5">•</span>
                    <div className="flex-1 min-w-0">
                      <span className="text-zinc-700 dark:text-zinc-300">{sub.content}</span>
                      {sub.description && (
                        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                          {sub.description}
                        </p>
                      )}
                    </div>
                    <StatusBadge status={sub.status} compact />
                  </div>
                ))}
              </div>
            </InfoSectionCard>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 rounded-b-xl">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {t('flows.shareableInfoHint')}
          </p>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  );
}

// Config checkbox component
function ConfigCheckbox({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onChange}
      disabled={disabled}
      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs transition-colors ${
        disabled
          ? 'opacity-40 cursor-not-allowed text-zinc-400'
          : checked
          ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400'
          : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700'
      }`}
    >
      <span className={`w-3.5 h-3.5 rounded flex items-center justify-center ${
        checked ? 'bg-emerald-500 text-white' : 'bg-white dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600'
      }`}>
        {checked && <Check className="w-3 h-3" />}
      </span>
      {label}
    </button>
  );
}

// Info section card component
function InfoSectionCard({
  icon: Icon,
  title,
  color,
  children,
}: {
  icon: typeof FileText;
  title: string;
  color: 'emerald' | 'blue' | 'amber' | 'violet' | 'rose';
  children: React.ReactNode;
}) {
  const colorClasses = {
    emerald: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400',
    blue: 'bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-400',
    amber: 'bg-amber-50 text-amber-600 dark:bg-amber-950/30 dark:text-amber-400',
    violet: 'bg-violet-50 text-violet-600 dark:bg-violet-950/30 dark:text-violet-400',
    rose: 'bg-rose-50 text-rose-600 dark:bg-rose-950/30 dark:text-rose-400',
  };

  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden">
      <div className={`flex items-center gap-2 px-3 py-2 ${colorClasses[color]}`}>
        <Icon className="h-4 w-4" />
        <span className="text-xs font-medium">{title}</span>
      </div>
      <div className="p-3 bg-white dark:bg-zinc-900">
        {children}
      </div>
    </div>
  );
}

function StatusBadge({ status, compact }: { status: string; compact?: boolean }) {
  const statusClasses: Record<string, string> = {
    done: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400',
    doing: 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400',
    todo: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
  };

  const statusLabels: Record<string, string> = {
    done: '已完成',
    doing: '进行中',
    todo: '待办',
  };

  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${statusClasses[status] || statusClasses.todo} ${compact ? '' : 'mt-1'}`}>
      {statusLabels[status] || status}
    </span>
  );
}

// Format shareable info as text for clipboard
function formatShareableInfo(
  info: ReturnType<typeof collectShareableInfo>,
  config: InfoConfig,
  t: ReturnType<typeof useTranslations>
): string {
  const lines: string[] = [];

  // Always include task
  lines.push(`# ${info.task.content}`);
  lines.push('');

  if (info.task.description) {
    lines.push(info.task.description);
    lines.push('');
  }

  if (config.ancestors && info.ancestors.length > 0) {
    lines.push('## 上级任务');
    info.ancestors.forEach((a, i) => {
      lines.push(`${'  '.repeat(i)}- ${a.content}`);
    });
    lines.push('');
  }

  if (config.section) {
    lines.push(`## 所属板块: ${info.section.name}`);
    lines.push('');
  }

  if (config.siblings && info.siblings.length > 0) {
    lines.push('## 相关任务');
    info.siblings.forEach(s => {
      lines.push(`- ${s.content}`);
    });
    lines.push('');
  }

  if (config.subTasks && info.subTasks.length > 0) {
    lines.push('## 子任务');
    info.subTasks.forEach(st => {
      lines.push(`- ${st.content}`);
      if (st.description) {
        lines.push(`  ${st.description}`);
      }
    });
  }

  return lines.join('\n');
}

// Helper to collect shareable info
function collectShareableInfo(item: TreeItem, rootItem: TreeItem, ancestors: TreeItem[]) {
  return {
    task: {
      content: item.content,
      description: item.description,
      status: item.status,
    },
    ancestors: ancestors.map(a => ({
      content: a.content,
      description: a.description,
      status: a.status,
    })),
    section: {
      name: rootItem.content,
      description: rootItem.description,
    },
    siblings: ancestors.length > 0
      ? (ancestors[ancestors.length - 1].children || [])
          .filter(s => s.id !== item.id)
          .slice(0, 5)
          .map(s => ({ content: s.content, status: s.status }))
      : (rootItem.children ?? [])
          .filter(s => s.id !== item.id)
          .slice(0, 5)
          .map(s => ({ content: s.content, status: s.status })),
    subTasks: item.children?.map(c => ({
      content: c.content,
      status: c.status,
      description: c.description,
    })) || [],
  };
}
