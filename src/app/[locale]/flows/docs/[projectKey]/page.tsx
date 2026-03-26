'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { BookOpen, FileText, Globe, Layers3, Plus, Search, Trash2, X } from 'lucide-react';
import { useRouter } from '@/client/i18n/routing';
import { useProject } from '@/components/project-context';
import type { ContextEntry, DocEntry, DocStatus } from '@/types';

type AssetType = 'doc' | 'context';
type Scope = 'project' | 'global';
type Status = 'active' | 'draft' | 'deprecated';

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

type DocForm = { title: string; description: string; category: string; tags: string; status: Status; content: string };
type ContextForm = { label: string; description: string; fileName: string; format: ContextEntry['format']; group: string; sourcePath: string; tags: string; status: 'active' | 'draft'; content: string };

const EMPTY_DOC: DocForm = { title: '', description: '', category: '', tags: '', status: 'active', content: '' };
const EMPTY_CONTEXT: ContextForm = { label: '', description: '', fileName: '', format: 'markdown', group: '', sourcePath: '', tags: '', status: 'active', content: '' };

const tagsToArray = (value: string) => value.split(',').map(v => v.trim()).filter(Boolean);
const fmt = (iso: string) => new Date(iso).toLocaleString('zh-CN', { hour12: false });
const slug = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `asset-${Date.now()}`;

function fromDoc(entry: DocEntry): Asset {
  return { id: entry.id, type: 'doc', title: entry.title, description: entry.description ?? '', scope: 'project', status: entry.status ?? 'active', projectKey: entry.projectKey, tags: entry.tags ?? [], meta: entry.category, createdAt: entry.createdAt, updatedAt: entry.updatedAt };
}

function fromContext(entry: ContextEntry): Asset {
  return { id: entry.id, type: 'context', title: entry.label, description: entry.description, scope: entry.projectKey ? 'project' : 'global', status: entry.status === 'draft' ? 'draft' : 'active', projectKey: entry.projectKey, tags: entry.tags ?? [], meta: entry.group ?? entry.format.toUpperCase(), createdAt: entry.createdAt, updatedAt: entry.updatedAt };
}

