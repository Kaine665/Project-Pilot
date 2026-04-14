'use client';

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useTranslations } from '@/client/i18n/use-translations';
import { useRouter } from '@/client/i18n/routing';
import {
  Archive,
  ChevronDown,
  Copy,
  ExternalLink,
  FolderKanban,
  FolderOpen,
  FolderPlus,
  GitBranch,
  Globe,
  Search,
  TerminalSquare,
  Trash2,
} from 'lucide-react';
import { useProject } from '@/components/project-context';
import { ProjectSettings } from '@/components/project-settings';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { hasElectronFolderPicker, canPickFolder, pickLocalFolderPath } from '@/lib/electron-folder-picker';
import {
  DEFAULT_PLACEHOLDER_PROJECT_KEY,
  isReservedDefaultProjectKey,
  projectDisplayName,
  projectDisplaySubtitle,
} from '@/lib/default-project';
import type { ProjectEntry, ProjectLocation } from '@/types';

const LOCATION_OPTIONS: { value: ProjectLocation; labelKey: string }[] = [
  { value: 'local', labelKey: 'locationLocal' },
  { value: 'github', labelKey: 'locationGithub' },
  { value: 'gitee', labelKey: 'locationGitee' },
  { value: 'cloud-server', labelKey: 'locationCloudServer' },
  { value: 'hybrid', labelKey: 'locationHybrid' },
];

const ACTIVE_RECENT_DAYS = 45;

type StatusFilter = 'all' | 'active' | 'archived';

function makeProjectKey(name: string, existingKeys: string[]) {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || `project-${Date.now()}`;

  const taken = new Set([DEFAULT_PLACEHOLDER_PROJECT_KEY, ...existingKeys]);
  let next = base;
  let index = 2;
  while (taken.has(next)) {
    next = `${base}-${index}`;
    index += 1;
  }
  return next;
}

function isActiveRecent(project: ProjectEntry) {
  if (!project.updatedAt) return true;
  const t = new Date(project.updatedAt).getTime();
  return Date.now() - t < ACTIVE_RECENT_DAYS * 86400000;
}

function rowDotStyle(project: ProjectEntry): CSSProperties {
  const color = project.color?.trim();
  if (color) {
    return { backgroundColor: color, boxShadow: `0 0 8px ${color}66` };
  }
  let h = 0;
  for (let i = 0; i < project.key.length; i += 1) {
    h = project.key.charCodeAt(i) + ((h << 5) - h);
  }
  const hue = Math.abs(h) % 360;
  return { backgroundColor: `hsl(${hue} 58% 52%)` };
}

function domainLabel(project: ProjectEntry, t: (k: string) => string) {
  if (project.location) {
    const loc = LOCATION_OPTIONS.find(o => o.value === project.location);
    return loc ? t(loc.labelKey) : t('locationLocal');
  }
  return t('locationLocal');
}

/** 右侧详情：除「概览 / 工作区」外的区块，仅在有数据时展示 */
function hasRepoRunInfo(p: ProjectEntry) {
  return Boolean(
    p.repository?.url?.trim() ||
      p.devServer?.url?.trim() ||
      p.devServer?.command?.trim() ||
      p.repository?.defaultBranch?.trim(),
  );
}

