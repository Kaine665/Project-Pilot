'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from '@/client/i18n/routing';
import { useRouter } from '@/client/i18n/routing';
import { useProject } from '@/components/project-context';
import type { CategoryDef, ContextEntry, DocEntry } from '@/types';
import {
  BookOpen,
  Bot,
  Clock,
  FileText,
  FolderOpen,
  FolderTree,
  Globe,
  Library,
  Plus,
  Search,
  Sparkles,
  Tags,
  Trash2,
  X,
} from 'lucide-react';

type ProjectOption = {
  key: string;
  name: string;
};

type AssetKind = 'context' | 'design_doc';
type SystemFilter = 'all' | 'context' | 'design_doc' | 'draft';
type ScopeFilter = 'all' | 'project' | 'global';
type StatusFilter = 'all' | 'active' | 'draft' | 'deprecated';
type EditorMode = 'create' | 'edit' | null;

type KnowledgeAsset = {
  id: string;
  kind: AssetKind;
  title: string;
  description: string;
  projectKey?: string;
  scope: 'project' | 'global';
  collection: string;
  collectionId?: string;
  tags: string[];
  status: 'active' | 'draft' | 'deprecated';
  createdAt: string;
  updatedAt: string;
  fileName: string;
  format: 'json' | 'markdown' | 'text';
  sourcePath?: string;
};

type EditorState = {
  kind: AssetKind;
  title: string;
  description: string;
  collection: string;
  tagsInput: string;
  status: 'active' | 'draft' | 'deprecated';
  content: string;
  format: 'json' | 'markdown' | 'text';
  fileName: string;
  scope: 'project' | 'global';
  sourcePath: string;
};

const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

