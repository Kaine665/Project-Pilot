'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import {
  BookOpen,
  ChevronDown,
  Edit3,
  Eye,
  FileText,
  Globe,
  Layers3,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { useRouter } from '@/client/i18n/routing';
import { useProject } from '@/components/project-context';
import type { ContextEntry, DocEntry, DocStatus } from '@/types';

type AssetType = 'doc' | 'context';
type Scope = 'project' | 'global';
type Status = 'active' | 'draft' | 'deprecated';
type RailKey = 'scope' | 'type' | 'tag' | null;
type DetailMode = 'idle' | 'preview' | 'create-doc' | 'create-context' | 'edit-doc' | 'edit-context';

type Asset = {
  id: string;
  type: AssetType;
  title: string;
  description: string;
  scope: Scope;
  status: Status;
  projectKey?: string;
  tags: string[];
  meta?: string;
  createdAt: string;
  updatedAt: string;
};

type TagFacet = {
  value: string;
  assetIds: string[];
};

type DocForm = {
  title: string;
  description: string;
  category: string;
  tags: string;
  status: Status;
  content: string;
};

type ContextForm = {
  label: string;
  description: string;
  fileName: string;
  format: ContextEntry['format'];
  group: string;
  sourcePath: string;
  tags: string;
  status: 'active' | 'draft';
  content: string;
};

const EMPTY_DOC: DocForm = {
  title: '',
  description: '',
  category: '',
  tags: '',
  status: 'active',
  content: '',
};

const EMPTY_CONTEXT: ContextForm = {
  label: '',
  description: '',
  fileName: '',
  format: 'markdown',
  group: '',
  sourcePath: '',
  tags: '',
  status: 'active',
  content: '',
};

const tagsToArray = (value: string) =>
  value
    .split(',')
    .map(v => v.trim())
    .filter(Boolean);

