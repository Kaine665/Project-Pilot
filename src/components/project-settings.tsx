'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import * as Dialog from '@radix-ui/react-dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Settings, X, Archive, Trash2 } from 'lucide-react';

interface ProjectSettingsProps {
  projectKey: string;
  projectName: string;
  projectDescription?: string;
  onUpdated: () => void;
  onDeleted: () => void;
}

export function ProjectSettings({
  projectKey,
  projectName,
  projectDescription,
  onUpdated,
  onDeleted,
}: ProjectSettingsProps) {
  const t = useTranslations('projects');
  const tActions = useTranslations('actions');
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(projectName);
  const [description, setDescription] = useState(projectDescription ?? '');
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Sync props when dialog opens
  useEffect(() => {
    if (open) {
      setName(projectName);
      setDescription(projectDescription ?? '');
      setConfirmingDelete(false);
    }
  }, [open, projectName, projectDescription]);

  const handleSave = useCallback(async () => {
    const trimmedName = name.trim();
    if (!trimmedName) return;

    setSaving(true);
    try {
      const res = await fetch('/api/data/projects', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: projectKey,
          name: trimmedName,
          description: description.trim(),
        }),
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
  }, [projectKey, name, description, onUpdated]);

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
    } catch {
      // ignore
    }
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
    } catch {
      // ignore
    }
  }, [projectKey, onDeleted]);

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
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-zinc-200 bg-white p-6 shadow-lg dark:border-zinc-800 dark:bg-zinc-950">
          {/* Header */}
          <div className="flex items-center justify-between mb-5">
            <Dialog.Title className="text-lg font-semibold">{t('settings')}</Dialog.Title>
            <Dialog.Close asChild>
              <button className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300">
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          {/* Form */}
          <div className="flex flex-col gap-4">
            {/* Project Name */}
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                {t('projectName')}
              </label>
              <Input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder={t('projectName')}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleSave();
                }}
              />
            </div>

            {/* Project Description */}
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                {t('settingsDescription')}
              </label>
              <Textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder={t('settingsDescriptionPlaceholder')}
                rows={3}
                className="resize-none"
              />
            </div>

            {/* Save button */}
            <button
              onClick={handleSave}
              disabled={saving || !name.trim()}
              className="w-full rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              {saving ? '...' : tActions('save')}
            </button>
          </div>

          {/* Danger zone */}
          <div className="mt-6 border-t border-zinc-200 pt-4 dark:border-zinc-800">
            <div className="flex flex-col gap-2">
              {/* Archive */}
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

              {/* Delete */}
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
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
