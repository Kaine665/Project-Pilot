'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslations } from '@/client/i18n/use-translations';
import { Link } from '@/client/i18n/routing';
import * as Dialog from '@radix-ui/react-dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';
import { Settings, X, Archive, Trash2, ChevronDown, ChevronRight, Bot, Layers } from 'lucide-react';
import type { Agent, AgentPreset, ProjectEntry, ProjectLocation, ProjectTechStack } from '@/types';

interface ProjectSettingsProps {
  projectKey: string;
  projectName: string;
  projectDescription?: string;
  /** Full project entry for populating all fields */
  projectEntry?: ProjectEntry;
  onUpdated: () => void;
  onDeleted: () => void;
}

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

const REPO_PROVIDER_OPTIONS = [
  { value: 'github', label: 'GitHub' },
  { value: 'gitlab', label: 'GitLab' },
  { value: 'gitee', label: 'Gitee' },
  { value: 'bitbucket', label: 'Bitbucket' },
  { value: 'other', label: 'Other' },
];

export function ProjectSettings({
  projectKey,
  projectName,
  projectDescription,
  projectEntry,
  onUpdated,
  onDeleted,
}: ProjectSettingsProps) {
  const t = useTranslations('projects');
  const tActions = useTranslations('actions');
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [path, setPath] = useState('');
  const [location, setLocation] = useState<string>('');
  const [techStack, setTechStack] = useState<string>('');
  const [repoUrl, setRepoUrl] = useState('');
  const [defaultBranch, setDefaultBranch] = useState('');
  const [repoProvider, setRepoProvider] = useState('');
  const [devCommand, setDevCommand] = useState('');
  const [devUrl, setDevUrl] = useState('');
  const [devPort, setDevPort] = useState('');
  const [sshKey, setSshKey] = useState('');
  const [tokenEnvVar, setTokenEnvVar] = useState('');
  const [accessNotes, setAccessNotes] = useState('');
  const [icon, setIcon] = useState('');
  const [color, setColor] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [defaultAgentId, setDefaultAgentId] = useState('');
  const [defaultPresetId, setDefaultPresetId] = useState('');
  const [agents, setAgents] = useState<Agent[]>([]);
  const [agentPresets, setAgentPresets] = useState<AgentPreset[]>([]);

  // Collapsible sections
  const [showRepo, setShowRepo] = useState(false);
  const [showDev, setShowDev] = useState(false);
  const [showAccess, setShowAccess] = useState(false);
  const [showVisual, setShowVisual] = useState(false);

  // Sync from props when dialog opens
  useEffect(() => {
    if (open) {
      const entry = projectEntry;
      setName(projectName);
      setDescription(projectDescription ?? entry?.description ?? '');
      setPath(entry?.path ?? '');
      setLocation(entry?.location ?? '');
      setTechStack(entry?.techStack ?? '');
      setRepoUrl(entry?.repository?.url ?? '');
      setDefaultBranch(entry?.repository?.defaultBranch ?? '');
      setRepoProvider(entry?.repository?.provider ?? '');
      setDevCommand(entry?.devServer?.command ?? '');
      setDevUrl(entry?.devServer?.url ?? '');
      setDevPort(entry?.devServer?.port?.toString() ?? '');
      setSshKey(entry?.access?.sshKey ?? '');
      setTokenEnvVar(entry?.access?.tokenEnvVar ?? '');
      setAccessNotes(entry?.access?.notes ?? '');
      setIcon(entry?.icon ?? '');
      setColor(entry?.color ?? '');
      setTags(entry?.tags ?? []);
      setTagsInput('');
      setDefaultAgentId(entry?.defaultAgentId ?? '');
      setDefaultPresetId(entry?.defaultPresetId ?? '');
      setConfirmingDelete(false);

      // Auto-expand sections that have data
      setShowRepo(!!(entry?.repository?.url || entry?.repository?.defaultBranch));
      setShowDev(!!(entry?.devServer?.command || entry?.devServer?.url));
      setShowAccess(!!(entry?.access?.sshKey || entry?.access?.tokenEnvVar || entry?.access?.notes));
      setShowVisual(!!(entry?.icon || entry?.color || (entry?.tags && entry.tags.length > 0)));

      // Fetch agents for default agent dropdown
      fetch('/api/agents').then(r => r.ok ? r.json() : null).then(data => {
        if (data?.agents) setAgents(data.agents);
      }).catch(() => {});

      fetch('/api/data/agent-presets', { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data?.presets) setAgentPresets(data.presets);
        })
        .catch(() => setAgentPresets([]));
    }
  }, [open, projectName, projectDescription, projectEntry]);

  const handleSave = useCallback(async () => {
    const trimmedName = name.trim();
    if (!trimmedName) return;

    setSaving(true);
    try {
      const updates: Record<string, unknown> = {
        key: projectKey,
        name: trimmedName,
        description: description.trim(),
        path: path.trim(),
        location: location || null,
        techStack: techStack || null,
        icon: icon.trim() || null,
        color: color.trim() || null,
        tags: tags.length > 0 ? tags : null,
        defaultAgentId: defaultAgentId || null,
        defaultPresetId: defaultPresetId || null,
      };

      // Repository
      if (repoUrl.trim() || defaultBranch.trim() || repoProvider) {
        updates.repository = {
          url: repoUrl.trim() || null,
          defaultBranch: defaultBranch.trim() || null,
          provider: repoProvider || null,
        };
      } else {
        updates.repository = null;
      }

      // Dev server
      if (devCommand.trim() || devUrl.trim() || devPort.trim()) {
        updates.devServer = {
          command: devCommand.trim() || null,
          url: devUrl.trim() || null,
          port: devPort.trim() ? parseInt(devPort.trim(), 10) || null : null,
        };
      } else {
        updates.devServer = null;
      }

      // Access
      if (sshKey.trim() || tokenEnvVar.trim() || accessNotes.trim()) {
        updates.access = {
          sshKey: sshKey.trim() || null,
          tokenEnvVar: tokenEnvVar.trim() || null,
          notes: accessNotes.trim() || null,
        };
      } else {
        updates.access = null;
      }

      const res = await fetch('/api/data/projects', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (res.ok) {
        onUpdated();
        setOpen(false);
      }
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  }, [projectKey, name, description, path, location, techStack, repoUrl, defaultBranch, repoProvider, devCommand, devUrl, devPort, sshKey, tokenEnvVar, accessNotes, icon, color, tags, defaultAgentId, defaultPresetId, onUpdated]);

  const handleArchive = useCallback(async () => {
    try {
      const res = await fetch('/api/data/projects', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: projectKey }),
      });
      if (res.ok) {
        setOpen(false);
        onDeleted();
      }
    } catch { /* ignore */ }
  }, [projectKey, onDeleted]);

  const handleDelete = useCallback(async () => {
    try {
      const res = await fetch(`/api/data/projects?key=${encodeURIComponent(projectKey)}&permanent=true`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: projectKey, permanent: true }),
      });
      if (res.ok) {
        setOpen(false);
        onDeleted();
      }
    } catch { /* ignore */ }
  }, [projectKey, onDeleted]);

  const handleAddTag = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && tagsInput.trim()) {
      e.preventDefault();
      const tag = tagsInput.trim();
      if (!tags.includes(tag)) {
        setTags([...tags, tag]);
      }
      setTagsInput('');
    }
  };

  const handleRemoveTag = (tag: string) => {
    setTags(tags.filter(t => t !== tag));
  };

  // Determine which access fields to show based on location
  const showSshKey = location === 'cloud-server' || location === 'hybrid';
  const showToken = location === 'github' || location === 'gitee' || location === 'hybrid';

  const SectionHeader = ({ label, expanded, onToggle }: { label: string; expanded: boolean; onToggle: () => void }) => (
    <button
      type="button"
      onClick={onToggle}
      className="flex items-center gap-1.5 w-full text-xs font-medium text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 py-1 transition-colors"
    >
      {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
      {label}
    </button>
  );

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          className="inline-flex items-center justify-center rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 transition-colors dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
          title={t('settings')}
        >
          <Settings className="h-4 w-4" />
        </button>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-800 dark:bg-zinc-950 max-h-[85vh] flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-6 pt-6 pb-3">
            <Dialog.Title className="text-lg font-semibold">{t('settings')}</Dialog.Title>
            <Dialog.Close asChild>
              <button className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300">
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto px-6 pb-6">
            <div className="flex flex-col gap-4">
              {/* ── Basic Info ── */}
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    {t('projectName')} <span className="text-red-500">*</span>
                  </label>
                  <Input
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder={t('projectName')}
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    {t('projectPath')} <span className="text-red-500">*</span>
                  </label>
                  <Input
                    value={path}
                    onChange={e => setPath(e.target.value)}
                    placeholder={t('projectPathPlaceholder')}
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    {t('projectDescription')}
                  </label>
                  <Textarea
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    placeholder={t('projectDescriptionPlaceholder')}
                    rows={2}
                    className="resize-none"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                      {t('location')}
                    </label>
                    <Select
                      options={LOCATION_OPTIONS.map(o => ({ value: o.value, label: t(o.labelKey) }))}
                      placeholder={t('location')}
                      value={location}
                      onChange={setLocation}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                      {t('techStack')}
                    </label>
                    <Select
                      options={TECH_STACK_OPTIONS}
                      placeholder={t('techStack')}
                      value={techStack}
                      onChange={setTechStack}
                    />
                  </div>
                </div>
              </div>

              {/* ── Default Agent ── */}
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  <span className="flex items-center gap-1.5">
                    <Bot className="h-3.5 w-3.5" />
                    默认 Agent
                  </span>
                  <span className="text-[10px] font-normal text-zinc-400 mt-0.5 block">创建待办时自动绑定的 Agent</span>
                </label>
                <select
                  value={defaultAgentId}
                  onChange={e => setDefaultAgentId(e.target.value)}
                  className="w-full appearance-none rounded-lg border border-zinc-200 bg-white py-2 pl-3 pr-8 text-sm text-zinc-700 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
                >
                  <option value="">不设默认 Agent</option>
                  {agents.filter(a => !a.archived).map(a => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </div>

              {/* ── Default agent template ── */}
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  <span className="flex items-center gap-1.5">
                    <Layers className="h-3.5 w-3.5" />
                    {t('defaultPresetLabel')}
                  </span>
                  <span className="text-[10px] font-normal text-zinc-400 mt-0.5 block">{t('defaultPresetHint')}</span>
                </label>
                <div className="flex flex-wrap items-stretch gap-2">
                  <select
                    value={defaultPresetId}
                    onChange={(e) => setDefaultPresetId(e.target.value)}
                    className="min-w-0 flex-1 appearance-none rounded-lg border border-zinc-200 bg-white py-2 pl-3 pr-8 text-sm text-zinc-700 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
                  >
                    <option value="">{t('defaultPresetNone')}</option>
                    {agentPresets
                      .filter((p) => !p.projectKey || p.projectKey === projectKey)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                          {p.projectKey ? ` (${p.projectKey})` : ''}
                        </option>
                      ))}
                  </select>
                  <Link
                    href="/workspace/presets"
                    className="inline-flex shrink-0 items-center justify-center rounded-lg border border-zinc-200 px-3 py-2 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  >
                    {t('presetManageButton')}
                  </Link>
                </div>
              </div>

              {/* ── Repository ── */}
              <div className="border-t border-zinc-100 pt-2 dark:border-zinc-800">
                <SectionHeader label={t('repositoryInfo')} expanded={showRepo} onToggle={() => setShowRepo(!showRepo)} />
                {showRepo && (
                  <div className="flex flex-col gap-2 mt-2">
                    <Input
                      value={repoUrl}
                      onChange={e => setRepoUrl(e.target.value)}
                      placeholder={t('repoUrlPlaceholder')}
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <Input
                        value={defaultBranch}
                        onChange={e => setDefaultBranch(e.target.value)}
                        placeholder={t('defaultBranchPlaceholder')}
                      />
                      <Select
                        options={REPO_PROVIDER_OPTIONS}
                        placeholder={t('repoProvider')}
                        value={repoProvider}
                        onChange={setRepoProvider}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* ── Dev Environment ── */}
              <div className="border-t border-zinc-100 pt-2 dark:border-zinc-800">
                <SectionHeader label={t('devEnvironment')} expanded={showDev} onToggle={() => setShowDev(!showDev)} />
                {showDev && (
                  <div className="flex flex-col gap-2 mt-2">
                    <Input
                      value={devCommand}
                      onChange={e => setDevCommand(e.target.value)}
                      placeholder={t('webCommandPlaceholder')}
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <Input
                        value={devUrl}
                        onChange={e => setDevUrl(e.target.value)}
                        placeholder={t('webUrlPlaceholder')}
                      />
                      <Input
                        value={devPort}
                        onChange={e => setDevPort(e.target.value)}
                        placeholder={t('webPort')}
                        type="number"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* ── Access & Permissions (conditional on location) ── */}
              {(showSshKey || showToken) && (
                <div className="border-t border-zinc-100 pt-2 dark:border-zinc-800">
                  <SectionHeader label={t('accessPermissions')} expanded={showAccess} onToggle={() => setShowAccess(!showAccess)} />
                  {showAccess && (
                    <div className="flex flex-col gap-2 mt-2">
                      {showToken && (
                        <Input
                          value={tokenEnvVar}
                          onChange={e => setTokenEnvVar(e.target.value)}
                          placeholder={t('tokenEnvVarPlaceholder')}
                        />
                      )}
                      {showSshKey && (
                        <Input
                          value={sshKey}
                          onChange={e => setSshKey(e.target.value)}
                          placeholder={t('sshKeyPlaceholder')}
                        />
                      )}
                      <Input
                        value={accessNotes}
                        onChange={e => setAccessNotes(e.target.value)}
                        placeholder={t('accessNotesPlaceholder')}
                      />
                    </div>
                  )}
                </div>
              )}

              {/* ── Visual Identity ── */}
              <div className="border-t border-zinc-100 pt-2 dark:border-zinc-800">
                <SectionHeader label={t('visualIdentity')} expanded={showVisual} onToggle={() => setShowVisual(!showVisual)} />
                {showVisual && (
                  <div className="flex flex-col gap-2 mt-2">
                    <div className="grid grid-cols-2 gap-2">
                      <Input
                        value={icon}
                        onChange={e => setIcon(e.target.value)}
                        placeholder={t('iconPlaceholder')}
                      />
                      <Input
                        value={color}
                        onChange={e => setColor(e.target.value)}
                        placeholder={t('color')}
                        type="color"
                        className="h-9"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Input
                        value={tagsInput}
                        onChange={e => setTagsInput(e.target.value)}
                        onKeyDown={handleAddTag}
                        placeholder={t('tagsPlaceholder')}
                      />
                      {tags.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {tags.map(tag => (
                            <span
                              key={tag}
                              className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                            >
                              {tag}
                              <button
                                type="button"
                                onClick={() => handleRemoveTag(tag)}
                                className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Save button */}
              <button
                onClick={handleSave}
                disabled={saving || !name.trim() || !path.trim()}
                className="w-full rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
              >
                {saving ? '...' : tActions('save')}
              </button>

              {/* ── Danger Zone ── */}
              <div className="border-t border-zinc-200 pt-4 dark:border-zinc-800">
                <div className="flex flex-col gap-2">
                  <button
                    onClick={handleArchive}
                    className="flex items-center gap-2 w-full rounded-md border border-zinc-200 px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 transition-colors dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800/50 dark:hover:text-zinc-200"
                  >
                    <Archive className="h-4 w-4" />
                    <div className="flex flex-col items-start">
                      <span>{t('archiveProject')}</span>
                      <span className="text-xs text-zinc-400">{t('archiveProjectHint')}</span>
                    </div>
                  </button>

                  {confirmingDelete ? (
                    <div className="rounded-md border border-red-200 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950/30">
                      <p className="text-sm text-red-700 dark:text-red-400 mb-3">
                        {t('confirmDeleteProject', { name: projectName })}
                      </p>
                      <div className="flex gap-2">
                        <button
                          onClick={handleDelete}
                          className="flex-1 rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 transition-colors"
                        >
                          {tActions('delete')}
                        </button>
                        <button
                          onClick={() => setConfirmingDelete(false)}
                          className="flex-1 rounded-md border border-zinc-200 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50 transition-colors dark:border-zinc-700 dark:text-zinc-400"
                        >
                          {tActions('cancel')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmingDelete(true)}
                      className="flex items-center gap-2 w-full rounded-md border border-red-200 px-3 py-2 text-sm text-red-600 hover:bg-red-50 hover:text-red-700 transition-colors dark:border-red-900/50 dark:text-red-400 dark:hover:bg-red-950/30"
                    >
                      <Trash2 className="h-4 w-4" />
                      <div className="flex flex-col items-start">
                        <span>{t('deleteProject')}</span>
                        <span className="text-xs text-red-400 dark:text-red-500">{t('deleteProjectHint')}</span>
                      </div>
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