const fmt = (iso: string) =>
  new Date(iso).toLocaleString('zh-CN', {
    hour12: false,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

const slug = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || `asset-${Date.now()}`;

const formatToExtension = (format: ContextEntry['format']) => (format === 'markdown' ? 'md' : format === 'json' ? 'json' : 'txt');

const withFormatExtension = (fileName: string, label: string, format: ContextEntry['format']) => {
  const trimmed = fileName.trim();
  const base = (trimmed || slug(label)).replace(/\.[^./\\]+$/, '');
  return `${base}.${formatToExtension(format)}`;
};

function parseScope(value: string | null): Scope {
  return value === 'global' ? 'global' : 'project';
}

function parseType(scope: Scope, typeValue: string | null, legacyViewValue: string | null): AssetType {
  const raw = typeValue ?? (legacyViewValue === 'context' ? 'context' : legacyViewValue === 'docs' ? 'doc' : 'doc');
  if (scope === 'global') return 'context';
  return raw === 'context' ? 'context' : 'doc';
}

function parseTagValue(value: string | null): string | null {
  if (!value) return null;
  const first = value
    .split(',')
    .map(v => v.trim())
    .find(Boolean);
  return first ?? null;
}

function getDisplayType(assetType: AssetType): string {
  return assetType === 'doc' ? '设计文档' : '上下文';
}

function getDisplayScope(scope: Scope): string {
  return scope === 'global' ? '全局' : '项目';
}

function getStatusText(status: Status | 'active' | 'draft'): string {
  if (status === 'draft') return '草稿';
  if (status === 'deprecated') return '已废弃';
  return '生效中';
}

function getQueryString({
  scope,
  type,
  query,
  tag,
  assetId,
  mode,
}: {
  scope: Scope;
  type: AssetType;
  query: string;
  tag: string | null;
  assetId: string | null;
  mode?: 'preview' | 'edit';
}) {
  const params = new URLSearchParams();
  params.set('scope', scope);
  params.set('type', type);
  if (query.trim()) params.set('q', query.trim());
  if (tag) params.set('tags', tag);
  if (assetId) params.set('asset', assetId);
  if (assetId && mode) params.set('mode', mode);
  return params.toString();
}

function fromDoc(entry: DocEntry): Asset {
  return {
    id: entry.id,
    type: 'doc',
    title: entry.title,
    description: entry.description ?? '',
    scope: 'project',
    status: entry.status ?? 'active',
    projectKey: entry.projectKey,
    tags: entry.tags ?? [],
    meta: entry.category,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}

function fromContext(entry: ContextEntry): Asset {
  return {
    id: entry.id,
    type: 'context',
    title: entry.label,
    description: entry.description,
    scope: entry.projectKey ? 'project' : 'global',
    status: entry.status === 'draft' ? 'draft' : 'active',
    projectKey: entry.projectKey,
    tags: entry.tags ?? [],
    meta: entry.group ?? entry.format.toUpperCase(),
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}

function PreviewBlock({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="rounded-2xl border border-zinc-200 bg-zinc-50/70 p-4 dark:border-zinc-800 dark:bg-zinc-900/60">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">{label}</div>
      <div className="text-sm leading-6 text-zinc-700 dark:text-zinc-300">{value}</div>
    </div>
  );
}

export default function DocsProjectPage() {
  const params = useParams();
  const [searchParams] = useSearchParams();
  const searchParamsKey = searchParams.toString();
  const projectKey = params.projectKey as string;
  const router = useRouter();
  const { activeKey, setActiveKey } = useProject();
  const loadRequestRef = useRef(0);

  const [projects, setProjects] = useState<Array<{ key: string; name: string }>>([]);
  const [docs, setDocs] = useState<DocEntry[]>([]);
  const [contexts, setContexts] = useState<ContextEntry[]>([]);
  const [scope, setScope] = useState<Scope>(() => parseScope(searchParams.get('scope')));
  const [assetType, setAssetType] = useState<AssetType>(() => parseType(parseScope(searchParams.get('scope')), searchParams.get('type'), searchParams.get('view')));
  const [selectedTag, setSelectedTag] = useState<string | null>(() => parseTagValue(searchParams.get('tags')));
  const [query, setQuery] = useState(() => searchParams.get('q') ?? '');
  const [expandedRail, setExpandedRail] = useState<RailKey>(null);
  const [selected, setSelected] = useState<Asset | null>(null);
  const [mode, setMode] = useState<DetailMode>('idle');
  const [docForm, setDocForm] = useState<DocForm>(EMPTY_DOC);
  const [contextForm, setContextForm] = useState<ContextForm>(EMPTY_CONTEXT);
  const [docBase, setDocBase] = useState<DocForm>(EMPTY_DOC);
  const [contextBase, setContextBase] = useState<ContextForm>(EMPTY_CONTEXT);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (projectKey && projectKey !== activeKey) setActiveKey(projectKey);
  }, [projectKey, activeKey, setActiveKey]);

  useEffect(() => {
    const nextScope = parseScope(searchParams.get('scope'));
    const nextType = parseType(nextScope, searchParams.get('type'), searchParams.get('view'));
    const nextTag = parseTagValue(searchParams.get('tags'));
    const nextQuery = searchParams.get('q') ?? '';
    setScope(prev => (prev === nextScope ? prev : nextScope));
    setAssetType(prev => (prev === nextType ? prev : nextType));
    setSelectedTag(prev => (prev === nextTag ? prev : nextTag));
    setQuery(prev => (prev === nextQuery ? prev : nextQuery));
  }, [searchParamsKey, searchParams]);

  useEffect(() => {
    if (scope === 'global' && assetType === 'doc') {
      setAssetType('context');
    }
  }, [scope, assetType]);

  const fetchProjects = useCallback(async () => {
    const res = await fetch('/api/data/projects');
    const data = await res.json();
    setProjects(
      (data.projects ?? [])
        .filter((project: { archived?: boolean }) => !project.archived)
        .map((project: { key: string; name: string }) => ({ key: project.key, name: project.name })),
    );
  }, []);

  const fetchAssets = useCallback(async () => {
    const [docsRes, ctxRes] = await Promise.all([
      fetch(`/api/docs?project=${encodeURIComponent(projectKey)}`),
      fetch(`/api/context?projectKey=${encodeURIComponent(projectKey)}`),
    ]);
    const docsData = await docsRes.json();
    const ctxData = await ctxRes.json();
    setDocs(docsData.docs ?? []);
    setContexts(ctxData.entries ?? []);
  }, [projectKey]);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  useEffect(() => {
    fetchAssets();
  }, [fetchAssets]);

  useEffect(() => {
    const heading = document.querySelector('main h1');
    if (heading) {
      heading.textContent = '文档库';
    }
  });

  const assets = useMemo(
    () => [...docs.map(fromDoc), ...contexts.map(fromContext)].sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt)),
    [docs, contexts],
  );

  const stats = useMemo(
    () => ({
      total: assets.length,
      docs: assets.filter(asset => asset.type === 'doc').length,
      context: assets.filter(asset => asset.type === 'context').length,
      global: assets.filter(asset => asset.scope === 'global').length,
    }),
    [assets],
  );

  const assetsInRail = useMemo(
    () => assets.filter(asset => asset.scope === scope && asset.type === assetType),
    [assets, scope, assetType],
  );

  const tagFacets = useMemo<TagFacet[]>(() => {
    const map = new Map<string, Set<string>>();
    for (const asset of assetsInRail) {
      for (const tag of asset.tags) {
        if (!map.has(tag)) map.set(tag, new Set());
        map.get(tag)?.add(asset.id);
      }
    }

    return Array.from(map.entries())
      .map(([value, ids]) => ({ value, assetIds: Array.from(ids) }))
      .sort((a, b) => a.value.localeCompare(b.value, 'zh-CN'));
  }, [assetsInRail]);

  useEffect(() => {
    if (selectedTag && !tagFacets.some(tag => tag.value === selectedTag)) {
      setSelectedTag(null);
    }
  }, [selectedTag, tagFacets]);

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return assetsInRail.filter(asset => {
      if (selectedTag && !asset.tags.includes(selectedTag)) return false;
      if (!normalizedQuery) return true;
      return [asset.title, asset.description, asset.meta, ...asset.tags]
        .filter(Boolean)
        .some(value => value!.toLowerCase().includes(normalizedQuery));
    });
  }, [assetsInRail, query, selectedTag]);

  const matchesActiveFilters = useCallback(
    (asset: Asset) => asset.scope === scope && asset.type === assetType && (!selectedTag || asset.tags.includes(selectedTag)),
    [assetType, scope, selectedTag],
  );

  const dirty =
    mode === 'create-doc' || mode === 'edit-doc'
      ? JSON.stringify(docForm) !== JSON.stringify(docBase)
      : mode === 'create-context' || mode === 'edit-context'
        ? JSON.stringify(contextForm) !== JSON.stringify(contextBase)
        : false;

  const confirmDiscardIfDirty = useCallback(() => {
    if (!dirty) return true;
    return window.confirm('当前有未保存的内容，继续操作会丢失修改。确定继续吗？');
  }, [dirty]);

  const reset = useCallback(() => {
    loadRequestRef.current += 1;
    setSelected(null);
    setMode('idle');
    setExpandedRail(null);
    setDocForm(EMPTY_DOC);
    setContextForm(EMPTY_CONTEXT);
    setDocBase(EMPTY_DOC);
    setContextBase(EMPTY_CONTEXT);
  }, []);

  const load = useCallback(async (asset: Asset, nextMode: 'preview' | 'edit' = 'preview') => {
    const requestId = loadRequestRef.current + 1;
    loadRequestRef.current = requestId;
    setSelected(asset);
    if (asset.type === 'doc') {
      const res = await fetch(`/api/docs/${asset.id}`);
      const data = await res.json();
      if (loadRequestRef.current !== requestId) return;
      const next = {
        title: data.entry.title,
        description: data.entry.description ?? '',
        category: data.entry.category ?? '',
        tags: (data.entry.tags ?? []).join(', '),
        status: data.entry.status ?? 'active',
        content: data.content ?? '',
      };
      setDocForm(next);
      setDocBase(next);
      setMode(nextMode === 'edit' ? 'edit-doc' : 'preview');
      return;
    }

    const res = await fetch(`/api/context/${asset.id}`);
    const data = await res.json();
    if (loadRequestRef.current !== requestId) return;
    const next: ContextForm = {
      label: data.entry.label,
      description: data.entry.description,
      fileName: data.entry.fileName,
      format: data.entry.format,
      group: data.entry.group ?? '',
      sourcePath: data.entry.sourcePath ?? '',
      tags: (data.entry.tags ?? []).join(', '),
      status: data.entry.status === 'draft' ? 'draft' : 'active',
      content: data.content ?? '',
    };
    setContextForm(next);
    setContextBase(next);
    setMode(nextMode === 'edit' ? 'edit-context' : 'preview');
  }, []);

  const clearSelectedAsset = useCallback(() => {
    loadRequestRef.current += 1;
    setSelected(null);
    if (!mode.startsWith('create')) {
      setMode('idle');
    }
  }, [mode]);

  const replaceUrlState = useCallback(
    ({
      nextScope = scope,
      nextType = assetType,
      nextQuery = query,
      nextTag = selectedTag,
      nextAssetId = selected?.id ?? null,
      nextMode,
    }: {
      nextScope?: Scope;
      nextType?: AssetType;
      nextQuery?: string;
      nextTag?: string | null;
      nextAssetId?: string | null;
      nextMode?: 'preview' | 'edit';
    }) => {
      const nextQueryString = getQueryString({
        scope: nextScope,
        type: nextType,
        query: nextQuery,
        tag: nextTag,
        assetId: nextAssetId,
        mode: nextAssetId ? nextMode : undefined,
      });
      router.replace(`/flows/docs/${projectKey}${nextQueryString ? `?${nextQueryString}` : ''}`);
    },
    [assetType, projectKey, query, router, scope, selected?.id, selectedTag],
  );

  const startCreateDoc = useCallback(() => {
    if (!confirmDiscardIfDirty()) return;
    loadRequestRef.current += 1;
    setScope('project');
    setAssetType('doc');
    setSelectedTag(null);
    setExpandedRail(null);
    setSelected(null);
    setMode('create-doc');
    setDocForm(EMPTY_DOC);
    setDocBase(EMPTY_DOC);
    replaceUrlState({
      nextScope: 'project',
      nextType: 'doc',
      nextTag: null,
      nextAssetId: null,
    });
  }, [confirmDiscardIfDirty, replaceUrlState]);

  const startCreateContext = useCallback(() => {
    if (!confirmDiscardIfDirty()) return;
    loadRequestRef.current += 1;
    const nextScope = scope;
    setAssetType('context');
    setExpandedRail(null);
    setSelected(null);
    setMode('create-context');
    setContextForm({
      ...EMPTY_CONTEXT,
      fileName: withFormatExtension('', '', 'markdown'),
    });
    setContextBase(EMPTY_CONTEXT);
    replaceUrlState({
      nextScope,
      nextType: 'context',
      nextAssetId: null,
    });
  }, [confirmDiscardIfDirty, replaceUrlState, scope]);

  const openAsset = useCallback(
    (asset: Asset) => {
      if (!confirmDiscardIfDirty()) return;
      const nextScope = asset.scope;
      const nextType = asset.type;
      const nextTag = selectedTag && asset.tags.includes(selectedTag) ? selectedTag : null;

      setScope(nextScope);
      setAssetType(nextType);
      if (selectedTag && !asset.tags.includes(selectedTag)) {
        setSelectedTag(null);
      }
      setExpandedRail(null);

      replaceUrlState({
        nextScope,
        nextType,
        nextQuery: query,
        nextTag,
        nextAssetId: asset.id,
        nextMode: 'preview',
      });
    },
    [confirmDiscardIfDirty, query, replaceUrlState, selectedTag],
  );

  useEffect(() => {
    const selectedAssetId = searchParams.get('asset');
    const requestedMode = searchParams.get('mode') === 'edit' ? 'edit' : 'preview';

    if (!selectedAssetId) {
      if (selected && !mode.startsWith('create')) reset();
      return;
    }

    const asset = assets.find(item => item.id === selectedAssetId);
    if (!asset) {
      if (!mode.startsWith('create')) reset();
      return;
    }

    if (!matchesActiveFilters(asset)) {
      const nextQuery = getQueryString({
        scope,
        type: assetType,
        query,
        tag: selectedTag,
        assetId: null,
      });
      const currentQueryString = searchParams.toString();
      if (nextQuery !== currentQueryString) {
        router.replace(`/flows/docs/${projectKey}${nextQuery ? `?${nextQuery}` : ''}`);
      }
      if (selected?.id === asset.id && !mode.startsWith('create')) {
        clearSelectedAsset();
      }
      return;
    }

    const isSameAsset = selected?.id === asset.id;
    const isSameView =
      (requestedMode === 'preview' && mode === 'preview') ||
      (requestedMode === 'edit' && (mode === 'edit-doc' || mode === 'edit-context'));

    if (!isSameAsset || !isSameView) {
      void load(asset, requestedMode);
    }
  }, [assetType, assets, clearSelectedAsset, load, matchesActiveFilters, mode, projectKey, query, reset, router, scope, searchParams, selected, selectedTag]);

  useEffect(() => {
    const currentAssetId = searchParams.get('asset');
    // URL 已经切到新 asset，但本地 selected 还没跟上时，禁止把旧 selected 回写到 URL。
    if (currentAssetId && (!selected || currentAssetId !== selected.id)) {
      return;
    }

    const nextQueryString = getQueryString({
      scope,
      type: assetType,
      query,
      tag: selectedTag,
      assetId: currentAssetId ?? null,
      mode: currentAssetId ? (searchParams.get('mode') === 'edit' ? 'edit' : 'preview') : undefined,
    });
    const currentQueryString = searchParams.toString();
    if (nextQueryString !== currentQueryString) {
      router.replace(`/flows/docs/${projectKey}${nextQueryString ? `?${nextQueryString}` : ''}`);
    }
  }, [assetType, projectKey, query, router, scope, searchParams, selected, selectedTag]);

  const remove = async (asset: Asset) => {
    if (!window.confirm(`删除“${asset.title}”吗？`)) return;
    const res = await fetch(asset.type === 'doc' ? `/api/docs/${asset.id}` : `/api/context/${asset.id}`, { method: 'DELETE' });
    if (!res.ok) return;
    await fetchAssets();
    if (selected?.id === asset.id) reset();
  };

  const save = async () => {
    setSaving(true);
    try {
      if (mode === 'create-doc') {
        const res = await fetch('/api/docs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectKey,
            title: docForm.title.trim(),
            description: docForm.description.trim() || undefined,
            content: docForm.content,
            category: docForm.category.trim() || undefined,
            tags: tagsToArray(docForm.tags),
            status: docForm.status === 'active' ? undefined : docForm.status,
          }),
        });
        if (res.ok) {
          await fetchAssets();
          reset();
        }
      }

      if (mode === 'edit-doc' && selected) {
        const res = await fetch(`/api/docs/${selected.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: docForm.title.trim(),
            description: docForm.description.trim(),
            content: docForm.content,
            category: docForm.category.trim(),
            tags: tagsToArray(docForm.tags),
            status: docForm.status === 'active' ? undefined : docForm.status,
          }),
        });
        if (res.ok) {
          await fetchAssets();
          setDocBase(docForm);
        }
      }

      if (mode === 'create-context') {
        const fileName =
          contextForm.fileName.trim() ||
          `${slug(contextForm.label)}.${contextForm.format === 'markdown' ? 'md' : contextForm.format === 'json' ? 'json' : 'txt'}`;
        const payloadProjectKey = scope === 'global' ? undefined : projectKey;
        const res = await fetch('/api/context', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            label: contextForm.label.trim(),
            description: contextForm.description.trim(),
            fileName,
            format: contextForm.format,
            group: contextForm.group.trim() || undefined,
            sourcePath: contextForm.sourcePath.trim() || undefined,
            tags: tagsToArray(contextForm.tags),
            status: contextForm.status === 'draft' ? 'draft' : undefined,
            projectKey: payloadProjectKey,
            content: contextForm.content,
          }),
        });
        if (res.ok) {
          await fetchAssets();
          reset();
        }
      }

      if (mode === 'edit-context' && selected) {
        const payloadProjectKey = scope === 'global' ? undefined : projectKey;
        const res = await fetch(`/api/context/${selected.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            label: contextForm.label.trim(),
            description: contextForm.description.trim(),
            fileName: contextForm.fileName.trim(),
            format: contextForm.format,
            group: contextForm.group.trim(),
            sourcePath: contextForm.sourcePath.trim(),
            tags: tagsToArray(contextForm.tags),
            status: contextForm.status,
            projectKey: payloadProjectKey,
            content: contextForm.content,
          }),
        });
        if (res.ok) {
          await fetchAssets();
          setContextBase(contextForm);
        }
      }
    } finally {
      setSaving(false);
    }
  };

  const currentProjectName = projects.find(project => project.key === projectKey)?.name ?? projectKey;
  const canSave =
    mode === 'create-doc'
      ? !!docForm.title.trim()
      : mode === 'edit-doc'
        ? !!docForm.title.trim() && dirty
        : mode === 'create-context'
          ? !!contextForm.label.trim() && !!contextForm.fileName.trim()
          : mode === 'edit-context'
            ? !!contextForm.label.trim() && !!contextForm.fileName.trim() && dirty
            : false;

  const railScopeSummary = scope === 'project' ? '当前项目' : '全局资源';
  const railTypeSummary = assetType === 'doc' ? '设计文档' : '上下文资产';
  const railTagSummary = selectedTag ?? '全部标签';
  const projectContextCount = assets.filter(asset => asset.scope === 'project').length;
  const globalContextCount = stats.global;

  const previewTitle =
    selected?.type === 'doc'
      ? docForm.title || selected.title
      : selected?.type === 'context'
        ? contextForm.label || selected.title
        : '选择一条资产开始浏览';

  return (
    <div className="h-full overflow-y-auto bg-zinc-50/60">
      <div className="mx-auto flex max-w-[1480px] flex-col gap-3 px-6 py-4">
        <section className="relative z-40 rounded-2xl border border-zinc-200 bg-white/95 px-5 py-4 shadow-[0_8px_32px_-12px_rgba(15,23,42,0.12)] backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="max-w-3xl">
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-xs font-medium text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
                <Layers3 className="h-3.5 w-3.5" />
                文档工作台
              </div>
              <h1 className="text-[32px] font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">以三列选择组织项目知识</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500 dark:text-zinc-400">
                先确定范围，再切换类型，最后按标签收束结果。右侧保持预览优先，需要时再进入编辑。
              </p>
            </div>

            <div className="flex w-full max-w-[360px] flex-col gap-3">
              <select
                value={projectKey}
                onChange={event => {
                  if (!confirmDiscardIfDirty()) return;
                  const nextKey = event.target.value;
                  setActiveKey(nextKey);
                  const nextQuery = getQueryString({
                    scope,
                    type: assetType,
                    query,
                    tag: selectedTag,
                    assetId: null,
                  });
                  router.push(`/flows/docs/${nextKey}${nextQuery ? `?${nextQuery}` : ''}`);
                }}
                className="rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
              >
                {projects.map(project => (
                  <option key={project.key} value={project.key}>
                    {project.name}
                  </option>
                ))}
              </select>

              <div className="grid grid-cols-2 gap-2.5">
                <button
                  onClick={startCreateDoc}
                  className="rounded-xl bg-zinc-950 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200"
                >
                  <Plus className="mr-2 inline h-4 w-4" />
                  新建设计文档
                </button>
                <button
                  onClick={startCreateContext}
                  className="rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  <Plus className="mr-2 inline h-4 w-4" />
                  新建上下文
                </button>
              </div>
            </div>
          </div>

          <div className="mt-3 grid items-start gap-2.5 md:grid-cols-3">
            <div className={`relative rounded-2xl border border-zinc-200 bg-zinc-50/70 p-1 dark:border-zinc-800 dark:bg-zinc-900/80 ${expandedRail === 'scope' ? 'z-30' : 'z-10'}`}>
              <button
                onClick={() => setExpandedRail(prev => (prev === 'scope' ? null : 'scope'))}
                className="flex min-h-[62px] w-full items-center justify-between rounded-xl px-3 py-2 text-left"
              >
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">01 范围</div>
                  <div className="mt-1.5 text-[15px] font-medium text-zinc-900 dark:text-zinc-100">{railScopeSummary}</div>
                </div>
                <ChevronDown className={`h-4 w-4 text-zinc-400 transition ${expandedRail === 'scope' ? 'rotate-180' : ''}`} />
              </button>

              {expandedRail === 'scope' && (
                <div className="absolute left-0 top-[calc(100%+10px)] z-[80] w-full space-y-1 rounded-2xl border border-zinc-200 bg-white p-1.5 shadow-[0_18px_48px_-24px_rgba(15,23,42,0.4)] dark:border-zinc-800 dark:bg-zinc-950">
                  <button
                    onClick={() => {
                      if (!confirmDiscardIfDirty()) return;
                      clearSelectedAsset();
                      setScope('project');
                      setExpandedRail(null);
                    }}
                    className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition ${
                      scope === 'project'
                        ? 'bg-zinc-950 text-white dark:bg-zinc-100 dark:text-zinc-950'
                        : 'text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-900'
                    }`}
                  >
                    <span>当前项目</span>
                    <span className={`text-xs ${scope === 'project' ? 'text-zinc-300 dark:text-zinc-700' : 'text-zinc-400'}`}>
                      {projectContextCount}
                    </span>
                  </button>
                  <button
                    onClick={() => {
                      if (!confirmDiscardIfDirty()) return;
                      clearSelectedAsset();
                      setScope('global');
                      setExpandedRail(null);
                    }}
                    className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition ${
                      scope === 'global'
                        ? 'bg-zinc-950 text-white dark:bg-zinc-100 dark:text-zinc-950'
                        : 'text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-900'
                    }`}
                  >
                    <span>全局资源</span>
                    <span className={`text-xs ${scope === 'global' ? 'text-zinc-300 dark:text-zinc-700' : 'text-zinc-400'}`}>
                      {globalContextCount}
                    </span>
                  </button>
                </div>
              )}
            </div>

            <div className={`relative rounded-2xl border border-zinc-200 bg-zinc-50/70 p-1 dark:border-zinc-800 dark:bg-zinc-900/80 ${expandedRail === 'type' ? 'z-30' : 'z-20'}`}>
              <button
                onClick={() => setExpandedRail(prev => (prev === 'type' ? null : 'type'))}
                className="flex min-h-[62px] w-full items-center justify-between rounded-xl px-3 py-2 text-left"
              >
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">02 类型</div>
                  <div className="mt-1.5 text-[15px] font-medium text-zinc-900 dark:text-zinc-100">{railTypeSummary}</div>
                </div>
                <ChevronDown className={`h-4 w-4 text-zinc-400 transition ${expandedRail === 'type' ? 'rotate-180' : ''}`} />
              </button>

              {expandedRail === 'type' && (
                <div className="absolute left-0 top-[calc(100%+10px)] z-[80] w-full space-y-1 rounded-2xl border border-zinc-200 bg-white p-1.5 shadow-[0_18px_48px_-24px_rgba(15,23,42,0.4)] dark:border-zinc-800 dark:bg-zinc-950">
                  <button
                    onClick={() => {
                      if (!confirmDiscardIfDirty()) return;
                      clearSelectedAsset();
                      setAssetType('context');
                      setExpandedRail(null);
                    }}
                    className={`flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm transition ${
                      assetType === 'context'
                        ? 'bg-zinc-950 text-white dark:bg-zinc-100 dark:text-zinc-950'
                        : 'text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-900'
                    }`}
                  >
                    <BookOpen className="h-4 w-4" />
                    上下文资产
                  </button>
                  <button
                    disabled={scope === 'global'}
                    onClick={() => {
                      if (scope === 'global') return;
                      if (!confirmDiscardIfDirty()) return;
                      clearSelectedAsset();
                      setAssetType('doc');
                      setExpandedRail(null);
                    }}
                    className={`flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm transition ${
                      scope === 'global'
                        ? 'cursor-not-allowed bg-zinc-100 text-zinc-400 dark:bg-zinc-900 dark:text-zinc-600'
                        : assetType === 'doc'
                          ? 'bg-zinc-950 text-white dark:bg-zinc-100 dark:text-zinc-950'
                          : 'text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-900'
                    }`}
                  >
                    <FileText className="h-4 w-4" />
                    设计文档
                    {scope === 'global' && <span className="ml-auto text-[11px]">仅项目可用</span>}
                  </button>
                </div>
              )}
            </div>

            <div className={`relative rounded-2xl border border-zinc-200 bg-zinc-50/70 p-1 dark:border-zinc-800 dark:bg-zinc-900/80 ${expandedRail === 'tag' ? 'z-30' : 'z-10'}`}>
              <button
                onClick={() => setExpandedRail(prev => (prev === 'tag' ? null : 'tag'))}
                className="flex min-h-[62px] w-full items-center justify-between rounded-xl px-3 py-2 text-left"
              >
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">03 标签</div>
                  <div className="mt-1.5 text-[15px] font-medium text-zinc-900 dark:text-zinc-100">{railTagSummary}</div>
                </div>
                <ChevronDown className={`h-4 w-4 text-zinc-400 transition ${expandedRail === 'tag' ? 'rotate-180' : ''}`} />
              </button>

              {expandedRail === 'tag' && (
                <div className="absolute left-0 top-[calc(100%+10px)] z-[80] max-h-72 w-full space-y-1 overflow-y-auto rounded-2xl border border-zinc-200 bg-white p-1.5 shadow-[0_18px_48px_-24px_rgba(15,23,42,0.4)] dark:border-zinc-800 dark:bg-zinc-950">
                  <button
                    onClick={() => {
                      if (!confirmDiscardIfDirty()) return;
                      clearSelectedAsset();
                      setSelectedTag(null);
                      setExpandedRail(null);
                    }}
                    className={`flex w-full items-center rounded-xl px-3 py-2 text-left text-sm transition ${
                      !selectedTag
                        ? 'bg-zinc-950 text-white dark:bg-zinc-100 dark:text-zinc-950'
                        : 'text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-900'
                    }`}
                  >
                    全部标签
                  </button>
                  {tagFacets.map(tag => (
                    <button
                      key={tag.value}
                      onClick={() => {
                        if (!confirmDiscardIfDirty()) return;
                        clearSelectedAsset();
                        setSelectedTag(tag.value);
                        setExpandedRail(null);
                      }}
                      className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition ${
                        selectedTag === tag.value
                          ? 'bg-zinc-950 text-white dark:bg-zinc-100 dark:text-zinc-950'
                          : 'text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-900'
                      }`}
                    >
                      <span className="truncate">{tag.value}</span>
                      <span className={`text-xs ${selectedTag === tag.value ? 'text-zinc-300 dark:text-zinc-700' : 'text-zinc-400'}`}>
                        {tag.assetIds.length}
                      </span>
                    </button>
                  ))}
                  {tagFacets.length === 0 && <div className="rounded-xl px-3 py-5 text-sm text-zinc-400">当前范围和类型下还没有标签。</div>}
                </div>
              )}
            </div>
          </div>
        </section>

        <div className="relative z-10 grid items-start gap-6 xl:grid-cols-[400px_minmax(0,1fr)]">
          <section className="self-start overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-[0_8px_32px_-12px_rgba(15,23,42,0.12)] dark:border-zinc-800 dark:bg-zinc-950">
            <div className="border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                <input
                  value={query}
                  onChange={event => setQuery(event.target.value)}
                  placeholder={`搜索${getDisplayScope(scope)}${getDisplayType(assetType)}...`}
                  className="w-full rounded-xl border border-zinc-200 bg-zinc-50 py-2.5 pl-10 pr-4 text-xs outline-none transition focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
                />
              </div>
              <div className="mt-4 flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
                <span>
                  {getDisplayScope(scope)} / {getDisplayType(assetType)}
                </span>
                <span>{filtered.length} 条记录</span>
              </div>
            </div>

            <div className="max-h-[calc(100vh-320px)] overflow-y-auto">
              {filtered.length === 0 ? (
                <div className="flex min-h-[360px] flex-col items-center justify-center px-8 text-center">
                  <div className="rounded-full border border-zinc-200 bg-zinc-50 p-4 text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900">
                    <BookOpen className="h-5 w-5" />
                  </div>
                  <h3 className="mt-4 text-lg font-semibold text-zinc-900 dark:text-zinc-100">当前筛选下没有结果</h3>
                  <p className="mt-2 max-w-xs text-sm leading-6 text-zinc-500 dark:text-zinc-400">你可以切换范围、类型或标签，也可以直接创建一条新的知识记录。</p>
                </div>
              ) : (
                filtered.map(asset => {
                  const active = selected?.id === asset.id;
                  return (
                    <button
                      key={asset.id}
                      onClick={() => openAsset(asset)}
                      className={`flex w-full items-start gap-3 border-b border-zinc-100 px-4 py-3 text-left transition last:border-b-0 dark:border-zinc-900 ${
                        active ? 'bg-zinc-50 dark:bg-zinc-900/60' : 'hover:bg-zinc-50/70 dark:hover:bg-zinc-900/50'
                      }`}
                    >
                      <div
                        className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[18px] ${
                          asset.type === 'doc'
                            ? 'bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300'
                            : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300'
                        }`}
                      >
                        {asset.type === 'doc' ? <FileText className="h-4 w-4" /> : <BookOpen className="h-4 w-4" />}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-[14px] font-semibold leading-5 text-zinc-900 dark:text-zinc-100">{asset.title}</div>
                            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] font-medium text-zinc-500 dark:text-zinc-400">
                              <span>{getDisplayScope(asset.scope)}</span>
                              <span className="h-1 w-1 rounded-full bg-zinc-300 dark:bg-zinc-700" />
                              <span>{getDisplayType(asset.type)}</span>
                              {asset.meta ? (
                                <>
                                  <span className="h-1 w-1 rounded-full bg-zinc-300 dark:bg-zinc-700" />
                                  <span>{asset.meta}</span>
                                </>
                              ) : null}
                            </div>
                          </div>
                          <div className="shrink-0 pt-0.5 text-[10px] text-zinc-400">{fmt(asset.updatedAt)}</div>
                        </div>

                        <div className="mt-1.5 line-clamp-2 text-[13px] leading-6 text-zinc-500 dark:text-zinc-400">{asset.description || '暂无描述'}</div>

                        {asset.tags.length > 0 && (
                          <div className="mt-2.5 flex flex-wrap gap-1.5">
                            {asset.tags.slice(0, 3).map(tag => (
                              <span
                                key={tag}
                                className="rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-[10px] text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400"
                              >
                                #{tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </section>

          <section className="self-start overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-[0_8px_32px_-12px_rgba(15,23,42,0.12)] dark:border-zinc-800 dark:bg-zinc-950 xl:sticky xl:top-4">
            {mode === 'idle' ? (
              <div className="flex min-h-[500px] flex-col justify-between px-6 py-6">
                <div>
                  <div className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-xs font-medium text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
                    <Eye className="h-3.5 w-3.5" />
                    预览工作区
                  </div>
                  <h2 className="mt-4 text-[30px] font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">从左侧选择一条知识资产</h2>
                  <p className="mt-3 max-w-xl text-sm leading-6 text-zinc-500 dark:text-zinc-400">
                    这里会优先展示文档或上下文的内容预览。需要修改时，再进入编辑模式，不再一上来就落到表单里。
                  </p>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-3xl border border-zinc-200 bg-zinc-50/70 p-5 dark:border-zinc-800 dark:bg-zinc-900/70">
                    <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">当前项目</div>
                    <div className="mt-2 text-sm leading-6 text-zinc-500 dark:text-zinc-400">{currentProjectName}</div>
                  </div>
                  <div className="rounded-3xl border border-zinc-200 bg-zinc-50/70 p-5 dark:border-zinc-800 dark:bg-zinc-900/70">
                    <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">知识概况</div>
                    <div className="mt-2 text-sm leading-6 text-zinc-500 dark:text-zinc-400">
                      共 {stats.total} 条资产，其中 {stats.docs} 条设计文档，{stats.context} 条上下文，{stats.global} 条全局上下文。
                    </div>
                  </div>
                </div>
              </div>
            ) : (
                <div className="flex min-h-[500px] flex-col">
                <div className="flex items-start justify-between gap-4 border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
                  <div className="min-w-0">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">
                      {mode === 'create-doc'
                        ? '创建设计文档'
                        : mode === 'create-context'
                          ? '创建上下文'
                          : mode === 'preview'
                            ? '内容预览'
                            : selected?.type === 'doc'
                              ? '编辑设计文档'
                              : '编辑上下文'}
                    </div>
                    <h2 className="mt-2 truncate text-[20px] font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                      {mode === 'create-doc'
                        ? '新建设计文档'
                        : mode === 'create-context'
                          ? '新建上下文资产'
                          : previewTitle}
                    </h2>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    {mode === 'preview' && selected ? (
                      <>
                        <button
                          onClick={() =>
                            replaceUrlState({
                              nextAssetId: selected.id,
                              nextMode: 'edit',
                            })
                          }
                          aria-label="文档预览编辑"
                          className="rounded-xl bg-zinc-950 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200"
                        >
                          <Edit3 className="mr-2 inline h-4 w-4" />
                          编辑
                        </button>
                        <button
                          onClick={() => void remove(selected)}
                          aria-label="删除当前文档"
                          className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2 text-sm font-medium text-rose-600 transition hover:bg-rose-100 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-300 dark:hover:bg-rose-950/50"
                        >
                          <Trash2 className="mr-2 inline h-4 w-4" />
                          删除
                        </button>
                      </>
                    ) : null}

                    {(mode === 'edit-doc' || mode === 'edit-context') && selected ? (
                      <button
                        onClick={() => {
                          if (!confirmDiscardIfDirty()) return;
                          replaceUrlState({
                            nextAssetId: selected.id,
                            nextMode: 'preview',
                          });
                        }}
                        aria-label="返回文档预览"
                        className="rounded-xl border border-zinc-200 bg-white px-3.5 py-2 text-sm font-medium text-zinc-600 transition hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
                      >
                        <Eye className="mr-2 inline h-4 w-4" />
                        返回预览
                      </button>
                    ) : null}

                    <button
                      onClick={() => {
                        if (!confirmDiscardIfDirty()) return;
                        replaceUrlState({
                          nextAssetId: null,
                        });
                      }}
                      aria-label="关闭文档预览"
                      className="rounded-xl border border-zinc-200 bg-white px-3.5 py-2 text-sm font-medium text-zinc-600 transition hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
                    >
                      <X className="mr-2 inline h-4 w-4" />
                      关闭
                    </button>
                  </div>
                </div>

                {mode === 'preview' && selected ? (
                  <div className="flex-1 overflow-y-auto px-6 py-5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className={`rounded-full px-3 py-1 text-[11px] font-medium ${
                          selected.type === 'doc'
                            ? 'bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300'
                            : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300'
                        }`}
                      >
                        {getDisplayType(selected.type)}
                      </span>
                      <span className="rounded-full bg-zinc-100 px-3 py-1 text-[11px] font-medium text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
                        {getDisplayScope(selected.scope)}
                      </span>
                      <span className="rounded-full bg-zinc-100 px-3 py-1 text-[11px] font-medium text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
                        {selected.type === 'doc' ? getStatusText(docForm.status) : getStatusText(contextForm.status)}
                      </span>
                      <span className="rounded-full bg-zinc-100 px-3 py-1 text-[11px] font-medium text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
                        更新于 {fmt(selected.updatedAt)}
                      </span>
                    </div>

                    <div className="mt-4 grid gap-3 xl:grid-cols-2">
                      {selected.type === 'doc' ? (
                        <>
                          <PreviewBlock label="描述" value={docForm.description} />
                          <PreviewBlock label="分类" value={docForm.category} />
                          <PreviewBlock label="标签" value={docForm.tags} />
                        </>
                      ) : (
                        <>
                          <PreviewBlock label="描述" value={contextForm.description} />
                          <PreviewBlock label="分组" value={contextForm.group} />
                          <PreviewBlock label="文件名" value={contextForm.fileName} />
                          <PreviewBlock label="格式" value={contextForm.format} />
                          <PreviewBlock label="源路径" value={contextForm.sourcePath} />
                          <PreviewBlock label="标签" value={contextForm.tags} />
                        </>
                      )}
                    </div>

                    <div className="mt-4 rounded-2xl border border-zinc-200 bg-zinc-50/60 dark:border-zinc-800 dark:bg-zinc-900/60">
                      <div className="border-b border-zinc-200 px-4 py-3 text-sm font-medium text-zinc-600 dark:border-zinc-800 dark:text-zinc-300">
                        内容
                      </div>
                      <div className="px-4 py-4">
                        <pre className="whitespace-pre-wrap break-words font-mono text-[12.5px] leading-[1.75] text-zinc-700 dark:text-zinc-300">
                          {selected.type === 'doc' ? docForm.content || '暂无内容。' : contextForm.content || '暂无内容。'}
                        </pre>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 overflow-y-auto px-6 py-5">
                    {(mode === 'create-doc' || mode === 'edit-doc') && (
                      <div className="space-y-4">
                        <input
                          value={docForm.title}
                          onChange={event => setDocForm(current => ({ ...current, title: event.target.value }))}
                          placeholder="标题"
                          className="w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
                        />
                        <input
                          value={docForm.description}
                          onChange={event => setDocForm(current => ({ ...current, description: event.target.value }))}
                          placeholder="描述"
                          className="w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
                        />
                        <div className="grid gap-4 sm:grid-cols-2">
                          <input
                            value={docForm.category}
                            onChange={event => setDocForm(current => ({ ...current, category: event.target.value }))}
                            placeholder="分类"
                            className="w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
                          />
                          <select
                            value={docForm.status}
                            onChange={event => setDocForm(current => ({ ...current, status: event.target.value as DocStatus }))}
                            className="w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
                          >
                            <option value="active">生效中</option>
                            <option value="draft">草稿</option>
                            <option value="deprecated">已废弃</option>
                          </select>
                        </div>
                        <input
                          value={docForm.tags}
                          onChange={event => setDocForm(current => ({ ...current, tags: event.target.value }))}
                          placeholder="标签，使用逗号分隔"
                          className="w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
                        />
                        <textarea
                          value={docForm.content}
                          onChange={event => setDocForm(current => ({ ...current, content: event.target.value }))}
                          rows={18}
                          placeholder="Markdown 内容"
                          className="min-h-[340px] w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 font-mono text-sm outline-none transition focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
                        />
                      </div>
                    )}

                    {(mode === 'create-context' || mode === 'edit-context') && (
                      <div className="space-y-4">
                        <input
                          value={contextForm.label}
                          onChange={event =>
                            setContextForm(current => ({
                              ...current,
                              label: event.target.value,
                              fileName:
                                mode === 'create-context'
                                  ? withFormatExtension(current.fileName, event.target.value, current.format)
                                  : current.fileName,
                            }))
                          }
                          placeholder="名称"
                          className="w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
                        />
                        <input
                          value={contextForm.description}
                          onChange={event => setContextForm(current => ({ ...current, description: event.target.value }))}
                          placeholder="描述"
                          className="w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
                        />
                        <div className="grid gap-4 sm:grid-cols-2">
                          <input
                            value={contextForm.group}
                            onChange={event => setContextForm(current => ({ ...current, group: event.target.value }))}
                            placeholder="分组"
                            className="w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
                          />
                          <select
                            value={contextForm.status}
                            onChange={event => setContextForm(current => ({ ...current, status: event.target.value as 'active' | 'draft' }))}
                            className="w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
                          >
                            <option value="active">生效中</option>
                            <option value="draft">草稿</option>
                          </select>
                        </div>
                        <div className="grid gap-4 sm:grid-cols-2">
                          <input
                            value={contextForm.fileName}
                            onChange={event => setContextForm(current => ({ ...current, fileName: event.target.value }))}
                            placeholder="文件名"
                            className="w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
                          />
                          <select
                            value={contextForm.format}
                            onChange={event =>
                              setContextForm(current => {
                                const nextFormat = event.target.value as ContextEntry['format'];
                                return {
                                  ...current,
                                  format: nextFormat,
                                  fileName:
                                    mode === 'create-context'
                                      ? withFormatExtension(current.fileName, current.label, nextFormat)
                                      : current.fileName,
                                };
                              })
                            }
                            className="w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
                          >
                            <option value="markdown">Markdown</option>
                            <option value="json">JSON</option>
                            <option value="text">Text</option>
                          </select>
                        </div>
                        <input
                          value={contextForm.tags}
                          onChange={event => setContextForm(current => ({ ...current, tags: event.target.value }))}
                          placeholder="标签，使用逗号分隔"
                          className="w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
                        />
                        <input
                          value={contextForm.sourcePath}
                          onChange={event => setContextForm(current => ({ ...current, sourcePath: event.target.value }))}
                          placeholder="源文件路径（可选）"
                          className="w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
                        />
                        <textarea
                          value={contextForm.content}
                          onChange={event => setContextForm(current => ({ ...current, content: event.target.value }))}
                          rows={18}
                          placeholder="上下文内容"
                          className="min-h-[340px] w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 font-mono text-sm outline-none transition focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
                        />
                      </div>
                    )}

                    <div className="mt-6 flex items-center gap-3 border-t border-zinc-200 pt-5 dark:border-zinc-800">
                      <button
                        onClick={save}
                        disabled={saving || !canSave}
                        className="rounded-2xl bg-zinc-950 px-5 py-3 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200"
                      >
                        {saving ? '保存中...' : mode.startsWith('create') ? '创建资产' : '保存修改'}
                      </button>
                      <button
                        onClick={() => {
                          if (selected && (mode === 'edit-doc' || mode === 'edit-context')) {
                            if (!confirmDiscardIfDirty()) return;
                            replaceUrlState({
                              nextAssetId: selected.id,
                              nextMode: 'preview',
                            });
                            return;
                          }
                          if (!confirmDiscardIfDirty()) return;
                          reset();
                        }}
                        className="rounded-2xl border border-zinc-200 bg-white px-5 py-3 text-sm font-medium text-zinc-600 transition hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
                      >
                        取消
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>

      </div>
    </div>
  );
}
