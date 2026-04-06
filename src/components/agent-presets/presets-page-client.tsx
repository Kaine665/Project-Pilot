'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Search, Plus } from 'lucide-react';
import type { AgentPreset } from '@/types';
import { useProject } from '@/components/project-context';
import { PresetCard } from '@/components/agent-presets/preset-card';
import { PresetFormDialog } from '@/components/agent-presets/preset-form-dialog';
import { Input } from '@/components/ui/input';
import { useTranslations } from '@/client/i18n/use-translations';

export function PresetsPageClient() {
  const t = useTranslations('presets');
  const { projects, fetchProjects } = useProject();
  const [list, setList] = useState<AgentPreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<'create' | 'edit'>('create');
  const [editing, setEditing] = useState<AgentPreset | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/data/agent-presets', { cache: 'no-store' });
      const data = await res.json();
      setList(Array.isArray(data.presets) ? data.presets : []);
    } catch {
      setList([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    void fetchProjects();
  }, [load, fetchProjects]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.description ?? '').toLowerCase().includes(q),
    );
  }, [list, query]);

  const openCreate = () => {
    setDialogMode('create');
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = (p: AgentPreset) => {
    setDialogMode('edit');
    setEditing(p);
    setDialogOpen(true);
  };

  const handleDelete = async (p: AgentPreset) => {
    if (!confirm(t('deleteConfirm', { name: p.name }))) return;
    try {
      const res = await fetch('/api/data/agent-presets', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: p.id }),
      });
      if (res.ok) {
        await load();
        void fetchProjects();
      }
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">{t('title')}</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {loading && list.length === 0 ? t('loading') : t('summary', { count: list.length })}
          </p>
          <p className="mt-2 text-xs text-zinc-400">{t('projectDefaultHint')}</p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:min-w-[280px]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('searchPlaceholder')}
              className="h-10 pl-9"
            />
          </div>
        </div>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <button
          type="button"
          onClick={openCreate}
          className="flex min-h-[140px] flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-zinc-300 bg-zinc-50/50 text-zinc-500 transition-colors hover:border-zinc-400 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900/30 dark:hover:border-zinc-500 dark:hover:bg-zinc-900/50"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-200/80 dark:bg-zinc-800">
            <Plus className="h-6 w-6" />
          </div>
          <span className="text-sm font-medium">{t('createCard')}</span>
        </button>

        {filtered.map((p) => (
          <PresetCard key={p.id} preset={p} onEdit={() => openEdit(p)} onDelete={() => void handleDelete(p)} />
        ))}
      </div>

      {!loading && filtered.length === 0 && list.length > 0 && (
        <p className="text-center text-sm text-zinc-500">{t('emptySearch')}</p>
      )}
      {!loading && list.length === 0 && (
        <p className="text-center text-sm text-zinc-500">{t('empty')}</p>
      )}

      <PresetFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        mode={dialogMode}
        preset={editing}
        projects={projects}
        onSaved={() => {
          void load();
          void fetchProjects();
        }}
      />
    </div>
  );
}