function formatDateTime(value: string) {
  return dateFormatter.format(new Date(value));
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function parseTags(value: string) {
  return Array.from(
    new Set(
      value
        .split(',')
        .map(tag => tag.trim())
        .filter(Boolean),
    ),
  );
}

function joinTags(tags?: string[]) {
  return (tags ?? []).join(', ');
}

function getContextFileExtension(format: EditorState['format']) {
  if (format === 'markdown') return 'md';
  if (format === 'json') return 'json';
  return 'txt';
}

function createDefaultEditor(kind: AssetKind): EditorState {
  return {
    kind,
    title: '',
    description: '',
    collection: '',
    tagsInput: '',
    status: 'active',
    content: '',
    format: 'markdown',
    fileName: kind === 'context' ? 'knowledge-asset.md' : '',
    scope: 'project',
    sourcePath: '',
  };
}

function mapDocToAsset(entry: DocEntry, categoriesById: Map<string, CategoryDef>): KnowledgeAsset {
  return {
    id: entry.id,
    kind: 'design_doc',
    title: entry.title,
    description: entry.description ?? '',
    projectKey: entry.projectKey,
    scope: 'project',
    collection: entry.category ? (categoriesById.get(entry.category)?.name ?? entry.category) : '',
    collectionId: entry.category,
    tags: entry.tags ?? [],
    status: entry.status ?? 'active',
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    fileName: entry.fileName,
    format: 'markdown',
  };
}

function mapContextToAsset(entry: ContextEntry): KnowledgeAsset {
  return {
    id: entry.id,
    kind: 'context',
    title: entry.label,
    description: entry.description,
    projectKey: entry.projectKey,
    scope: entry.projectKey ? 'project' : 'global',
    collection: entry.group ?? '',
    tags: entry.tags ?? [],
    status: entry.status ?? 'active',
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    fileName: entry.fileName,
    format: entry.format,
    sourcePath: entry.sourcePath,
  };
}

function mapDocToEditor(entry: DocEntry, content: string, categoriesById: Map<string, CategoryDef>): EditorState {
  return {
    kind: 'design_doc',
    title: entry.title,
    description: entry.description ?? '',
    collection: entry.category ? (categoriesById.get(entry.category)?.name ?? entry.category) : '',
    tagsInput: joinTags(entry.tags),
    status: entry.status ?? 'active',
    content,
    format: 'markdown',
    fileName: '',
    scope: 'project',
    sourcePath: '',
  };
}

function mapContextToEditor(entry: ContextEntry, content: string): EditorState {
  return {
    kind: 'context',
    title: entry.label,
    description: entry.description,
    collection: entry.group ?? '',
    tagsInput: joinTags(entry.tags),
    status: entry.status ?? 'active',
    content,
    format: entry.format,
    fileName: entry.fileName,
    scope: entry.projectKey ? 'project' : 'global',
    sourcePath: entry.sourcePath ?? '',
  };
}

function getAssetTypeLabel(asset: KnowledgeAsset) {
  if (asset.status === 'draft') return 'AI Draft';
  return asset.kind === 'design_doc' ? 'Design Doc' : 'Context';
}

function getAssetTypeClasses(asset: KnowledgeAsset) {
  if (asset.status === 'draft') {
    return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300';
  }
  if (asset.kind === 'design_doc') {
    return 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-300';
  }
  return 'border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-900/50 dark:bg-cyan-950/30 dark:text-cyan-300';
}

function getStatusClasses(status: KnowledgeAsset['status']) {
  if (status === 'deprecated') {
    return 'border-zinc-300 bg-zinc-100 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300';
  }
  if (status === 'draft') {
    return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300';
  }
  return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300';
}

function toSearchableText(asset: KnowledgeAsset) {
  return [
    asset.title,
    asset.description,
    asset.collection,
    asset.fileName,
    asset.tags.join(' '),
    asset.kind,
    asset.status,
  ]
    .join(' ')
    .toLowerCase();
}

function getSuggestedContextFileName(title: string, format: EditorState['format']) {
  const base = slugify(title) || 'knowledge-asset';
  return `${base}.${getContextFileExtension(format)}`;
}

export function KnowledgeAssetCenter({ projectKey }: { projectKey: string }) {
  const router = useRouter();
  const [searchParams] = useSearchParams();
  const { activeKey, setActiveKey } = useProject();

  const initialFocus = searchParams.get('focus');
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [assets, setAssets] = useState<KnowledgeAsset[]>([]);
  const [categories, setCategories] = useState<CategoryDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [editorLoading, setEditorLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [editorMode, setEditorMode] = useState<EditorMode>(null);
  const [form, setForm] = useState<EditorState>(() => createDefaultEditor('context'));
  const [originalForm, setOriginalForm] = useState<EditorState>(() => createDefaultEditor('context'));
  const [search, setSearch] = useState('');
  const [systemFilter, setSystemFilter] = useState<SystemFilter>(
    initialFocus === 'context' ? 'context' : initialFocus === 'design-doc' ? 'design_doc' : 'all',
  );
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [collectionFilter, setCollectionFilter] = useState<string>('all');
  const [tagFilter, setTagFilter] = useState<string>('all');
  const syncedRef = useRef(false);

  const categoriesById = useMemo(
    () => new Map(categories.map(category => [category.id, category])),
    [categories],
  );

  const selectedAsset = useMemo(
    () => assets.find(asset => asset.id === selectedAssetId) ?? null,
    [assets, selectedAssetId],
  );

  const fetchProjects = useCallback(async () => {
    try {
      const response = await fetch('/api/data/projects');
      const data = await response.json();
      const nextProjects: ProjectOption[] = (data.projects ?? [])
        .filter((item: ProjectOption & { archived?: boolean }) => !item.archived)
        .map((item: ProjectOption) => ({ key: item.key, name: item.name }));
      setProjects(nextProjects);
    } catch {
      setProjects([]);
    }
  }, []);

  const fetchAssets = useCallback(async () => {
    if (!projectKey) {
      setAssets([]);
      setCategories([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const [docsResponse, contextResponse, categoriesResponse] = await Promise.all([
        fetch(`/api/docs?project=${encodeURIComponent(projectKey)}`),
        fetch(`/api/context?projectKey=${encodeURIComponent(projectKey)}`),
        fetch(`/api/docs/categories?project=${encodeURIComponent(projectKey)}`),
      ]);

      const docsData = await docsResponse.json();
      const contextData = await contextResponse.json();
      const categoriesData = await categoriesResponse.json();

      const nextCategories: CategoryDef[] = categoriesData.categories ?? [];
      const nextCategoriesById = new Map(nextCategories.map(category => [category.id, category]));
      const docAssets = ((docsData.docs ?? []) as DocEntry[]).map(entry => mapDocToAsset(entry, nextCategoriesById));
      const contextAssets = ((contextData.entries ?? []) as ContextEntry[]).map(mapContextToAsset);

      setCategories(nextCategories);
      setAssets(
        [...docAssets, ...contextAssets].sort(
          (left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
        ),
      );
    } catch {
      setAssets([]);
      setCategories([]);
    } finally {
      setLoading(false);
    }
  }, [projectKey]);

  useEffect(() => {
    if (projectKey && projectKey !== activeKey) {
      setActiveKey(projectKey);
    }
    syncedRef.current = true;
  }, [activeKey, projectKey, setActiveKey]);

  useEffect(() => {
    if (!syncedRef.current) return;
    if (activeKey && activeKey !== projectKey) {
      const focus = searchParams.get('focus');
      const suffix = focus ? `?focus=${encodeURIComponent(focus)}` : '';
      router.replace(`/flows/docs/${activeKey}${suffix}`);
    }
  }, [activeKey, projectKey, router, searchParams]);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  useEffect(() => {
    fetchAssets();
  }, [fetchAssets]);

  useEffect(() => {
    const focus = searchParams.get('focus');
    if (focus === 'context') {
      setSystemFilter('context');
      return;
    }
    if (focus === 'design-doc') {
      setSystemFilter('design_doc');
    }
  }, [searchParams]);

  const collectionCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const asset of assets) {
      if (!asset.collection) continue;
      counts.set(asset.collection, (counts.get(asset.collection) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
  }, [assets]);

  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const asset of assets) {
      for (const tag of asset.tags) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
  }, [assets]);

  const filteredAssets = useMemo(() => {
    const query = search.trim().toLowerCase();
    return assets.filter(asset => {
      if (systemFilter === 'context' && asset.kind !== 'context') return false;
      if (systemFilter === 'design_doc' && asset.kind !== 'design_doc') return false;
      if (systemFilter === 'draft' && asset.status !== 'draft') return false;
      if (scopeFilter === 'project' && asset.scope !== 'project') return false;
      if (scopeFilter === 'global' && asset.scope !== 'global') return false;
      if (statusFilter !== 'all' && asset.status !== statusFilter) return false;
      if (collectionFilter !== 'all' && asset.collection !== collectionFilter) return false;
      if (tagFilter !== 'all' && !asset.tags.includes(tagFilter)) return false;
      if (query && !toSearchableText(asset).includes(query)) return false;
      return true;
    });
  }, [assets, collectionFilter, scopeFilter, search, statusFilter, systemFilter, tagFilter]);

  const totalDrafts = useMemo(
    () => assets.filter(asset => asset.status === 'draft').length,
    [assets],
  );

  const totalGlobals = useMemo(
    () => assets.filter(asset => asset.scope === 'global').length,
    [assets],
  );

  const clearFilters = () => {
    setSearch('');
    setSystemFilter('all');
    setScopeFilter('all');
    setStatusFilter('all');
    setCollectionFilter('all');
    setTagFilter('all');
  };

  const handleProjectChange = (nextProjectKey: string) => {
    const focus = searchParams.get('focus');
    const suffix = focus ? `?focus=${encodeURIComponent(focus)}` : '';
    setActiveKey(nextProjectKey);
    router.push(`/flows/docs/${nextProjectKey}${suffix}`);
  };

  const handleStartCreate = (kind: AssetKind) => {
    const nextForm = createDefaultEditor(kind);
    setSelectedAssetId(null);
    setEditorMode('create');
    setForm(nextForm);
    setOriginalForm(nextForm);
  };

  const handleCloseEditor = () => {
    setSelectedAssetId(null);
    setEditorMode(null);
    const nextForm = createDefaultEditor('context');
    setForm(nextForm);
    setOriginalForm(nextForm);
  };

  const handleSelectAsset = useCallback(async (asset: KnowledgeAsset) => {
    setSelectedAssetId(asset.id);
    setEditorMode('edit');
    setEditorLoading(true);

    try {
      if (asset.kind === 'design_doc') {
        const response = await fetch(`/api/docs/${asset.id}`);
        if (!response.ok) return;
        const data = await response.json();
        const nextForm = mapDocToEditor(data.entry as DocEntry, data.content ?? '', categoriesById);
        setForm(nextForm);
        setOriginalForm(nextForm);
        return;
      }

      const response = await fetch(`/api/context/${asset.id}`);
      if (!response.ok) return;
      const data = await response.json();
      const nextForm = mapContextToEditor(data.entry as ContextEntry, data.content ?? '');
      setForm(nextForm);
      setOriginalForm(nextForm);
    } finally {
      setEditorLoading(false);
    }
  }, [categoriesById]);

  const ensureCategoryId = useCallback(async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return undefined;

    const existing = categories.find(category =>
      category.name.toLowerCase() === trimmed.toLowerCase() && (!category.projectKey || category.projectKey === projectKey),
    );
    if (existing) return existing.id;

    const response = await fetch('/api/docs/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: trimmed,
        projectKey,
      }),
    });

    if (!response.ok) {
      throw new Error('Failed to create category');
    }

    const data = await response.json();
    const created = data.category as CategoryDef;
    setCategories(previous =>
      [...previous, created].sort(
        (left, right) => (left.sortOrder ?? Number.MAX_SAFE_INTEGER) - (right.sortOrder ?? Number.MAX_SAFE_INTEGER)
          || left.name.localeCompare(right.name),
      ),
    );
    return created.id;
  }, [categories, projectKey]);

  const handleSave = async () => {
    if (!form.title.trim()) return;

    setSaving(true);
    try {
      if (editorMode === 'create') {
        if (form.kind === 'design_doc') {
          const categoryId = await ensureCategoryId(form.collection);
          const response = await fetch('/api/docs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              projectKey,
              title: form.title.trim(),
              description: form.description.trim() || undefined,
              content: form.content,
              category: categoryId,
              tags: parseTags(form.tagsInput),
              status: form.status,
            }),
          });
          if (!response.ok) return;
          const data = await response.json();
          await fetchAssets();
          setSelectedAssetId(data.entry.id);
          setEditorMode('edit');
          const nextForm = { ...form };
          setForm(nextForm);
          setOriginalForm(nextForm);
          return;
        }

        const fileName = form.fileName.trim() || getSuggestedContextFileName(form.title, form.format);
        const response = await fetch('/api/context', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            label: form.title.trim(),
            description: form.description.trim(),
            fileName,
            format: form.format,
            group: form.collection.trim() || undefined,
            sourcePath: form.sourcePath.trim() || undefined,
            projectKey: form.scope === 'project' ? projectKey : undefined,
            content: form.content,
            tags: parseTags(form.tagsInput),
            status: form.status === 'draft' ? 'draft' : 'active',
          }),
        });
        if (!response.ok) return;
        const data = await response.json();
        const nextForm = {
          ...form,
          fileName,
        };
        await fetchAssets();
        setSelectedAssetId(data.entry.id);
        setEditorMode('edit');
        setForm(nextForm);
        setOriginalForm(nextForm);
        return;
      }

      if (!selectedAsset) return;

      if (selectedAsset.kind === 'design_doc') {
        const categoryId = await ensureCategoryId(form.collection);
        const response = await fetch(`/api/docs/${selectedAsset.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: form.title.trim(),
            description: form.description.trim(),
            content: form.content,
            category: categoryId,
            tags: parseTags(form.tagsInput),
            status: form.status,
          }),
        });
        if (!response.ok) return;
      } else {
        const fileName = form.fileName.trim() || getSuggestedContextFileName(form.title, form.format);
        const response = await fetch(`/api/context/${selectedAsset.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            label: form.title.trim(),
            description: form.description.trim(),
            content: form.content,
            fileName,
            format: form.format,
            group: form.collection.trim(),
            sourcePath: form.sourcePath.trim(),
            projectKey: form.scope === 'project' ? projectKey : '',
            tags: parseTags(form.tagsInput),
            status: form.status === 'draft' ? 'draft' : 'active',
          }),
        });
        if (!response.ok) return;
        setForm(previous => ({ ...previous, fileName }));
      }

      await fetchAssets();
      setOriginalForm({ ...form });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedAsset) return;
    const shouldDelete = window.confirm(`Delete "${selectedAsset.title}"? This cannot be undone.`);
    if (!shouldDelete) return;

    setDeleting(true);
    try {
      const endpoint = selectedAsset.kind === 'design_doc' ? `/api/docs/${selectedAsset.id}` : `/api/context/${selectedAsset.id}`;
      const response = await fetch(endpoint, { method: 'DELETE' });
      if (!response.ok) return;
      await fetchAssets();
      handleCloseEditor();
    } finally {
      setDeleting(false);
    }
  };

  const hasChanges = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(originalForm),
    [form, originalForm],
  );

  useEffect(() => {
    if (form.kind !== 'context') return;
    if (editorMode !== 'create') return;
    if (form.fileName.trim() && form.fileName !== 'knowledge-asset.md') return;
    setForm(previous => ({
      ...previous,
      fileName: getSuggestedContextFileName(previous.title, previous.format),
    }));
  }, [editorMode, form.fileName, form.format, form.kind, form.title]);

  return (
    <div className="h-full overflow-y-auto bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.08),_transparent_28%),radial-gradient(circle_at_top_right,_rgba(59,130,246,0.08),_transparent_24%)]">
      <div className="mx-auto max-w-[1400px] px-6 py-8">
        <div className="mb-6 flex flex-col gap-4 rounded-3xl border border-zinc-200/70 bg-white/90 p-6 shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="max-w-3xl">
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-xs font-medium text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
                <Library className="h-3.5 w-3.5" />
                Knowledge Asset Center
              </div>
              <h1 className="text-3xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
                One library, flexible structure.
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
                Storage types stay system-defined, but organization becomes user-defined through collections, tags,
                scope, and lifecycle filters. Design docs and context entries now live in the same operating surface.
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <select
                value={projectKey}
                onChange={event => handleProjectChange(event.target.value)}
                className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700 outline-none transition focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:focus:border-zinc-500 dark:focus:ring-zinc-800"
              >
                {projects.map(project => (
                  <option key={project.key} value={project.key}>
                    {project.name}
                  </option>
                ))}
              </select>

              <div className="flex gap-2">
                <button
                  onClick={() => handleStartCreate('context')}
                  className="inline-flex items-center gap-2 rounded-xl border border-cyan-200 bg-cyan-50 px-3 py-2 text-sm font-medium text-cyan-700 transition hover:border-cyan-300 hover:bg-cyan-100 dark:border-cyan-900/50 dark:bg-cyan-950/40 dark:text-cyan-300 dark:hover:bg-cyan-950/70"
                >
                  <Plus className="h-4 w-4" />
                  New Context
                </button>
                <button
                  onClick={() => handleStartCreate('design_doc')}
                  className="inline-flex items-center gap-2 rounded-xl bg-zinc-950 px-3 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                >
                  <FileText className="h-4 w-4" />
                  New Design Doc
                </button>
              </div>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded-2xl border border-zinc-200 bg-zinc-50/80 p-4 dark:border-zinc-800 dark:bg-zinc-900/70">
              <div className="text-xs font-medium uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-400">Assets</div>
              <div className="mt-2 text-3xl font-semibold text-zinc-950 dark:text-zinc-50">{assets.length}</div>
              <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">All stored knowledge objects for this project view.</div>
            </div>
            <div className="rounded-2xl border border-amber-200 bg-amber-50/80 p-4 dark:border-amber-900/40 dark:bg-amber-950/30">
              <div className="text-xs font-medium uppercase tracking-[0.2em] text-amber-700 dark:text-amber-300">Drafts</div>
              <div className="mt-2 text-3xl font-semibold text-zinc-950 dark:text-zinc-50">{totalDrafts}</div>
              <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Pending AI-produced knowledge waiting to be promoted.</div>
            </div>
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/80 p-4 dark:border-emerald-900/40 dark:bg-emerald-950/30">
              <div className="text-xs font-medium uppercase tracking-[0.2em] text-emerald-700 dark:text-emerald-300">Collections</div>
              <div className="mt-2 text-3xl font-semibold text-zinc-950 dark:text-zinc-50">{collectionCounts.length}</div>
              <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">User-defined groupings span across both storage systems.</div>
            </div>
            <div className="rounded-2xl border border-blue-200 bg-blue-50/80 p-4 dark:border-blue-900/40 dark:bg-blue-950/30">
              <div className="text-xs font-medium uppercase tracking-[0.2em] text-blue-700 dark:text-blue-300">Global Reach</div>
              <div className="mt-2 text-3xl font-semibold text-zinc-950 dark:text-zinc-50">{totalGlobals}</div>
              <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Shared assets that remain visible across projects.</div>
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-200 bg-zinc-50/70 p-4 dark:border-zinc-800 dark:bg-zinc-900/70">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
              <label className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                <input
                  value={search}
                  onChange={event => setSearch(event.target.value)}
                  placeholder="Search titles, descriptions, collections, tags, and file names..."
                  className="w-full rounded-xl border border-zinc-200 bg-white py-2 pl-9 pr-3 text-sm text-zinc-700 outline-none transition focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:focus:border-zinc-500 dark:focus:ring-zinc-800"
                />
              </label>

              <div className="flex flex-wrap gap-2">
                {([
                  ['all', 'All'],
                  ['context', 'Context'],
                  ['design_doc', 'Design Docs'],
                  ['draft', 'AI Drafts'],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    onClick={() => setSystemFilter(value)}
                    className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                      systemFilter === value
                        ? 'bg-zinc-950 text-white dark:bg-zinc-100 dark:text-zinc-900'
                        : 'border border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <button
                onClick={clearFilters}
                className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-500 transition hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Reset filters
              </button>
            </div>
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="space-y-4">
            <div className="rounded-3xl border border-zinc-200 bg-white/90 p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950/90">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                <FolderTree className="h-4 w-4 text-zinc-400" />
                Library Facets
              </div>

              <div className="space-y-3">
                <div>
                  <div className="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-zinc-400">Scope</div>
                  <div className="flex flex-wrap gap-2">
                    {([
                      ['all', 'All'],
                      ['project', 'Project'],
                      ['global', 'Global'],
                    ] as const).map(([value, label]) => (
                      <button
                        key={value}
                        onClick={() => setScopeFilter(value)}
                        className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                          scopeFilter === value
                            ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                            : 'border border-zinc-200 bg-zinc-50 text-zinc-500 hover:border-zinc-300 hover:text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-zinc-400">Lifecycle</div>
                  <div className="flex flex-wrap gap-2">
                    {([
                      ['all', 'All'],
                      ['active', 'Active'],
                      ['draft', 'Draft'],
                      ['deprecated', 'Deprecated'],
                    ] as const).map(([value, label]) => (
                      <button
                        key={value}
                        onClick={() => setStatusFilter(value)}
                        className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                          statusFilter === value
                            ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                            : 'border border-zinc-200 bg-zinc-50 text-zinc-500 hover:border-zinc-300 hover:text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-3xl border border-zinc-200 bg-white/90 p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950/90">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                <FolderOpen className="h-4 w-4 text-zinc-400" />
                Custom Collections
              </div>
              <div className="space-y-2">
                <button
                  onClick={() => setCollectionFilter('all')}
                  className={`flex w-full items-center justify-between rounded-2xl px-3 py-2 text-left text-sm transition ${
                    collectionFilter === 'all'
                      ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
                      : 'text-zinc-500 hover:bg-zinc-50 hover:text-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900'
                  }`}
                >
                  <span>All collections</span>
                  <span className="text-xs text-zinc-400">{assets.length}</span>
                </button>
                {collectionCounts.length === 0 ? (
                  <p className="rounded-2xl border border-dashed border-zinc-200 px-3 py-4 text-xs leading-5 text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                    Collections come from design doc categories and context groups. Create or rename them in the editor.
                  </p>
                ) : (
                  collectionCounts.map(collection => (
                    <button
                      key={collection.name}
                      onClick={() => setCollectionFilter(collection.name)}
                      className={`flex w-full items-center justify-between rounded-2xl px-3 py-2 text-left text-sm transition ${
                        collectionFilter === collection.name
                          ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
                          : 'text-zinc-500 hover:bg-zinc-50 hover:text-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900'
                      }`}
                    >
                      <span className="truncate">{collection.name}</span>
                      <span className="ml-3 shrink-0 text-xs text-zinc-400">{collection.count}</span>
                    </button>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-3xl border border-zinc-200 bg-white/90 p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950/90">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                <Tags className="h-4 w-4 text-zinc-400" />
                Tags
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setTagFilter('all')}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                    tagFilter === 'all'
                      ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                      : 'border border-zinc-200 bg-zinc-50 text-zinc-500 hover:border-zinc-300 hover:text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100'
                  }`}
                >
                  All tags
                </button>
                {tagCounts.length === 0 ? (
                  <p className="w-full rounded-2xl border border-dashed border-zinc-200 px-3 py-4 text-xs leading-5 text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                    Tags are optional, but they are the main customization layer once the library grows beyond system defaults.
                  </p>
                ) : (
                  tagCounts.map(tag => (
                    <button
                      key={tag.name}
                      onClick={() => setTagFilter(tag.name)}
                      className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                        tagFilter === tag.name
                          ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                          : 'border border-zinc-200 bg-zinc-50 text-zinc-500 hover:border-zinc-300 hover:text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100'
                      }`}
                    >
                      {tag.name} · {tag.count}
                    </button>
                  ))
                )}
              </div>
            </div>
          </aside>

          <section className="space-y-6">
            <div className="rounded-3xl border border-zinc-200 bg-white/90 p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950/90">
              <div className="mb-4 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Current result set</div>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">
                    {filteredAssets.length} asset{filteredAssets.length === 1 ? '' : 's'} match the current filters.
                  </p>
                </div>
                <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
                  System type is just storage. Collection, tags, scope, and lifecycle define the information architecture.
                </div>
              </div>

              {loading ? (
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {Array.from({ length: 6 }).map((_, index) => (
                    <div key={index} className="h-44 animate-pulse rounded-3xl border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900" />
                  ))}
                </div>
              ) : filteredAssets.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-zinc-200 px-6 py-16 text-center dark:border-zinc-800">
                  <Sparkles className="mb-4 h-8 w-8 text-zinc-300 dark:text-zinc-700" />
                  <div className="text-lg font-medium text-zinc-900 dark:text-zinc-100">No assets match this view.</div>
                  <p className="mt-2 max-w-xl text-sm leading-6 text-zinc-500 dark:text-zinc-400">
                    Try relaxing filters, or create the first context entry or design doc in the structure you want to establish.
                  </p>
                </div>
              ) : (
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {filteredAssets.map(asset => (
                    <button
                      key={asset.id}
                      onClick={() => handleSelectAsset(asset)}
                      className={`group rounded-3xl border p-4 text-left transition ${
                        selectedAssetId === asset.id
                          ? 'border-zinc-900 bg-zinc-950 text-white shadow-lg shadow-zinc-950/10 dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
                          : 'border-zinc-200 bg-white hover:-translate-y-0.5 hover:border-zinc-300 hover:shadow-sm dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-700'
                      }`}
                    >
                      <div className="mb-4 flex items-start justify-between gap-3">
                        <div className={`rounded-2xl border px-2.5 py-1 text-[11px] font-medium ${getAssetTypeClasses(asset)}`}>
                          {getAssetTypeLabel(asset)}
                        </div>
                        <div className={`rounded-full border px-2 py-1 text-[10px] font-medium ${getStatusClasses(asset.status)}`}>
                          {asset.status}
                        </div>
                      </div>

                      <div className={`line-clamp-2 text-base font-semibold ${
                        selectedAssetId === asset.id ? 'text-white dark:text-zinc-900' : 'text-zinc-950 dark:text-zinc-50'
                      }`}>
                        {asset.title}
                      </div>

                      <p className={`mt-2 line-clamp-3 text-sm leading-6 ${
                        selectedAssetId === asset.id ? 'text-zinc-200 dark:text-zinc-700' : 'text-zinc-600 dark:text-zinc-400'
                      }`}>
                        {asset.description || 'No description yet.'}
                      </p>

                      <div className={`mt-4 flex flex-wrap gap-2 text-[11px] ${
                        selectedAssetId === asset.id ? 'text-zinc-300 dark:text-zinc-600' : 'text-zinc-500 dark:text-zinc-400'
                      }`}>
                        {asset.collection ? (
                          <span className="rounded-full border border-current/20 px-2 py-1">
                            {asset.collection}
                          </span>
                        ) : null}
                        <span className="rounded-full border border-current/20 px-2 py-1">
                          {asset.scope === 'global' ? 'Global' : 'Project'}
                        </span>
                        <span className="rounded-full border border-current/20 px-2 py-1">
                          {asset.fileName}
                        </span>
                      </div>

                      {asset.tags.length > 0 ? (
                        <div className={`mt-4 flex flex-wrap gap-1.5 text-[11px] ${
                          selectedAssetId === asset.id ? 'text-zinc-300 dark:text-zinc-600' : 'text-zinc-500 dark:text-zinc-400'
                        }`}>
                          {asset.tags.slice(0, 4).map(tag => (
                            <span key={tag} className="rounded-full bg-current/8 px-2 py-1">
                              #{tag}
                            </span>
                          ))}
                        </div>
                      ) : null}

                      <div className={`mt-5 flex items-center gap-2 text-xs ${
                        selectedAssetId === asset.id ? 'text-zinc-300 dark:text-zinc-600' : 'text-zinc-400 dark:text-zinc-500'
                      }`}>
                        <Clock className="h-3.5 w-3.5" />
                        Updated {formatDateTime(asset.updatedAt)}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {(editorMode || selectedAsset) && (
              <div className="rounded-3xl border border-zinc-200 bg-white/95 shadow-sm dark:border-zinc-800 dark:bg-zinc-950/95">
                <div className="flex flex-col gap-3 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <div className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">
                      {editorMode === 'create' ? 'Create asset' : 'Edit asset'}
                    </div>
                    <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                      Use system type for storage behavior. Use collection and tags to define the library structure users actually navigate.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {selectedAsset ? (
                      <>
                        <span className={`rounded-full border px-3 py-1 text-xs font-medium ${getAssetTypeClasses(selectedAsset)}`}>
                          {getAssetTypeLabel(selectedAsset)}
                        </span>
                        <span className={`rounded-full border px-3 py-1 text-xs font-medium ${getStatusClasses(selectedAsset.status)}`}>
                          {selectedAsset.status}
                        </span>
                      </>
                    ) : null}
                    {editorMode === 'edit' ? (
                      <button
                        onClick={handleDelete}
                        disabled={deleting}
                        className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 transition hover:border-red-300 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300"
                      >
                        <Trash2 className="h-4 w-4" />
                        {deleting ? 'Deleting...' : 'Delete'}
                      </button>
                    ) : null}
                    <button
                      onClick={handleCloseEditor}
                      className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-600 transition hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
                    >
                      <X className="h-4 w-4" />
                      Close
                    </button>
                  </div>
                </div>

                <div className="space-y-5 px-5 py-5">
                  <div className="flex flex-wrap gap-2">
                    {([
                      ['context', 'Context Asset'],
                      ['design_doc', 'Design Doc'],
                    ] as const).map(([value, label]) => (
                      <button
                        key={value}
                        disabled={editorMode === 'edit'}
                        onClick={() => {
                          const nextForm = createDefaultEditor(value);
                          setForm(nextForm);
                          setOriginalForm(nextForm);
                        }}
                        className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                          form.kind === value
                            ? 'bg-zinc-950 text-white dark:bg-zinc-100 dark:text-zinc-900'
                            : 'border border-zinc-200 bg-white text-zinc-500 hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800'
                        } ${editorMode === 'edit' ? 'cursor-not-allowed opacity-60' : ''}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  {editorLoading ? (
                    <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-10 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
                      Loading asset content...
                    </div>
                  ) : (
                    <>
                      <div className="grid gap-4 lg:grid-cols-2">
                        <div>
                          <label className="mb-2 block text-xs font-medium uppercase tracking-[0.18em] text-zinc-400">Title</label>
                          <input
                            autoFocus
                            value={form.title}
                            onChange={event => setForm(previous => ({ ...previous, title: event.target.value }))}
                            placeholder={form.kind === 'design_doc' ? 'Agent architecture review' : 'Shared auth context'}
                            className="w-full rounded-2xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-700 outline-none transition focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:focus:border-zinc-500 dark:focus:ring-zinc-800"
                          />
                        </div>
                        <div>
                          <label className="mb-2 block text-xs font-medium uppercase tracking-[0.18em] text-zinc-400">Collection / Group</label>
                          <input
                            value={form.collection}
                            onChange={event => setForm(previous => ({ ...previous, collection: event.target.value }))}
                            placeholder={form.kind === 'design_doc' ? 'Architecture' : 'User Memory'}
                            list="knowledge-asset-collections"
                            className="w-full rounded-2xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-700 outline-none transition focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:focus:border-zinc-500 dark:focus:ring-zinc-800"
                          />
                          <datalist id="knowledge-asset-collections">
                            {collectionCounts.map(collection => (
                              <option key={collection.name} value={collection.name} />
                            ))}
                          </datalist>
                        </div>
                      </div>

                      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                        <div>
                          <label className="mb-2 block text-xs font-medium uppercase tracking-[0.18em] text-zinc-400">Description</label>
                          <input
                            value={form.description}
                            onChange={event => setForm(previous => ({ ...previous, description: event.target.value }))}
                            placeholder="Explain what this asset is for and when an agent or user should open it."
                            className="w-full rounded-2xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-700 outline-none transition focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:focus:border-zinc-500 dark:focus:ring-zinc-800"
                          />
                        </div>
                        <div>
                          <label className="mb-2 block text-xs font-medium uppercase tracking-[0.18em] text-zinc-400">Tags</label>
                          <input
                            value={form.tagsInput}
                            onChange={event => setForm(previous => ({ ...previous, tagsInput: event.target.value }))}
                            placeholder="agent, auth, planning"
                            className="w-full rounded-2xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-700 outline-none transition focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:focus:border-zinc-500 dark:focus:ring-zinc-800"
                          />
                        </div>
                      </div>

                      <div className="grid gap-4 lg:grid-cols-2">
                        <div>
                          <label className="mb-2 block text-xs font-medium uppercase tracking-[0.18em] text-zinc-400">Lifecycle</label>
                          <div className="flex flex-wrap gap-2">
                            {([
                              ['active', 'Active'],
                              ['draft', 'Draft'],
                              ['deprecated', 'Deprecated'],
                            ] as const).map(([value, label]) => (
                              <button
                                key={value}
                                onClick={() => setForm(previous => ({ ...previous, status: value }))}
                                className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                                  form.status === value
                                    ? 'bg-zinc-950 text-white dark:bg-zinc-100 dark:text-zinc-900'
                                    : 'border border-zinc-200 bg-white text-zinc-500 hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800'
                                }`}
                              >
                                {label}
                              </button>
                            ))}
                          </div>
                        </div>

                        {form.kind === 'context' ? (
                          <div>
                            <label className="mb-2 block text-xs font-medium uppercase tracking-[0.18em] text-zinc-400">Scope</label>
                            <div className="flex flex-wrap gap-2">
                              {([
                                ['project', 'Project-scoped'],
                                ['global', 'Global'],
                              ] as const).map(([value, label]) => (
                                <button
                                  key={value}
                                  onClick={() => setForm(previous => ({ ...previous, scope: value }))}
                                  className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                                    form.scope === value
                                      ? 'bg-zinc-950 text-white dark:bg-zinc-100 dark:text-zinc-900'
                                      : 'border border-zinc-200 bg-white text-zinc-500 hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800'
                                  }`}
                                >
                                  {label}
                                </button>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-3 py-3 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
                            Design docs remain project-scoped, but the collection and tag layers stay fully customizable.
                          </div>
                        )}
                      </div>

                      {form.kind === 'context' ? (
                        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
                          <div>
                            <label className="mb-2 block text-xs font-medium uppercase tracking-[0.18em] text-zinc-400">File Name</label>
                            <input
                              value={form.fileName}
                              onChange={event => setForm(previous => ({ ...previous, fileName: event.target.value }))}
                              placeholder="knowledge-asset.md"
                              className="w-full rounded-2xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-700 outline-none transition focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:focus:border-zinc-500 dark:focus:ring-zinc-800"
                            />
                          </div>

                          <div>
                            <label className="mb-2 block text-xs font-medium uppercase tracking-[0.18em] text-zinc-400">Format</label>
                            <div className="flex gap-2">
                              {(['markdown', 'json', 'text'] as const).map(value => (
                                <button
                                  key={value}
                                  onClick={() => setForm(previous => ({ ...previous, format: value }))}
                                  className={`rounded-full px-3 py-1.5 text-xs font-medium uppercase transition ${
                                    form.format === value
                                      ? 'bg-zinc-950 text-white dark:bg-zinc-100 dark:text-zinc-900'
                                      : 'border border-zinc-200 bg-white text-zinc-500 hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800'
                                  }`}
                                >
                                  {value}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      ) : null}

                      {form.kind === 'context' ? (
                        <div>
                          <label className="mb-2 block text-xs font-medium uppercase tracking-[0.18em] text-zinc-400">External Source Path</label>
                          <div className="flex items-start gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 px-3 py-3 dark:border-zinc-800 dark:bg-zinc-900">
                            <Globe className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" />
                            <div className="min-w-0 flex-1">
                              <input
                                value={form.sourcePath}
                                onChange={event => setForm(previous => ({ ...previous, sourcePath: event.target.value }))}
                                placeholder="Optional absolute source path if the asset should reference an external file."
                                className="w-full bg-transparent text-sm text-zinc-700 outline-none placeholder:text-zinc-400 dark:text-zinc-200"
                              />
                              <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                                Leave blank to keep this asset fully managed by the knowledge center.
                              </p>
                            </div>
                          </div>
                        </div>
                      ) : null}

                      <div>
                        <label className="mb-2 block text-xs font-medium uppercase tracking-[0.18em] text-zinc-400">Content</label>
                        <textarea
                          value={form.content}
                          onChange={event => setForm(previous => ({ ...previous, content: event.target.value }))}
                          rows={18}
                          placeholder={form.kind === 'design_doc'
                            ? '# Design decision\n\nExplain the decision, why it exists, and what it changes.'
                            : '# Shared knowledge\n\nCapture reusable context, patterns, or memory for agents and users.'}
                          className="w-full resize-y rounded-3xl border border-zinc-200 bg-white px-4 py-3 font-mono text-sm leading-6 text-zinc-700 outline-none transition focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:focus:border-zinc-500 dark:focus:ring-zinc-800"
                        />
                      </div>

                      <div className="flex flex-col gap-3 rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400 lg:flex-row lg:items-center lg:justify-between">
                        <div className="flex items-start gap-3">
                          {form.kind === 'design_doc' ? (
                            <BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" />
                          ) : (
                            <Bot className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" />
                          )}
                          <div>
                            <div className="font-medium text-zinc-700 dark:text-zinc-200">Structure should be authored here, not in navigation.</div>
                            <p className="mt-1 text-sm leading-6">
                              Use collection and tags to express the user's mental model. Keep system types as storage mechanics only.
                            </p>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={handleCloseEditor}
                            className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-600 transition hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-800"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={handleSave}
                            disabled={!form.title.trim() || saving || !hasChanges}
                            className="rounded-xl bg-zinc-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                          >
                            {saving ? 'Saving...' : editorMode === 'create' ? 'Create Asset' : 'Save Changes'}
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
