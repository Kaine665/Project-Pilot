'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useTranslations } from 'next-intl';
import {
  ArrowRight,
  Archive,
  ChevronLeft,
  ChevronRight,
  FolderKanban,
  FolderPlus,
  GitBranch,
  Globe,
  Link2,
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
import type { ProjectEntry, ProjectLocation, ProjectTechStack } from '@/types';

const LOCATION_OPTIONS: { value: ProjectLocation; labelKey: string }[] = [
  { value: 'local', labelKey: 'locationLocal' },
  { value: 'github', labelKey: 'locationGithub' },
  { value: 'gitee', labelKey: 'locationGitee' },
  { value: 'cloud-server', labelKey: 'locationCloudServer' },
  { value: 'hybrid', labelKey: 'locationHybrid' },
];

const TECH_STACK_OPTIONS: { value: ProjectTechStack; label: string }[] = [
  { value: 'nextjs', label: 'Next.js' },
  { value: 'react', label: 'React' },
  { value: 'react-native', label: 'React Native' },
  { value: 'vue', label: 'Vue' },
  { value: 'angular', label: 'Angular' },
  { value: 'node', label: 'Node.js' },
  { value: 'python', label: 'Python' },
  { value: 'go', label: 'Go' },
  { value: 'rust', label: 'Rust' },
  { value: 'java', label: 'Java' },
  { value: 'electron', label: 'Electron' },
  { value: 'flutter', label: 'Flutter' },
  { value: 'other', label: 'Other' },
];

function makeProjectKey(name: string, existingKeys: string[]) {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || `project-${Date.now()}`;

  let next = base;
  let index = 2;
  while (existingKeys.includes(next)) {
    next = `${base}-${index}`;
    index += 1;
  }
  return next;
}

function formatDate(value?: string) {
  if (!value) return '-';
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function projectAccent(project: ProjectEntry) {
  const color = project.color?.trim();
  if (color) {
    return {
      borderColor: `${color}33`,
      background: `linear-gradient(135deg, ${color}18 0%, rgba(255,255,255,0.98) 28%, rgba(244,244,245,0.92) 100%)`,
      boxShadow: `0 18px 36px -28px ${color}80`,
    };
  }

  return {
    background:
      'linear-gradient(135deg, rgba(244,244,245,0.96) 0%, rgba(255,255,255,0.98) 42%, rgba(228,228,231,0.78) 100%)',
  };
}

export function ProjectsManagementHub() {
  const { projects, activeKey, setActiveKey, fetchProjects } = useProject();
  const t = useTranslations('projects');
  const tActions = useTranslations('actions');

  const [searchText, setSearchText] = useState('');
  const [techFilter, setTechFilter] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [confirmingDeleteKey, setConfirmingDeleteKey] = useState<string | null>(null);
  const [formName, setFormName] = useState('');
  const [formPath, setFormPath] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formLocation, setFormLocation] = useState('');
  const [formTechStack, setFormTechStack] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const activeProject = projects.find(project => project.key === activeKey) ?? null;

  const refreshProjects = useCallback(async () => {
    return fetchProjects();
  }, [fetchProjects]);

  const handleProjectUpdated = useCallback(async () => {
    await refreshProjects();
  }, [refreshProjects]);

  const handleProjectDeleted = useCallback(
    async (deletedKey?: string) => {
      const list = await refreshProjects();
      if (deletedKey && activeKey !== deletedKey) {
        return;
      }

      if (list.length > 0) {
        setActiveKey(list[0].key);
      } else {
        setActiveKey('');
      }
    },
    [activeKey, refreshProjects, setActiveKey],
  );

  const filteredProjects = useMemo(() => {
    const keyword = searchText.trim().toLowerCase();

    return projects.filter(project => {
      const matchesKeyword =
        keyword.length === 0 ||
        project.name.toLowerCase().includes(keyword) ||
        project.key.toLowerCase().includes(keyword) ||
        project.path?.toLowerCase().includes(keyword) ||
        project.repository?.url?.toLowerCase().includes(keyword) ||
        project.tags?.some(tag => tag.toLowerCase().includes(keyword));

      const matchesTech = !techFilter || project.techStack === techFilter;

      return matchesKeyword && matchesTech;
    });
  }, [projects, searchText, techFilter]);

  const scrollCards = useCallback((direction: 'left' | 'right') => {
    const node = scrollRef.current;
    if (!node) return;
    const delta = Math.round(node.clientWidth * 0.78);
    node.scrollBy({
      left: direction === 'left' ? -delta : delta,
      behavior: 'smooth',
    });
  }, []);

  const openProject = useCallback((projectKey: string) => {
    setActiveKey(projectKey);
  }, [setActiveKey]);

  const resetCreateForm = useCallback(() => {
    setFormName('');
    setFormPath('');
    setFormDescription('');
    setFormLocation('');
    setFormTechStack('');
    setCreateOpen(false);
  }, []);

  const handleCreateProject = useCallback(async () => {
    const name = formName.trim();
    const path = formPath.trim();
    if (!name || !path) return;

    setCreating(true);
    try {
      const key = makeProjectKey(
        name,
        projects.map(project => project.key),
      );

      const res = await fetch('/api/data/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key,
          name,
          path,
          description: formDescription.trim() || undefined,
          location: formLocation || undefined,
          techStack: formTechStack || undefined,
        }),
      });

      if (!res.ok) return;

      await refreshProjects();
      setActiveKey(key);
      resetCreateForm();
    } finally {
      setCreating(false);
    }
  }, [
    formDescription,
    formLocation,
    formName,
    formPath,
    formTechStack,
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

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-8 px-8 py-8">
      <section className="space-y-5">
        <div className="flex flex-col gap-4 rounded-[28px] border border-zinc-200 bg-white/95 p-6 shadow-[0_24px_60px_-44px_rgba(0,0,0,0.35)] dark:border-zinc-800 dark:bg-zinc-950/95">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-2xl space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-[11px] font-medium text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400">
                <FolderKanban className="h-3.5 w-3.5" />
                {t('managerBadge')}
              </div>
              <div className="space-y-2">
                <h1 className="text-3xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
                  {t('managerTitle')}
                </h1>
                <p className="max-w-xl text-sm leading-6 text-zinc-500 dark:text-zinc-400">
                  {t('managerSubtitle')}
                </p>
              </div>
            </div>

            <div className="grid min-w-[240px] grid-cols-2 gap-3">
              <Card className="rounded-2xl border-zinc-200 bg-zinc-50/80 shadow-none dark:border-zinc-800 dark:bg-zinc-900/70">
                <CardContent className="space-y-1 p-4">
                  <div className="text-[11px] uppercase tracking-[0.14em] text-zinc-400">
                    {t('totalProjectsLabel')}
                  </div>
                  <div className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
                    {projects.length}
                  </div>
                </CardContent>
              </Card>
              <Card className="rounded-2xl border-zinc-200 bg-zinc-50/80 shadow-none dark:border-zinc-800 dark:bg-zinc-900/70">
                <CardContent className="space-y-1 p-4">
                  <div className="text-[11px] uppercase tracking-[0.14em] text-zinc-400">
                    {t('currentProjectLabel')}
                  </div>
                  <div className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {activeProject?.name ?? t('noProjectSelected')}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>

          <div className="flex flex-col gap-3 border-t border-zinc-200 pt-5 dark:border-zinc-800 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-1 flex-col gap-3 md:flex-row">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                <Input
                  value={searchText}
                  onChange={event => setSearchText(event.target.value)}
                  placeholder={t('searchPlaceholder')}
                  className="h-11 rounded-xl border-zinc-200 bg-white pl-10 dark:border-zinc-700 dark:bg-zinc-900"
                />
              </div>

              <Select
                value={techFilter}
                onChange={setTechFilter}
                className="h-11 min-w-[180px] rounded-xl border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900"
                options={[
                  { value: '', label: t('allTechStacks') },
                  ...TECH_STACK_OPTIONS,
                ]}
              />
            </div>

            <Dialog.Root
              open={createOpen}
              onOpenChange={open => {
                setCreateOpen(open);
                if (!open) {
                  setFormName('');
                  setFormPath('');
                  setFormDescription('');
                  setFormLocation('');
                  setFormTechStack('');
                }
              }}
            >
              <Dialog.Trigger asChild>
                <Button className="h-11 rounded-xl px-5 text-sm font-medium">
                  <FolderPlus className="h-4 w-4" />
                  {t('createProject')}
                </Button>
              </Dialog.Trigger>

              <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
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
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                          {t('projectName')}
                        </label>
                        <Input value={formName} onChange={event => setFormName(event.target.value)} />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                          {t('projectPath')}
                        </label>
                        <Input
                          value={formPath}
                          onChange={event => setFormPath(event.target.value)}
                          placeholder={t('projectPathPlaceholder')}
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                        {t('projectDescription')}
                      </label>
                      <Textarea
                        rows={3}
                        value={formDescription}
                        onChange={event => setFormDescription(event.target.value)}
                        placeholder={t('projectDescriptionPlaceholder')}
                        className="resize-none"
                      />
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                          {t('location')}
                        </label>
                        <Select
                          value={formLocation}
                          onChange={setFormLocation}
                          placeholder={t('location')}
                          options={LOCATION_OPTIONS.map(option => ({
                            value: option.value,
                            label: t(option.labelKey),
                          }))}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                          {t('techStack')}
                        </label>
                        <Select
                          value={formTechStack}
                          onChange={setFormTechStack}
                          placeholder={t('techStack')}
                          options={TECH_STACK_OPTIONS}
                        />
                      </div>
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
                      disabled={creating || !formName.trim() || !formPath.trim()}
                      className="rounded-xl"
                    >
                      {creating ? t('creatingProject') : t('createProject')}
                    </Button>
                  </div>
                </Dialog.Content>
              </Dialog.Portal>
            </Dialog.Root>
          </div>
        </div>

        {filteredProjects.length === 0 ? (
          <Card className="rounded-[28px] border-dashed border-zinc-300 bg-zinc-50/70 dark:border-zinc-700 dark:bg-zinc-900/40">
            <CardContent className="flex flex-col items-center gap-3 px-6 py-16 text-center">
              <div className="rounded-full bg-white p-4 shadow-sm dark:bg-zinc-950">
                <FolderKanban className="h-7 w-7 text-zinc-500" />
              </div>
              <div className="space-y-2">
                <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                  {t('emptyStateTitle')}
                </h2>
                <p className="max-w-md text-sm leading-6 text-zinc-500 dark:text-zinc-400">
                  {t('emptyStateDescription')}
                </p>
              </div>
              <Button onClick={() => setCreateOpen(true)} className="mt-2 rounded-xl">
                <FolderPlus className="h-4 w-4" />
                {t('createProject')}
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-sm text-zinc-500 dark:text-zinc-400">
                {t('cardsHint')}
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" className="rounded-full" onClick={() => scrollCards('left')}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="sm" className="rounded-full" onClick={() => scrollCards('right')}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div
              ref={scrollRef}
              className="flex snap-x snap-mandatory gap-5 overflow-x-auto pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              {filteredProjects.map(project => {
                const selected = project.key === activeKey;
                const confirmingDelete = confirmingDeleteKey === project.key;

                return (
                  <Card
                    key={project.key}
                    style={projectAccent(project)}
                    className={`min-w-[360px] max-w-[420px] snap-center rounded-[30px] border transition-all duration-300 dark:border-zinc-700 ${
                      selected ? 'translate-y-0 shadow-[0_30px_80px_-52px_rgba(0,0,0,0.55)]' : 'translate-y-3'
                    }`}
                  >
                    <CardContent className="flex h-full flex-col gap-5 p-6">
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-3">
                          <div className="flex items-center gap-2">
                            <div
                              className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/60 bg-white/85 text-zinc-700 shadow-sm dark:border-zinc-700 dark:bg-zinc-900"
                            >
                              <FolderKanban className="h-5 w-5" />
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {project.techStack && (
                                <Badge variant="outline" className="rounded-full bg-white/80 dark:bg-zinc-950/70">
                                  {TECH_STACK_OPTIONS.find(option => option.value === project.techStack)?.label ?? project.techStack}
                                </Badge>
                              )}
                              {project.location && (
                                <Badge variant="secondary" className="rounded-full bg-white/80 dark:bg-zinc-950/70">
                                  {t(LOCATION_OPTIONS.find(option => option.value === project.location)?.labelKey ?? 'locationLocal')}
                                </Badge>
                              )}
                            </div>
                          </div>

                          <div className="space-y-1">
                            <button
                              onClick={() => setActiveKey(project.key)}
                              className="text-left text-2xl font-semibold tracking-tight text-zinc-950 transition-colors hover:text-zinc-700 dark:text-zinc-50 dark:hover:text-zinc-200"
                            >
                              {project.name}
                            </button>
                            <div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-400">
                              {project.key}
                            </div>
                          </div>
                        </div>

                        <ProjectSettings
                          projectKey={project.key}
                          projectName={project.name}
                          projectDescription={project.description}
                          projectEntry={project}
                          onUpdated={handleProjectUpdated}
                          onDeleted={() => handleProjectDeleted(project.key)}
                        />
                      </div>

                      <p className="min-h-[66px] text-sm leading-6 text-zinc-600 dark:text-zinc-300">
                        {project.description?.trim() || t('noDescription')}
                      </p>

                      <div className="grid gap-3 text-sm text-zinc-600 dark:text-zinc-300">
                        <div className="flex items-start gap-3 rounded-2xl border border-white/70 bg-white/75 px-4 py-3 dark:border-zinc-700 dark:bg-zinc-950/70">
                          <Link2 className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" />
                          <div className="min-w-0">
                            <div className="text-[11px] uppercase tracking-[0.14em] text-zinc-400">
                              {t('projectPath')}
                            </div>
                            <div className="truncate text-sm text-zinc-700 dark:text-zinc-200">
                              {project.path || '-'}
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div className="rounded-2xl border border-white/70 bg-white/75 px-4 py-3 dark:border-zinc-700 dark:bg-zinc-950/70">
                            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-zinc-400">
                              <GitBranch className="h-3.5 w-3.5" />
                              {t('repositoryInfo')}
                            </div>
                            <div className="mt-2 line-clamp-2 text-sm text-zinc-700 dark:text-zinc-200">
                              {project.repository?.url || '-'}
                            </div>
                          </div>

                          <div className="rounded-2xl border border-white/70 bg-white/75 px-4 py-3 dark:border-zinc-700 dark:bg-zinc-950/70">
                            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-zinc-400">
                              <Globe className="h-3.5 w-3.5" />
                              {t('webUrl')}
                            </div>
                            <div className="mt-2 line-clamp-2 text-sm text-zinc-700 dark:text-zinc-200">
                              {project.devServer?.url || '-'}
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-2xl border border-white/70 bg-white/75 px-4 py-3 dark:border-zinc-700 dark:bg-zinc-950/70">
                          <div>
                            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-zinc-400">
                              <TerminalSquare className="h-3.5 w-3.5" />
                              {t('devEnvironment')}
                            </div>
                            <div className="mt-2 line-clamp-2 text-sm text-zinc-700 dark:text-zinc-200">
                              {project.devServer?.command || project.repository?.defaultBranch || '-'}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-[11px] uppercase tracking-[0.14em] text-zinc-400">
                              {t('lastUpdatedLabel')}
                            </div>
                            <div className="mt-2 text-sm text-zinc-700 dark:text-zinc-200">
                              {formatDate(project.updatedAt)}
                            </div>
                          </div>
                        </div>
                      </div>

                      {project.tags && project.tags.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {project.tags.slice(0, 4).map(tag => (
                            <Badge
                              key={tag}
                              variant="outline"
                              className="rounded-full bg-white/80 text-zinc-600 dark:bg-zinc-950/70 dark:text-zinc-300"
                            >
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      )}

                      <div className="mt-auto flex flex-col gap-3">
                        {confirmingDelete ? (
                          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm dark:border-red-900/60 dark:bg-red-950/30">
                            <div className="text-red-700 dark:text-red-300">
                              {t('cardDeleteConfirm', { name: project.name })}
                            </div>
                            <div className="mt-3 flex gap-2">
                              <Button
                                variant="destructive"
                                size="sm"
                                className="rounded-xl"
                                onClick={() => handleArchiveProject(project.key)}
                              >
                                {tActions('delete')}
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                className="rounded-xl"
                                onClick={() => setConfirmingDeleteKey(null)}
                              >
                                {tActions('cancel')}
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-wrap items-center gap-2">
                              <Button className="rounded-xl" onClick={() => openProject(project.key)}>
                                {t('openProject')}
                                <ArrowRight className="h-4 w-4" />
                              </Button>
                            <Button
                              variant="outline"
                              className="rounded-xl"
                              onClick={() => setConfirmingDeleteKey(project.key)}
                            >
                              <Trash2 className="h-4 w-4" />
                              {tActions('delete')}
                            </Button>
                            <Button
                              variant="ghost"
                              className="rounded-xl text-zinc-500"
                              onClick={() => handleArchiveProject(project.key)}
                            >
                              <Archive className="h-4 w-4" />
                              {tActions('archive')}
                            </Button>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