export default function DocsProjectPage() {
  const params = useParams();
  const [searchParams] = useSearchParams();
  const projectKey = params.projectKey as string;
  const router = useRouter();
  const { activeKey, setActiveKey } = useProject();
  const syncedRef = useRef(false);

  const [projects, setProjects] = useState<Array<{ key: string; name: string }>>([]);
  const [docs, setDocs] = useState<DocEntry[]>([]);
  const [contexts, setContexts] = useState<ContextEntry[]>([]);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | AssetType>(() => searchParams.get('view') === 'context' ? 'context' : searchParams.get('view') === 'docs' ? 'doc' : 'all');
  const [scopeFilter, setScopeFilter] = useState<'all' | Scope>('all');
  const [selected, setSelected] = useState<Asset | null>(null);
  const [mode, setMode] = useState<'idle' | 'create-doc' | 'create-context' | 'edit-doc' | 'edit-context'>('idle');
  const [docForm, setDocForm] = useState<DocForm>(EMPTY_DOC);
  const [contextForm, setContextForm] = useState<ContextForm>(EMPTY_CONTEXT);
  const [docBase, setDocBase] = useState<DocForm>(EMPTY_DOC);
  const [contextBase, setContextBase] = useState<ContextForm>(EMPTY_CONTEXT);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (projectKey && projectKey !== activeKey) setActiveKey(projectKey);
    syncedRef.current = true;
  }, [projectKey, activeKey, setActiveKey]);

  useEffect(() => {
    if (!syncedRef.current || !activeKey || activeKey === projectKey) return;
    router.replace(`/flows/docs/${activeKey}`);
  }, [activeKey, projectKey, router]);

  useEffect(() => {
    setTypeFilter(searchParams.get('view') === 'context' ? 'context' : searchParams.get('view') === 'docs' ? 'doc' : 'all');
  }, [searchParams]);

  const fetchProjects = useCallback(async () => {
    const res = await fetch('/api/data/projects');
    const data = await res.json();
    setProjects((data.projects ?? []).filter((p: { archived?: boolean }) => !p.archived).map((p: { key: string; name: string }) => ({ key: p.key, name: p.name })));
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

  useEffect(() => { fetchProjects(); }, [fetchProjects]);
  useEffect(() => { fetchAssets(); setSelected(null); setMode('idle'); }, [fetchAssets]);

  const assets = useMemo(() => [...docs.map(fromDoc), ...contexts.map(fromContext)].sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt)), [docs, contexts]);
  const filtered = useMemo(() => assets.filter(asset => (typeFilter === 'all' || asset.type === typeFilter) && (scopeFilter === 'all' || asset.scope === scopeFilter) && (!query.trim() || [asset.title, asset.description, asset.meta, ...asset.tags].filter(Boolean).some(v => v!.toLowerCase().includes(query.trim().toLowerCase())))), [assets, typeFilter, scopeFilter, query]);
  const stats = useMemo(() => ({ total: assets.length, docs: assets.filter(a => a.type === 'doc').length, context: assets.filter(a => a.type === 'context').length, global: assets.filter(a => a.scope === 'global').length }), [assets]);
  const dirty = mode.includes('doc') ? JSON.stringify(docForm) !== JSON.stringify(docBase) : JSON.stringify(contextForm) !== JSON.stringify(contextBase);

  const reset = () => { setSelected(null); setMode('idle'); setDocForm(EMPTY_DOC); setContextForm(EMPTY_CONTEXT); setDocBase(EMPTY_DOC); setContextBase(EMPTY_CONTEXT); };

  const load = useCallback(async (asset: Asset) => {
    setSelected(asset);
    if (asset.type === 'doc') {
      const res = await fetch(`/api/docs/${asset.id}`);
      const data = await res.json();
      const next = { title: data.entry.title, description: data.entry.description ?? '', category: data.entry.category ?? '', tags: (data.entry.tags ?? []).join(', '), status: data.entry.status ?? 'active', content: data.content ?? '' };
      setDocForm(next); setDocBase(next); setMode('edit-doc');
      return;
    }
    const res = await fetch(`/api/context/${asset.id}`);
    const data = await res.json();
      const next: ContextForm = { label: data.entry.label, description: data.entry.description, fileName: data.entry.fileName, format: data.entry.format, group: data.entry.group ?? '', sourcePath: data.entry.sourcePath ?? '', tags: (data.entry.tags ?? []).join(', '), status: data.entry.status === 'draft' ? 'draft' : 'active', content: data.content ?? '' };
    setContextForm(next); setContextBase(next); setMode('edit-context');
  }, []);

  const remove = async (asset: Asset) => {
    if (!window.confirm(`Delete "${asset.title}"?`)) return;
    const res = await fetch(asset.type === 'doc' ? `/api/docs/${asset.id}` : `/api/context/${asset.id}`, { method: 'DELETE' });
    if (!res.ok) return;
    await fetchAssets();
    if (selected?.id === asset.id) reset();
  };

  const save = async () => {
    setSaving(true);
    try {
      if (mode === 'create-doc') {
        const res = await fetch('/api/docs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectKey, title: docForm.title.trim(), description: docForm.description.trim() || undefined, content: docForm.content, category: docForm.category.trim() || undefined, tags: tagsToArray(docForm.tags), status: docForm.status === 'active' ? undefined : docForm.status }) });
        if (res.ok) { await fetchAssets(); reset(); }
      }
      if (mode === 'edit-doc' && selected) {
        const res = await fetch(`/api/docs/${selected.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: docForm.title.trim(), description: docForm.description.trim(), content: docForm.content, category: docForm.category.trim(), tags: tagsToArray(docForm.tags), status: docForm.status === 'active' ? undefined : docForm.status }) });
        if (res.ok) { await fetchAssets(); setDocBase(docForm); }
      }
      if (mode === 'create-context') {
        const fileName = contextForm.fileName.trim() || `${slug(contextForm.label)}.${contextForm.format === 'markdown' ? 'md' : contextForm.format === 'json' ? 'json' : 'txt'}`;
        const res = await fetch('/api/context', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label: contextForm.label.trim(), description: contextForm.description.trim(), fileName, format: contextForm.format, group: contextForm.group.trim() || undefined, sourcePath: contextForm.sourcePath.trim() || undefined, tags: tagsToArray(contextForm.tags), status: contextForm.status === 'draft' ? 'draft' : undefined, projectKey, content: contextForm.content }) });
        if (res.ok) { await fetchAssets(); reset(); }
      }
      if (mode === 'edit-context' && selected) {
        const res = await fetch(`/api/context/${selected.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label: contextForm.label.trim(), description: contextForm.description.trim(), fileName: contextForm.fileName.trim(), format: contextForm.format, group: contextForm.group.trim(), sourcePath: contextForm.sourcePath.trim(), tags: tagsToArray(contextForm.tags), status: contextForm.status, content: contextForm.content }) });
        if (res.ok) { await fetchAssets(); setContextBase(contextForm); }
      }
    } finally {
      setSaving(false);
    }
  };

  const editorTitle = mode === 'create-doc' ? '新建设计文档' : mode === 'create-context' ? '新建上下文资产' : selected?.title ?? '文档';
  const canSave = mode.includes('doc') ? !!docForm.title.trim() && (mode.startsWith('create') || dirty) : !!contextForm.label.trim() && !!contextForm.fileName.trim() && (mode.startsWith('create') || dirty);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[1380px] flex-col gap-6 px-6 py-8">
        <section className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
            <div className="max-w-3xl">
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400"><Layers3 className="h-3.5 w-3.5" />ProjectPilot 文档</div>
              <h1 className="text-3xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">文档</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-500 dark:text-zinc-400">这里统一承载文档、上下文与其他信息文件。类型现在只是筛选维度，不再是顶级入口。</p>
            </div>
            <div className="flex min-w-[280px] flex-col gap-3">
              <select value={projectKey} onChange={e => { setActiveKey(e.target.value); router.push(`/flows/docs/${e.target.value}`); }} className="rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100">
                {projects.map(p => <option key={p.key} value={p.key}>{p.name}</option>)}
              </select>
              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => { reset(); setMode('create-doc'); }} className="rounded-2xl bg-zinc-950 px-4 py-3 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-950"><Plus className="mr-2 inline h-4 w-4" />新建设计文档</button>
                <button onClick={() => { reset(); setMode('create-context'); setContextForm({ ...EMPTY_CONTEXT, fileName: `asset-${Date.now()}.md` }); }} className="rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm font-medium text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200"><Plus className="mr-2 inline h-4 w-4" />新建上下文</button>
              </div>
            </div>
          </div>
          <div className="mt-6 grid gap-3 md:grid-cols-4">
            <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900"><div className="text-xs uppercase tracking-[0.16em] text-zinc-400">总资产</div><div className="mt-2 text-2xl font-semibold text-zinc-950 dark:text-zinc-50">{stats.total}</div></div>
            <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900"><div className="text-xs uppercase tracking-[0.16em] text-zinc-400">设计文档</div><div className="mt-2 text-2xl font-semibold text-zinc-950 dark:text-zinc-50">{stats.docs}</div></div>
            <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900"><div className="text-xs uppercase tracking-[0.16em] text-zinc-400">上下文</div><div className="mt-2 text-2xl font-semibold text-zinc-950 dark:text-zinc-50">{stats.context}</div></div>
            <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900"><div className="text-xs uppercase tracking-[0.16em] text-zinc-400">全局层</div><div className="mt-2 text-2xl font-semibold text-zinc-950 dark:text-zinc-50">{stats.global}</div></div>
          </div>
        </section>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(380px,0.9fr)]">
          <section className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
            <div className="mb-4 flex flex-col gap-3">
              <div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索标题、描述、标签、分组" className="w-full rounded-2xl border border-zinc-200 bg-white py-3 pl-10 pr-4 text-sm outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100" /></div>
              <div className="grid gap-3 lg:grid-cols-2">
                <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
                  <div className="mb-2 text-sm font-medium text-zinc-500 dark:text-zinc-400">类型：</div>
                  <div className="flex flex-wrap gap-2">
                    {[['all', '全部'], ['doc', '文档'], ['context', '上下文']].map(([value, label]) => <button key={value} onClick={() => setTypeFilter(value as 'all' | AssetType)} className={`rounded-full px-3 py-1.5 text-sm ${typeFilter === value ? 'bg-zinc-950 text-white dark:bg-zinc-100 dark:text-zinc-950' : 'bg-white text-zinc-600 ring-1 ring-zinc-200 dark:bg-zinc-950 dark:text-zinc-300 dark:ring-zinc-800'}`}>{label}</button>)}
                  </div>
                </div>
                <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
                  <div className="mb-2 text-sm font-medium text-zinc-500 dark:text-zinc-400">范围：</div>
                  <div className="flex flex-wrap gap-2">
                    {[['all', '全部范围'], ['project', '项目'], ['global', '全局']].map(([value, label]) => <button key={value} onClick={() => setScopeFilter(value as 'all' | Scope)} className={`rounded-full px-3 py-1.5 text-sm ${scopeFilter === value ? 'bg-zinc-950 text-white dark:bg-zinc-100 dark:text-zinc-950' : 'bg-white text-zinc-600 ring-1 ring-zinc-200 dark:bg-zinc-950 dark:text-zinc-300 dark:ring-zinc-800'}`}>{label}</button>)}
                  </div>
                </div>
              </div>
            </div>
            <div className="space-y-3">
              {filtered.map(asset => (
                <button key={asset.id} onClick={() => load(asset)} className={`w-full rounded-2xl border p-4 text-left transition ${selected?.id === asset.id ? 'border-zinc-950 bg-zinc-950 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-950' : 'border-zinc-200 bg-white hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900'}`}>
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px]">
                    <span className={`rounded-full px-2 py-1 ${selected?.id === asset.id ? 'bg-white/10 text-zinc-100 dark:bg-zinc-950 dark:text-zinc-800' : asset.type === 'doc' ? 'bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300' : 'bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300'}`}>{asset.type === 'doc' ? <FileText className="mr-1 inline h-3.5 w-3.5" /> : <BookOpen className="mr-1 inline h-3.5 w-3.5" />}{asset.type === 'doc' ? '设计文档' : '上下文'}</span>
                    <span className={`rounded-full px-2 py-1 ${selected?.id === asset.id ? 'bg-white/10 text-zinc-100 dark:bg-zinc-950 dark:text-zinc-800' : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400'}`}>{asset.scope === 'global' ? <Globe className="mr-1 inline h-3.5 w-3.5" /> : null}{asset.scope === 'global' ? '全局' : '项目'}</span>
                    {asset.meta && <span className={`rounded-full px-2 py-1 ${selected?.id === asset.id ? 'bg-white/10 text-zinc-100 dark:bg-zinc-950 dark:text-zinc-800' : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400'}`}>{asset.meta}</span>}
                  </div>
                  <div className="text-base font-semibold">{asset.title}</div>
                  <p className={`mt-2 line-clamp-2 text-sm ${selected?.id === asset.id ? 'text-zinc-200 dark:text-zinc-700' : 'text-zinc-500 dark:text-zinc-400'}`}>{asset.description || '暂无描述。'}</p>
                  <div className={`mt-3 text-xs ${selected?.id === asset.id ? 'text-zinc-300 dark:text-zinc-600' : 'text-zinc-400 dark:text-zinc-500'}`}>更新于 {fmt(asset.updatedAt)}</div>
                </button>
              ))}
              {filtered.length === 0 && <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 px-6 py-16 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">当前筛选条件下没有匹配的资产。</div>}
            </div>
          </section>

          <section className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
            {mode === 'idle' ? (
              <div className="flex min-h-[520px] flex-col justify-between">
                <div>
                  <div className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400"><Layers3 className="h-3.5 w-3.5" />设计意图</div>
                  <h2 className="mt-4 text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">靠筛选扩展，而不是继续靠页面硬拆</h2>
                  <p className="mt-3 text-sm leading-6 text-zinc-500 dark:text-zinc-400">这个中心预留了未来资产类型的扩展空间。信息架构围绕范围、状态和分类组织，而不是不断增加新的独立入口。</p>
                </div>
                <div className="grid gap-3">
                  <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 text-sm leading-6 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">项目知识和全局知识放在同一视野里，复用边界会更清晰。</div>
                  <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 text-sm leading-6 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">文档和上下文共用同一浏览层，但保留各自不同的创建表单。</div>
                  <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 text-sm leading-6 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">原来的文档 / 上下文差异仍然可以通过筛选和深链接表达，不需要再把产品打碎成多个入口。</div>
                </div>
              </div>
            ) : (
              <div className="flex min-h-[520px] flex-col">
                <div className="mb-5 flex items-start justify-between gap-3 border-b border-zinc-200 pb-4 dark:border-zinc-800">
                  <div><div className="text-xs uppercase tracking-[0.16em] text-zinc-400">{mode.includes('doc') ? '设计文档编辑器' : '上下文编辑器'}</div><h2 className="mt-2 text-xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">{editorTitle}</h2></div>
                  <div className="flex items-center gap-2">{selected && <button onClick={() => remove(selected)} className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-600 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-300"><Trash2 className="mr-2 inline h-4 w-4" />删除</button>}<button onClick={reset} className="rounded-2xl border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300"><X className="mr-2 inline h-4 w-4" />关闭</button></div>
                </div>

                {mode.includes('doc') && (
                  <div className="space-y-4">
                    <input value={docForm.title} onChange={e => setDocForm(v => ({ ...v, title: e.target.value }))} placeholder="标题" className="w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100" />
                    <input value={docForm.description} onChange={e => setDocForm(v => ({ ...v, description: e.target.value }))} placeholder="描述" className="w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100" />
                    <div className="grid gap-4 sm:grid-cols-2"><input value={docForm.category} onChange={e => setDocForm(v => ({ ...v, category: e.target.value }))} placeholder="分类" className="w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100" /><select value={docForm.status} onChange={e => setDocForm(v => ({ ...v, status: e.target.value as DocStatus }))} className="w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"><option value="active">生效中</option><option value="draft">草稿</option><option value="deprecated">已废弃</option></select></div>
                    <input value={docForm.tags} onChange={e => setDocForm(v => ({ ...v, tags: e.target.value }))} placeholder="标签，逗号分隔" className="w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100" />
                    <textarea value={docForm.content} onChange={e => setDocForm(v => ({ ...v, content: e.target.value }))} rows={18} placeholder="Markdown 内容" className="min-h-[300px] w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 font-mono text-sm outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100" />
                  </div>
                )}

                {mode.includes('context') && (
                  <div className="space-y-4">
                    <input value={contextForm.label} onChange={e => setContextForm(v => ({ ...v, label: e.target.value, fileName: mode === 'create-context' ? `${slug(e.target.value)}.${v.format === 'markdown' ? 'md' : v.format === 'json' ? 'json' : 'txt'}` : v.fileName }))} placeholder="名称" className="w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100" />
                    <input value={contextForm.description} onChange={e => setContextForm(v => ({ ...v, description: e.target.value }))} placeholder="描述" className="w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100" />
                    <div className="grid gap-4 sm:grid-cols-2"><input value={contextForm.group} onChange={e => setContextForm(v => ({ ...v, group: e.target.value }))} placeholder="分组" className="w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100" /><select value={contextForm.status} onChange={e => setContextForm(v => ({ ...v, status: e.target.value as 'active' | 'draft' }))} className="w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"><option value="active">生效中</option><option value="draft">草稿</option></select></div>
                    <div className="grid gap-4 sm:grid-cols-2"><input value={contextForm.fileName} onChange={e => setContextForm(v => ({ ...v, fileName: e.target.value }))} placeholder="文件名" className="w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100" /><select value={contextForm.format} onChange={e => setContextForm(v => ({ ...v, format: e.target.value as ContextEntry['format'] }))} className="w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"><option value="markdown">Markdown</option><option value="json">JSON</option><option value="text">Text</option></select></div>
                    <input value={contextForm.tags} onChange={e => setContextForm(v => ({ ...v, tags: e.target.value }))} placeholder="标签，逗号分隔" className="w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100" />
                    <input value={contextForm.sourcePath} onChange={e => setContextForm(v => ({ ...v, sourcePath: e.target.value }))} placeholder="源文件路径（可选）" className="w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100" />
                    <textarea value={contextForm.content} onChange={e => setContextForm(v => ({ ...v, content: e.target.value }))} rows={18} placeholder="上下文内容" className="min-h-[300px] w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 font-mono text-sm outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100" />
                  </div>
                )}

                <div className="mt-5 flex items-center gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
                  <button onClick={save} disabled={saving || !canSave} className="rounded-2xl bg-zinc-950 px-5 py-3 text-sm font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-950">{saving ? '保存中...' : mode.startsWith('create') ? '创建资产' : '保存修改'}</button>
                  <button onClick={reset} className="rounded-2xl border border-zinc-200 bg-white px-5 py-3 text-sm font-medium text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">取消</button>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