export function ProjectsManagementHub() {
  const { projects, activeKey, setActiveKey, fetchProjects } = useProject();
  const router = useRouter();
  const t = useTranslations('projects');
  const tActions = useTranslations('actions');
  const tStatus = useTranslations('status');

  const soleBuiltInPlaceholder = useMemo(() => {
    const act = projects.filter(p => !p.archived);
    return act.length === 1 && isReservedDefaultProjectKey(act[0].key);
  }, [projects]);

  const [searchText, setSearchText] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [archivedEntries, setArchivedEntries] = useState<ProjectEntry[]>([]);
  const [archivedLoading, setArchivedLoading] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [confirmingDeleteKey, setConfirmingDeleteKey] = useState<string | null>(null);
  const [formName, setFormName] = useState('');
  const [formPath, setFormPath] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formLocation, setFormLocation] = useState<ProjectLocation>('local');
  const [formRepoUrl, setFormRepoUrl] = useState('');
  const [formRepoBranch, setFormRepoBranch] = useState('');
  const [formSshKey, setFormSshKey] = useState('');
  const [pathCopied, setPathCopied] = useState(false);

  const handleCreateDialogOpenChange = useCallback((open: boolean) => {
    setCreateOpen(open);
    if (!open) {
      setFormName('');
      setFormPath('');
      setFormDescription('');
      setFormLocation('local');
      setFormRepoUrl('');
      setFormRepoBranch('');
      setFormSshKey('');
    }
  }, []);

  const handlePickLocalFolder = useCallback(async () => {
    console.log('[pick-folder] button clicked, canPick:', hasElectronFolderPicker());
    const picked = await pickLocalFolderPath();
    if (picked) setFormPath(picked);
  }, []);

  useEffect(() => {
    if (statusFilter !== 'archived') return;
    let cancelled = false;
    setArchivedLoading(true);
    fetch('/api/data/projects?includeArchived=true')
      .then(r => (r.ok ? r.json() : { projects: [] }))
      .then((d: { projects?: ProjectEntry[] }) => {
        if (cancelled) return;
        setArchivedEntries((d.projects ?? []).filter(p => p.archived));
      })
      .catch(() => {
        if (!cancelled) setArchivedEntries([]);
      })
      .finally(() => {
        if (!cancelled) setArchivedLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [statusFilter]);

  const statusSourced = useMemo(() => {
    if (statusFilter === 'archived') return archivedEntries;
    if (statusFilter === 'active') return projects.filter(p => isActiveRecent(p));
    return projects;
  }, [statusFilter, archivedEntries, projects]);

  const filteredProjects = useMemo(() => {
    const keyword = searchText.trim().toLowerCase();
    return statusSourced.filter(project => {
      return (
        keyword.length === 0 ||
        project.name.toLowerCase().includes(keyword) ||
        project.key.toLowerCase().includes(keyword) ||
        project.path?.toLowerCase().includes(keyword) ||
        project.repository?.url?.toLowerCase().includes(keyword) ||
        project.tags?.some(tag => tag.toLowerCase().includes(keyword))
      );
    });
  }, [statusSourced, searchText]);

  useEffect(() => {
    if (filteredProjects.length === 0) return;
    const valid = activeKey && filteredProjects.some(p => p.key === activeKey);
    if (!valid) {
      setActiveKey(filteredProjects[0].key);
    }
  }, [filteredProjects, activeKey, setActiveKey]);

  useEffect(() => {
    setPathCopied(false);
  }, [activeKey]);

  const activeProject =
    filteredProjects.find(p => p.key === activeKey) ??
    filteredProjects[0] ??
    null;

  const lockBuiltInArchive = useMemo(() => {
    if (!activeProject || activeProject.archived) return false;
    return soleBuiltInPlaceholder && isReservedDefaultProjectKey(activeProject.key);
  }, [activeProject, soleBuiltInPlaceholder]);

  const refreshProjects = useCallback(async () => {
    return fetchProjects();
  }, [fetchProjects]);

  const handleProjectUpdated = useCallback(async () => {
    await refreshProjects();
    if (statusFilter === 'archived') {
      const r = await fetch('/api/data/projects?includeArchived=true');
      const d = r.ok ? await r.json() : { projects: [] };
      setArchivedEntries((d.projects ?? []).filter((p: ProjectEntry) => p.archived));
    }
  }, [refreshProjects, statusFilter]);

  const handleProjectDeleted = useCallback(
    async (deletedKey?: string) => {
      const list = await refreshProjects();
      if (statusFilter === 'archived') {
        const r = await fetch('/api/data/projects?includeArchived=true');
        const d = r.ok ? await r.json() : { projects: [] };
        setArchivedEntries((d.projects ?? []).filter((p: ProjectEntry) => p.archived));
      }
      if (deletedKey && activeKey !== deletedKey) {
        return;
      }
      if (list.length > 0) {
        setActiveKey(list[0].key);
      } else {
        setActiveKey('');
      }
    },
    [activeKey, refreshProjects, setActiveKey, statusFilter],
  );

  const resetCreateForm = useCallback(() => {
    setFormName('');
    setFormPath('');
    setFormDescription('');
    setFormLocation('local');
    setFormRepoUrl('');
    setFormRepoBranch('');
    setFormSshKey('');
    setCreateOpen(false);
  }, []);

  const createFormValid = useMemo(() => {
    const nameOk = formName.trim().length > 0;
    if (!nameOk) return false;
    const loc = formLocation;
    const pathOk = formPath.trim().length > 0;
    const repoOk = formRepoUrl.trim().length > 0;
    switch (loc) {
      case 'local':
      case 'cloud-server':
        return pathOk;
      case 'github':
      case 'gitee':
        return repoOk;
      case 'hybrid':
        return pathOk && repoOk;
      default:
        return pathOk;
    }
  }, [formLocation, formName, formPath, formRepoUrl]);

  const handleCreateProject = useCallback(async () => {
    if (!createFormValid) return;
    const name = formName.trim();
    const path = formPath.trim();
    const loc = formLocation;

    setCreating(true);
    try {
      const key = makeProjectKey(
        name,
        projects.map(project => project.key),
      );

      const body: Record<string, unknown> = {
        key,
        name,
        location: loc,
        description: formDescription.trim() || undefined,
      };

      if (path) body.path = path;

      if (loc === 'github' || loc === 'gitee' || loc === 'hybrid') {
        const url = formRepoUrl.trim();
        if (url) {
          const provider = loc === 'gitee' ? 'gitee' : 'github';
          body.repository = {
            url,
            defaultBranch: formRepoBranch.trim() || undefined,
            provider,
          };
        }
      }

      if ((loc === 'cloud-server' || loc === 'hybrid') && formSshKey.trim()) {
        body.access = { sshKey: formSshKey.trim() };
      }

      const res = await fetch('/api/data/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) return;

      await refreshProjects();
      setActiveKey(key);
      setStatusFilter('all');
      resetCreateForm();
    } finally {
      setCreating(false);
    }
  }, [
    createFormValid,
    formDescription,
    formLocation,
    formName,
    formPath,
    formRepoBranch,
    formRepoUrl,
    formSshKey,
    projects,
    refreshProjects,
    resetCreateForm,
    setActiveKey,
  ]);

  const handleArchiveProject = useCallback(
    async (projectKey: string) => {
      const res = await fetch('/api/data/projects', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: projectKey }),
      });

      if (!res.ok) return;
      setConfirmingDeleteKey(null);
      await handleProjectDeleted(projectKey);
    },
    [handleProjectDeleted],
  );

  const copyWorkspacePath = useCallback(async (path: string) => {
    try {
      await navigator.clipboard.writeText(path);
      setPathCopied(true);
      window.setTimeout(() => setPathCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }, []);

  const chipBtn = (active: boolean) =>
    active
      ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
      : 'border border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-800/50';

  const emptyCreateBlock = (
    <Card className="rounded-2xl border-dashed border-zinc-300 bg-zinc-50/70 dark:border-zinc-700 dark:bg-zinc-900/40">
      <CardContent className="flex flex-col items-center gap-3 px-6 py-16 text-center">
        <div className="rounded-full bg-white p-4 shadow-sm dark:bg-zinc-950">
          <FolderKanban className="h-7 w-7 text-zinc-500" />
        </div>
        <div className="space-y-2">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            {projects.length > 0 || statusSourced.length > 0
              ? t('emptyStateTitleFiltered')
              : t('emptyStateTitleNoRegistered')}
          </h2>
          <p className="max-w-md text-sm leading-6 text-zinc-500 dark:text-zinc-400">
            {projects.length > 0 || statusSourced.length > 0
              ? t('emptyStateDescriptionFiltered')
              : t('emptyStateDescriptionNoRegistered')}
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="mt-2 rounded-xl">
          <FolderPlus className="h-4 w-4" />
          {t('createProject')}
        </Button>
      </CardContent>
    </Card>
  );

  return (
    <Dialog.Root modal={false} open={createOpen} onOpenChange={handleCreateDialogOpenChange}>
      <div className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-zinc-50/30 dark:bg-zinc-950">
        <Dialog.Portal>
          {/*
            modal={false}：避免 Radix 模态层拦截 onFocusOutside，否则 Electron 系统选文件夹对话框无法获得焦点（表现为按钮无反应）。
            遮罩改用手动层，点击关闭行为与原先一致。
          */}
          <button
            type="button"
            className="fixed inset-0 z-40 cursor-default border-0 bg-black/50 p-0"
            aria-label={tActions('close')}
            onClick={() => handleCreateDialogOpenChange(false)}
          />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex w-[min(92vw,560px)] -translate-x-1/2 -translate-y-1/2 flex-col gap-5 rounded-[24px] border border-zinc-200 bg-white p-6 shadow-2xl dark:border-zinc-800 dark:bg-zinc-950">
            <div className="space-y-2">
              <Dialog.Title className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">
                {t('createDialogTitle')}
              </Dialog.Title>
              <Dialog.Description className="text-sm leading-6 text-zinc-500 dark:text-zinc-400">
                {t('createDialogDescription')}
              </Dialog.Description>
            </div>

            <div className="grid gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('projectName')}</label>
                <Input value={formName} onChange={e => setFormName(e.target.value)} />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('location')}</label>
                <Select
                  value={formLocation}
                  onChange={v => setFormLocation((v || 'local') as ProjectLocation)}
                  options={LOCATION_OPTIONS.map(option => ({
                    value: option.value,
                    label: t(option.labelKey),
                  }))}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('projectDescription')}</label>
                <Textarea
                  rows={3}
                  value={formDescription}
                  onChange={e => setFormDescription(e.target.value)}
                  placeholder={t('projectDescriptionPlaceholder')}
                  className="resize-none"
                />
              </div>

              <div className="space-y-3 rounded-xl border border-zinc-200 bg-zinc-50/60 p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
                <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">{t('locationPathsSection')}</p>

                {formLocation === 'local' && (
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('createLocalPathLabel')}</label>
                    <div className="flex gap-2">
                      <Input
                        className="min-w-0 flex-1 font-mono text-sm"
                        value={formPath}
                        onChange={e => setFormPath(e.target.value)}
                        placeholder={t('projectPathPlaceholder')}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        className="h-9 shrink-0 gap-1.5 px-3"
                        disabled={!canPickFolder()}
                        title={t('browseFolder')}
                        onClick={handlePickLocalFolder}
                      >
                        <FolderOpen className="h-4 w-4" />
                        {t('browseFolder')}
                      </Button>
                    </div>
                    <p className="text-xs leading-5 text-zinc-500 dark:text-zinc-400">{t('createLocalPathHint')}</p>
                  </div>
                )}

                {(formLocation === 'github' || formLocation === 'gitee') && (
                  <div className="grid gap-3">
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                        {t('repoUrl')} <span className="text-red-500">*</span>
                      </label>
                      <Input
                        value={formRepoUrl}
                        onChange={e => setFormRepoUrl(e.target.value)}
                        placeholder={t('repoUrlPlaceholder')}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('defaultBranch')}</label>
                      <Input
                        value={formRepoBranch}
                        onChange={e => setFormRepoBranch(e.target.value)}
                        placeholder={t('defaultBranchPlaceholder')}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('createClonePathLabel')}</label>
                      <div className="flex gap-2">
                        <Input
                          className="min-w-0 flex-1 font-mono text-sm"
                          value={formPath}
                          onChange={e => setFormPath(e.target.value)}
                          placeholder={t('projectPathPlaceholder')}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          className="h-9 shrink-0 gap-1.5 px-3"
                          disabled={!canPickFolder()}
                          title={t('browseFolder')}
                          onClick={handlePickLocalFolder}
                        >
                          <FolderOpen className="h-4 w-4" />
                          {t('browseFolder')}
                        </Button>
                      </div>
                      <p className="text-xs leading-5 text-zinc-500 dark:text-zinc-400">{t('createClonePathHint')}</p>
                    </div>
                  </div>
                )}

                {formLocation === 'cloud-server' && (
                  <div className="grid gap-3">
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                        {t('createCloudPathLabel')} <span className="text-red-500">*</span>
                      </label>
                      <div className="flex gap-2">
                        <Input
                          className="min-w-0 flex-1 font-mono text-sm"
                          value={formPath}
                          onChange={e => setFormPath(e.target.value)}
                          placeholder={t('createCloudPathPlaceholder')}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          className="h-9 shrink-0 gap-1.5 px-3"
                          disabled={!canPickFolder()}
                          title={t('browseFolder')}
                          onClick={handlePickLocalFolder}
                        >
                          <FolderOpen className="h-4 w-4" />
                          {t('browseFolder')}
                        </Button>
                      </div>
                      <p className="text-xs leading-5 text-zinc-500 dark:text-zinc-400">{t('createCloudPathHint')}</p>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('createSshKeyOptionalLabel')}</label>
                      <Input
                        value={formSshKey}
                        onChange={e => setFormSshKey(e.target.value)}
                        placeholder={t('sshKeyPlaceholder')}
                      />
                    </div>
                  </div>
                )}

                {formLocation === 'hybrid' && (
                  <div className="grid gap-3">
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                        {t('repoUrl')} <span className="text-red-500">*</span>
                      </label>
                      <Input
                        value={formRepoUrl}
                        onChange={e => setFormRepoUrl(e.target.value)}
                        placeholder={t('repoUrlPlaceholder')}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('defaultBranch')}</label>
                      <Input
                        value={formRepoBranch}
                        onChange={e => setFormRepoBranch(e.target.value)}
                        placeholder={t('defaultBranchPlaceholder')}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                        {t('createHybridLocalPathLabel')} <span className="text-red-500">*</span>
                      </label>
                      <div className="flex gap-2">
                        <Input
                          className="min-w-0 flex-1 font-mono text-sm"
                          value={formPath}
                          onChange={e => setFormPath(e.target.value)}
                          placeholder={t('projectPathPlaceholder')}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          className="h-9 shrink-0 gap-1.5 px-3"
                          disabled={!canPickFolder()}
                          title={t('browseFolder')}
                          onClick={handlePickLocalFolder}
                        >
                          <FolderOpen className="h-4 w-4" />
                          {t('browseFolder')}
                        </Button>
                      </div>
                      <p className="text-xs leading-5 text-zinc-500 dark:text-zinc-400">{t('createHybridLocalPathHint')}</p>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('createSshKeyOptionalLabel')}</label>
                      <Input
                        value={formSshKey}
                        onChange={e => setFormSshKey(e.target.value)}
                        placeholder={t('sshKeyPlaceholder')}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-3">
              <Dialog.Close asChild>
                <Button variant="outline" className="rounded-xl">
                  {tActions('cancel')}
                </Button>
              </Dialog.Close>
              <Button
                onClick={handleCreateProject}
                disabled={creating || !createFormValid}
                className="rounded-xl"
              >
                {creating ? t('creatingProject') : t('createProject')}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>

      {projects.length === 0 && statusFilter !== 'archived' ? (
        <div className="flex flex-1 flex-col gap-6 overflow-auto p-6 md:p-8">
          <header className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-1 text-[11px] font-medium text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400">
              <FolderKanban className="h-3.5 w-3.5" />
              {t('managerBadge')}
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50 md:text-3xl">
              {t('managerTitle')}
            </h1>
            <p className="max-w-2xl text-sm leading-6 text-zinc-500 dark:text-zinc-400">{t('managerSubtitle')}</p>
          </header>
          {emptyCreateBlock}
        </div>
      ) : filteredProjects.length === 0 ? (
        <div className="flex flex-1 flex-col gap-4 overflow-auto p-4 md:flex-row md:gap-0 md:p-0">
          <aside className="flex w-full shrink-0 flex-col border-zinc-200 dark:border-zinc-800 md:w-[min(100%,320px)] md:border-r md:bg-zinc-50/40 dark:md:bg-zinc-900/20">
            <div className="p-4">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                <Input
                  value={searchText}
                  onChange={e => setSearchText(e.target.value)}
                  placeholder={t('searchPlaceholder')}
                  className="h-9 rounded-lg border-zinc-200 bg-white pl-9 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                />
              </div>
            </div>
            <div className="flex gap-2 overflow-x-auto border-b border-zinc-200 px-4 pb-3 dark:border-zinc-800">
              {(['all', 'active', 'archived'] as const).map(key => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setStatusFilter(key)}
                  className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium transition-colors ${chipBtn(statusFilter === key)}`}
                >
                  {key === 'all' ? t('filterChipAll') : key === 'active' ? t('filterChipActive') : t('filterChipArchived')}
                </button>
              ))}
            </div>
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-zinc-500">
              {statusFilter === 'archived' && archivedLoading ? (
                <span>{t('loading')}</span>
              ) : (
                <>
                  <p>{t('emptyStateTitleFiltered')}</p>
                  <Button size="sm" className="rounded-lg" onClick={() => setCreateOpen(true)}>
                    <FolderPlus className="h-4 w-4" />
                    {t('createProject')}
                  </Button>
                </>
              )}
            </div>
          </aside>
          <div className="flex flex-1 items-center justify-center p-8 text-zinc-400">{t('masterDetailHint')}</div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          {/* Master list */}
          <aside className="flex max-h-[42vh] w-full shrink-0 flex-col border-zinc-200 dark:border-zinc-800 md:max-h-none md:h-full md:w-[min(100%,320px)] md:border-r md:bg-zinc-50/40 dark:md:bg-zinc-900/20">
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-zinc-200 p-3 dark:border-zinc-800 md:p-4">
              <p className="hidden text-[11px] text-zinc-400 md:block">{t('masterDetailHint')}</p>
              <Button size="sm" className="shrink-0 rounded-lg text-xs md:text-sm" onClick={() => setCreateOpen(true)}>
                <FolderPlus className="h-4 w-4" />
                {t('createProject')}
              </Button>
            </div>
            <div className="shrink-0 p-3 pt-2 md:p-4 md:pt-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                <Input
                  value={searchText}
                  onChange={e => setSearchText(e.target.value)}
                  placeholder={t('searchPlaceholder')}
                  className="h-9 rounded-lg border-zinc-200 bg-white pl-9 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                />
              </div>
            </div>
            <div className="flex shrink-0 gap-2 overflow-x-auto border-b border-zinc-200 px-3 pb-3 dark:border-zinc-800 md:px-4">
              {(['all', 'active', 'archived'] as const).map(key => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setStatusFilter(key)}
                  className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium transition-colors ${chipBtn(statusFilter === key)}`}
                >
                  {key === 'all' ? t('filterChipAll') : key === 'active' ? t('filterChipActive') : t('filterChipArchived')}
                </button>
              ))}
            </div>
            <div className="custom-scroll min-h-0 flex-1 overflow-y-auto py-2 [scrollbar-width:thin]">
              {filteredProjects.map(project => {
                const selected = project.key === activeKey;
                return (
                  <button
                    key={project.key}
                    type="button"
                    onClick={() => setActiveKey(project.key)}
                    className={`mx-2 mb-1 flex w-[calc(100%-1rem)] cursor-pointer items-start gap-3 rounded-xl p-3 text-left transition-colors ${
                      selected
                        ? 'bg-white shadow-sm ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-700'
                        : 'hover:bg-zinc-100/80 dark:hover:bg-zinc-800/50'
                    }`}
                  >
                    <div
                      className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                      style={rowDotStyle(project)}
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <h4 className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                          {projectDisplayName(project, t('defaultWorkspaceName'))}
                        </h4>
                        <span className="shrink-0 rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                          {domainLabel(project, t)}
                        </span>
                      </div>
                      <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                        {projectDisplaySubtitle(project, t('defaultWorkspaceDescription'))}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </aside>

          {/* Detail */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-white dark:bg-zinc-950">
            {activeProject ? (
              <>
                <div className="custom-scroll min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin]">
                  <div className="mx-auto max-w-4xl p-5 md:p-8">
                    <div className="mb-6 flex flex-col gap-4 md:mb-8 md:flex-row md:items-start md:justify-between">
                      <div className="space-y-2">
                        <h2 className="text-2xl font-bold tracking-tight text-zinc-950 dark:text-zinc-50 md:text-3xl">
                          {projectDisplayName(activeProject, t('defaultWorkspaceName'))}
                        </h2>
                        <div className="flex flex-wrap gap-2">
                          {activeProject.location && (
                            <Badge variant="outline" className="rounded-full text-xs font-medium">
                              {t(LOCATION_OPTIONS.find(o => o.value === activeProject.location)?.labelKey ?? 'locationLocal')}
                            </Badge>
                          )}
                          {isActiveRecent(activeProject) && !activeProject.archived && (
                            <Badge className="rounded-full border-0 bg-blue-50 text-xs font-medium text-blue-600 dark:bg-blue-950/40 dark:text-blue-400">
                              {t('statusActive')}
                            </Badge>
                          )}
                          {activeProject.archived && (
                            <Badge variant="secondary" className="rounded-full text-xs">
                              {tStatus('archived')}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>

                    <section className="mb-8 space-y-3 md:mb-10">
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">{t('detailOverview')}</h3>
                      <div className="rounded-2xl bg-zinc-50/80 p-4 ring-1 ring-zinc-200 dark:bg-zinc-900/40 dark:ring-zinc-800 md:p-5">
                        <p className="text-sm leading-7 text-zinc-600 dark:text-zinc-400">
                          {isReservedDefaultProjectKey(activeProject.key) || activeProject.systemPlaceholder
                            ? t('defaultWorkspaceDescription')
                            : activeProject.description?.trim() || t('noDescription')}
                        </p>
                      </div>
                    </section>

                    <section className="mb-8 space-y-3 md:mb-10">
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">{t('detailWorkspace')}</h3>
                      <div className="flex items-center gap-3 rounded-xl border border-dashed border-zinc-200 p-3 dark:border-zinc-800 md:p-4">
                        <FolderKanban className="h-5 w-5 shrink-0 text-zinc-400" />
                        <code className="min-w-0 flex-1 truncate font-mono text-xs text-zinc-600 dark:text-zinc-300">
                          {activeProject.path || '—'}
                        </code>
                        {activeProject.path ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 shrink-0 p-0 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
                            title={tActions('copy')}
                            onClick={() => copyWorkspacePath(activeProject.path!)}
                          >
                            <Copy className="h-4 w-4" />
                          </Button>
                        ) : null}
                      </div>
                      {pathCopied ? (
                        <p className="text-xs text-zinc-500">{t('pathCopySuccess')}</p>
                      ) : null}
                    </section>

                    {hasRepoRunInfo(activeProject) ? (
                      <section className="mb-8 md:mb-10">
                        <details className="group" open>
                          <summary className="flex cursor-pointer list-none items-center justify-between py-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                            <span>{t('detailRepoRun')}</span>
                            <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" />
                          </summary>
                          <div className="mt-3 grid gap-4 md:grid-cols-2">
                            {activeProject.repository?.url?.trim() ? (
                              <div className="space-y-2">
                                <div className="text-[11px] font-medium text-zinc-400">{t('repositoryInfo')}</div>
                                <div className="flex items-center gap-2 rounded-lg bg-zinc-50 px-3 py-2 dark:bg-zinc-900">
                                  <GitBranch className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
                                  <span className="truncate text-xs text-zinc-600 dark:text-zinc-300">
                                    {activeProject.repository.url}
                                  </span>
                                </div>
                              </div>
                            ) : null}
                            {activeProject.devServer?.url?.trim() ? (
                              <div className="space-y-2">
                                <div className="text-[11px] font-medium text-zinc-400">{t('webUrl')}</div>
                                <div className="flex items-center gap-2 rounded-lg bg-zinc-50 px-3 py-2 dark:bg-zinc-900">
                                  <Globe className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
                                  <span className="truncate text-xs text-zinc-600 dark:text-zinc-300">
                                    {activeProject.devServer.url}
                                  </span>
                                </div>
                              </div>
                            ) : null}
                            {activeProject.devServer?.command?.trim() || activeProject.repository?.defaultBranch?.trim() ? (
                              <div className="space-y-2 md:col-span-2">
                                <div className="text-[11px] font-medium text-zinc-400">{t('devEnvironment')}</div>
                                <div className="flex items-center gap-2 rounded-lg bg-zinc-50 px-3 py-2 dark:bg-zinc-900">
                                  <TerminalSquare className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
                                  <span className="truncate font-mono text-xs text-zinc-600 dark:text-zinc-300">
                                    {activeProject.devServer?.command?.trim() ||
                                      activeProject.repository?.defaultBranch?.trim() ||
                                      ''}
                                  </span>
                                </div>
                              </div>
                            ) : null}
                          </div>
                        </details>
                      </section>
                    ) : null}
                  </div>
                </div>

                <div className="shrink-0 border-t border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950 md:p-4">
                  {confirmingDeleteKey === activeProject.key ? (
                    <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm dark:border-red-900/50 dark:bg-red-950/20">
                      <div className="text-red-700 dark:text-red-300">
                        {t('cardDeleteConfirm', {
                          name: projectDisplayName(activeProject, t('defaultWorkspaceName')),
                        })}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button
                          variant="destructive"
                          size="sm"
                          className="rounded-lg"
                          onClick={() => handleArchiveProject(activeProject.key)}
                        >
                          {tActions('delete')}
                        </Button>
                        <Button variant="outline" size="sm" className="rounded-lg" onClick={() => setConfirmingDeleteKey(null)}>
                          {tActions('cancel')}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          className="rounded-lg"
                          onClick={() => {
                            setActiveKey(activeProject.key);
                            router.push('/workspace/agents');
                          }}
                        >
                          <ExternalLink className="h-4 w-4" />
                          {t('openProject')}
                        </Button>
                        <div className="hidden h-6 w-px bg-zinc-200 sm:block dark:bg-zinc-800" />
                        <ProjectSettings
                          projectKey={activeProject.key}
                          projectName={projectDisplayName(activeProject, t('defaultWorkspaceName'))}
                          projectDescription={activeProject.description}
                          projectEntry={activeProject}
                          onUpdated={handleProjectUpdated}
                          onDeleted={() => handleProjectDeleted(activeProject.key)}
                        />
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          variant="outline"
                          className="rounded-lg"
                          disabled={lockBuiltInArchive}
                          title={lockBuiltInArchive ? t('defaultWorkspaceArchiveLockedHint') : undefined}
                          onClick={() => handleArchiveProject(activeProject.key)}
                        >
                          <Archive className="h-4 w-4" />
                          {tActions('archive')}
                        </Button>
                        <Button
                          variant="ghost"
                          className="rounded-lg text-red-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30"
                          disabled={lockBuiltInArchive}
                          title={lockBuiltInArchive ? t('defaultWorkspaceArchiveLockedHint') : undefined}
                          onClick={() => setConfirmingDeleteKey(activeProject.key)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}
      </div>
    </Dialog.Root>
  );
}
