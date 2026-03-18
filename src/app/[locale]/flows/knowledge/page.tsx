'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useProject } from '@/components/project-context';
import {
  Library, Plus, Search, Save, X, Trash2,
  ChevronRight, ChevronDown, LayoutList, Columns3,
  Tag, Circle, FolderOpen, Settings2,
} from 'lucide-react';
import type { DocEntry, CategoryDef } from '@/types';

// ── Types ──

type ViewMode = 'tree' | 'board';
type DocStatus = 'active' | 'draft' | 'deprecated';

interface DocWithContent extends DocEntry {
  content?: string;
}

// ── Helpers ──

function statusColor(status?: string) {
  switch (status) {
    case 'active': return 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400';
    case 'draft': return 'bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400';
    case 'deprecated': return 'bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500';
    default: return 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400';
  }
}

function statusLabel(status?: string) {
  switch (status) {
    case 'active': return 'Active';
    case 'draft': return 'Draft';
    case 'deprecated': return 'Deprecated';
    default: return 'Active';
  }
}

function formatDate(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString('zh-CN');
}

// ── Page ──

export default function KnowledgePage() {
  const { activeKey } = useProject();

  // Data
  const [docs, setDocs] = useState<DocEntry[]>([]);
  const [categories, setCategories] = useState<CategoryDef[]>([]);
  const [allTags, setAllTags] = useState<{ tag: string; count: number }[]>([]);
  const [loading, setLoading] = useState(true);

  // UI state
  const [viewMode, setViewMode] = useState<ViewMode>('tree');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [collapsedCats, setCollapsedCats] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<DocStatus | 'all'>('all');
  const [showDeprecated, setShowDeprecated] = useState(false);

  // Editor state
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [docContent, setDocContent] = useState('');
  const [docTitle, setDocTitle] = useState('');
  const [docDesc, setDocDesc] = useState('');
  const [docCategory, setDocCategory] = useState('');
  const [docStatus, setDocStatus] = useState<DocStatus>('active');
  const [docTags, setDocTags] = useState<string[]>([]);
  const [newTagInput, setNewTagInput] = useState('');
  const [originalContent, setOriginalContent] = useState('');

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const projectKey = activeKey || 'project-pilot';

  // ── Fetch data ──

  const fetchDocs = useCallback(async () => {
    try {
      const url = `/api/docs?project=${encodeURIComponent(projectKey)}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        // API returns { projects: { [key]: DocEntry[] } } or flat array
        const entries: DocEntry[] = data.projects?.[projectKey] ?? data.entries ?? data ?? [];
        setDocs(Array.isArray(entries) ? entries : []);
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [projectKey]);

  const fetchCategories = useCallback(async () => {
    try {
      const res = await fetch(`/api/docs/categories?project=${encodeURIComponent(projectKey)}`);
      if (res.ok) {
        const data = await res.json();
        setCategories(data.categories ?? data ?? []);
      }
    } catch { /* ignore */ }
  }, [projectKey]);

  const fetchTags = useCallback(async () => {
    try {
      const res = await fetch(`/api/docs/tags?project=${encodeURIComponent(projectKey)}`);
      if (res.ok) {
        const data = await res.json();
        setAllTags(data.tags ?? data ?? []);
      }
    } catch { /* ignore */ }
  }, [projectKey]);

  useEffect(() => {
    fetchDocs();
    fetchCategories();
    fetchTags();
  }, [fetchDocs, fetchCategories, fetchTags]);

  // ── Select doc ──

  const handleSelect = useCallback(async (id: string) => {
    setSelectedId(id);
    setEditing(false);
    setCreating(false);
    try {
      const res = await fetch(`/api/docs/${encodeURIComponent(id)}`);
      if (res.ok) {
        const data = await res.json();
        const entry = data.entry ?? data;
        setDocContent(data.content ?? '');
        setOriginalContent(data.content ?? '');
        setDocTitle(entry.title ?? '');
        setDocDesc(entry.description ?? '');
        setDocCategory(entry.category ?? '');
        setDocStatus(entry.status ?? 'active');
        setDocTags(entry.tags ?? []);
      }
    } catch { /* ignore */ }
  }, []);

  // ── Save doc ──

  const handleSave = async () => {
    if (!selectedId) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/docs/${encodeURIComponent(selectedId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: docTitle,
          description: docDesc,
          content: docContent,
          category: docCategory || undefined,
          status: docStatus,
          tags: docTags,
        }),
      });
      if (res.ok) {
        setOriginalContent(docContent);
        setEditing(false);
        fetchDocs();
      }
    } catch { /* ignore */ }
    finally { setSaving(false); }
  };

  // ── Create doc ──

  const handleCreate = async () => {
    if (!docTitle.trim()) return;
    setSaving(true);
    try {
      const res = await fetch('/api/docs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectKey,
          title: docTitle.trim(),
          description: docDesc.trim(),
          content: docContent,
          category: docCategory || undefined,
          status: docStatus,
          tags: docTags,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const newId = data.entry?.id ?? data.id;
        setCreating(false);
        await fetchDocs();
        if (newId) handleSelect(newId);
      }
    } catch { /* ignore */ }
    finally { setSaving(false); }
  };

  // ── Delete doc ──

  const handleDelete = async (id: string) => {
    const doc = docs.find(d => d.id === id);
    if (!confirm(`确定删除「${doc?.title ?? id}」？此操作不可恢复。`)) return;
    try {
      await fetch(`/api/docs/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (selectedId === id) {
        setSelectedId(null);
        setDocContent('');
        setOriginalContent('');
      }
      fetchDocs();
    } catch { /* ignore */ }
  };

  // ── Start creating ──

  const startCreating = (catId?: string) => {
    setCreating(true);
    setSelectedId(null);
    setEditing(false);
    setDocTitle('');
    setDocDesc('');
    setDocContent('');
    setDocCategory(catId ?? '');
    setDocStatus('active');
    setDocTags([]);
    setNewTagInput('');
  };

  // ── Tag management ──

  const addTag = () => {
    const t = newTagInput.trim().toLowerCase();
    if (t && !docTags.includes(t)) {
      setDocTags([...docTags, t]);
    }
    setNewTagInput('');
  };

  const removeTag = (tag: string) => {
    setDocTags(docTags.filter(t => t !== tag));
  };

  // ── Toggle category collapse ──

  const toggleCat = (catId: string) => {
    setCollapsedCats(prev => {
      const next = new Set(prev);
      if (next.has(catId)) next.delete(catId);
      else next.add(catId);
      return next;
    });
  };

  // ── Ctrl+S ──

  // Use refs to capture latest state without re-registering the event listener
  const creatingRef = useRef(creating);
  creatingRef.current = creating;
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const handleSaveRef = useRef(handleSave);
  handleSaveRef.current = handleSave;
  const handleCreateRef = useRef(handleCreate);
  handleCreateRef.current = handleCreate;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (creatingRef.current) handleCreateRef.current();
        else if (editingRef.current) handleSaveRef.current();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // ── Filter docs ──

  const filteredDocs = useMemo(() => docs.filter(d => {
    if (statusFilter !== 'all' && (d.status ?? 'active') !== statusFilter) return false;
    if (!showDeprecated && (d.status === 'deprecated') && statusFilter !== 'deprecated') return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      if (!d.title.toLowerCase().includes(q) && !(d.description ?? '').toLowerCase().includes(q)) return false;
    }
    return true;
  }), [docs, statusFilter, showDeprecated, searchQuery]);

  // ── Group docs by category ──

  const uncategorizedId = '__uncategorized__';
  const sortedCategories = useMemo(() => [...categories].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)), [categories]);

  const docsByCategory = useMemo(() => {
    const result: Record<string, DocEntry[]> = {};
    for (const cat of sortedCategories) {
      result[cat.id] = [];
    }
    result[uncategorizedId] = [];
    for (const doc of filteredDocs) {
      const catId = doc.category ?? uncategorizedId;
      if (!result[catId]) {
        result[uncategorizedId].push(doc);
      } else {
        result[catId].push(doc);
      }
    }
    return result;
  }, [filteredDocs, sortedCategories]);

  const deprecatedCount = useMemo(() => docs.filter(d => d.status === 'deprecated').length, [docs]);
  const isDirty = docContent !== originalContent || editing;
  const selectedDoc = useMemo(() => docs.find(d => d.id === selectedId), [docs, selectedId]);

  // ── Render ──

  return (
    <div className="flex h-full">
      {/* ── Left: Category tree ── */}
      <div className="w-64 shrink-0 border-r border-zinc-200 dark:border-zinc-800 flex flex-col bg-zinc-50/30 dark:bg-zinc-950/50">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 px-4 py-3">
          <div className="flex items-center gap-2">
            <Library className="h-4 w-4 text-zinc-500" />
            <h2 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">知识库</h2>
            <span className="text-xs text-zinc-400">({filteredDocs.length})</span>
          </div>
          <button
            onClick={() => startCreating()}
            className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
            title="新建文档"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>

        {/* Search */}
        <div className="px-3 py-2 border-b border-zinc-100 dark:border-zinc-800/50">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400" />
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="搜索文档..."
              className="w-full rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 pl-7 pr-2 py-1.5 text-xs outline-none focus:border-zinc-400 dark:focus:border-zinc-500"
            />
          </div>
          {/* Status filter */}
          <div className="flex gap-1 mt-2">
            {(['all', 'active', 'draft', 'deprecated'] as const).map(s => (
              <button
                key={s}
                onClick={() => {
                  setStatusFilter(s);
                  if (s === 'deprecated') setShowDeprecated(true);
                }}
                className={`rounded-full px-2 py-0.5 text-[10px] transition-colors ${
                  statusFilter === s
                    ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                    : 'text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                }`}
              >
                {s === 'all' ? '全部' : statusLabel(s)}
              </button>
            ))}
          </div>
        </div>

        {/* Category tree */}
        <div className="flex-1 overflow-y-auto">
          {sortedCategories.map(cat => {
            const catDocs = docsByCategory[cat.id] ?? [];
            if (catDocs.length === 0 && searchQuery) return null;
            const isCollapsed = collapsedCats.has(cat.id);

            return (
              <div key={cat.id}>
                {/* Category header */}
                <button
                  onClick={() => toggleCat(cat.id)}
                  className="flex items-center gap-1.5 w-full px-3 py-2 text-xs font-medium text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/50 transition-colors"
                >
                  {isCollapsed
                    ? <ChevronRight className="h-3 w-3" />
                    : <ChevronDown className="h-3 w-3" />
                  }
                  <span className="flex-1 text-left truncate">{cat.name}</span>
                  <span className="text-[10px] text-zinc-400">{catDocs.length}</span>
                </button>

                {/* Docs under category */}
                {!isCollapsed && catDocs.map(doc => (
                  <div
                    key={doc.id}
                    onClick={() => handleSelect(doc.id)}
                    className={`group flex items-center gap-2 cursor-pointer pl-7 pr-3 py-1.5 text-xs transition-colors ${
                      selectedId === doc.id
                        ? 'bg-zinc-200/60 dark:bg-zinc-800/60'
                        : 'hover:bg-zinc-100/60 dark:hover:bg-zinc-800/30'
                    } ${doc.status === 'deprecated' ? 'opacity-50' : ''}`}
                  >
                    <Circle className={`h-1.5 w-1.5 shrink-0 ${
                      doc.status === 'deprecated' ? 'fill-zinc-300 text-zinc-300' :
                      doc.status === 'draft' ? 'fill-amber-400 text-amber-400' :
                      'fill-emerald-400 text-emerald-400'
                    }`} />
                    <span className={`flex-1 truncate ${
                      doc.status === 'deprecated' ? 'line-through text-zinc-400' : 'text-zinc-700 dark:text-zinc-300'
                    }`}>
                      {doc.title}
                    </span>
                    <button
                      onClick={e => { e.stopPropagation(); handleDelete(doc.id); }}
                      className="opacity-0 group-hover:opacity-100 rounded p-0.5 text-zinc-300 hover:text-red-500 transition-all"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            );
          })}

          {/* Uncategorized */}
          {(docsByCategory[uncategorizedId]?.length ?? 0) > 0 && (
            <div>
              <button
                onClick={() => toggleCat(uncategorizedId)}
                className="flex items-center gap-1.5 w-full px-3 py-2 text-xs font-medium text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/50 transition-colors"
              >
                {collapsedCats.has(uncategorizedId)
                  ? <ChevronRight className="h-3 w-3" />
                  : <ChevronDown className="h-3 w-3" />
                }
                <FolderOpen className="h-3 w-3" />
                <span className="flex-1 text-left">未分类</span>
                <span className="text-[10px]">{docsByCategory[uncategorizedId].length}</span>
              </button>
              {!collapsedCats.has(uncategorizedId) && docsByCategory[uncategorizedId].map(doc => (
                <div
                  key={doc.id}
                  onClick={() => handleSelect(doc.id)}
                  className={`group flex items-center gap-2 cursor-pointer pl-7 pr-3 py-1.5 text-xs transition-colors ${
                    selectedId === doc.id
                      ? 'bg-zinc-200/60 dark:bg-zinc-800/60'
                      : 'hover:bg-zinc-100/60 dark:hover:bg-zinc-800/30'
                  } ${doc.status === 'deprecated' ? 'opacity-50' : ''}`}
                >
                  <Circle className={`h-1.5 w-1.5 shrink-0 ${
                    doc.status === 'deprecated' ? 'fill-zinc-300 text-zinc-300' :
                    doc.status === 'draft' ? 'fill-amber-400 text-amber-400' :
                    'fill-emerald-400 text-emerald-400'
                  }`} />
                  <span className={`flex-1 truncate ${
                    doc.status === 'deprecated' ? 'line-through text-zinc-400' : 'text-zinc-700 dark:text-zinc-300'
                  }`}>
                    {doc.title}
                  </span>
                  <button
                    onClick={e => { e.stopPropagation(); handleDelete(doc.id); }}
                    className="opacity-0 group-hover:opacity-100 rounded p-0.5 text-zinc-300 hover:text-red-500 transition-all"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Deprecated toggle */}
          {deprecatedCount > 0 && statusFilter === 'all' && (
            <button
              onClick={() => setShowDeprecated(v => !v)}
              className="w-full px-3 py-2 text-[10px] text-zinc-400 hover:text-zinc-500 text-left"
            >
              {showDeprecated ? '隐藏' : '显示'} {deprecatedCount} 篇已过时文档
            </button>
          )}
        </div>
      </div>

      {/* ── Right: Main content area ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 px-4 py-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              {projectKey}
            </span>
            {selectedDoc && !creating && (
              <span className="text-xs text-zinc-400">
                / {categories.find(c => c.id === selectedDoc.category)?.name ?? '未分类'}
                / {selectedDoc.title}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {/* View switcher */}
            <div className="flex rounded-md border border-zinc-200 dark:border-zinc-700 overflow-hidden mr-2">
              <button
                onClick={() => setViewMode('tree')}
                className={`p-1.5 transition-colors ${
                  viewMode === 'tree'
                    ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                    : 'text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                }`}
                title="树形视图"
              >
                <LayoutList className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setViewMode('board')}
                className={`p-1.5 transition-colors ${
                  viewMode === 'board'
                    ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                    : 'text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                }`}
                title="看板视图"
              >
                <Columns3 className="h-3.5 w-3.5" />
              </button>
            </div>
            <button
              onClick={() => startCreating()}
              className="rounded-md px-3 py-1.5 text-xs bg-zinc-900 text-white hover:bg-zinc-700 flex items-center gap-1 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              <Plus className="h-3 w-3" />
              新建
            </button>
          </div>
        </div>

        {/* Content area — switches between tree detail and board */}
        {viewMode === 'board' ? (
          /* ── Board (Kanban) view ── */
          <div className="flex-1 overflow-x-auto overflow-y-hidden">
            <div className="flex h-full gap-4 p-4 min-w-max">
              {sortedCategories.map(cat => {
                const catDocs = docsByCategory[cat.id] ?? [];
                return (
                  <div
                    key={cat.id}
                    className="w-72 shrink-0 flex flex-col rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/30"
                  >
                    {/* Column header */}
                    <div className="flex items-center justify-between px-3 py-2.5 border-b border-zinc-200 dark:border-zinc-800">
                      <div className="flex items-center gap-1.5">
                        <h3 className="text-xs font-medium text-zinc-600 dark:text-zinc-400">{cat.name}</h3>
                        <span className="text-[10px] bg-zinc-200 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400 rounded-full px-1.5">{catDocs.length}</span>
                      </div>
                      <button
                        onClick={() => startCreating(cat.id)}
                        className="rounded p-0.5 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-200 dark:hover:bg-zinc-700 dark:hover:text-zinc-300"
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                    </div>

                    {/* Cards */}
                    <div className="flex-1 overflow-y-auto p-2 space-y-2">
                      {catDocs.map(doc => (
                        <div
                          key={doc.id}
                          onClick={() => { setViewMode('tree'); handleSelect(doc.id); }}
                          className={`rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-3 cursor-pointer hover:shadow-sm transition-shadow ${
                            doc.status === 'deprecated' ? 'opacity-50' : ''
                          }`}
                        >
                          <div className={`text-sm font-medium mb-1 ${
                            doc.status === 'deprecated' ? 'line-through text-zinc-400' : 'text-zinc-800 dark:text-zinc-200'
                          }`}>
                            {doc.title}
                          </div>
                          {doc.description && (
                            <div className="text-xs text-zinc-500 line-clamp-2 mb-2">{doc.description}</div>
                          )}
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${statusColor(doc.status)}`}>
                              {statusLabel(doc.status)}
                            </span>
                            {(doc.tags ?? []).slice(0, 2).map(tag => (
                              <span key={tag} className="rounded-full bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">
                                {tag}
                              </span>
                            ))}
                            {(doc.tags ?? []).length > 2 && (
                              <span className="text-[10px] text-zinc-400">+{(doc.tags ?? []).length - 2}</span>
                            )}
                          </div>
                          <div className="text-[10px] text-zinc-300 dark:text-zinc-600 mt-1.5">
                            {formatDate(doc.updatedAt)}
                          </div>
                        </div>
                      ))}
                      {catDocs.length === 0 && (
                        <div className="text-center text-[10px] text-zinc-400 py-4">
                          暂无文档
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Uncategorized column */}
              {(docsByCategory[uncategorizedId]?.length ?? 0) > 0 && (
                <div className="w-72 shrink-0 flex flex-col rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/30">
                  <div className="flex items-center justify-between px-3 py-2.5 border-b border-zinc-200 dark:border-zinc-800">
                    <div className="flex items-center gap-1.5">
                      <FolderOpen className="h-3 w-3 text-zinc-400" />
                      <h3 className="text-xs font-medium text-zinc-500">未分类</h3>
                      <span className="text-[10px] bg-zinc-200 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400 rounded-full px-1.5">{docsByCategory[uncategorizedId].length}</span>
                    </div>
                    <button onClick={() => startCreating()} className="rounded p-0.5 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-200 dark:hover:bg-zinc-700">
                      <Plus className="h-3 w-3" />
                    </button>
                  </div>
                  <div className="flex-1 overflow-y-auto p-2 space-y-2">
                    {docsByCategory[uncategorizedId].map(doc => (
                      <div
                        key={doc.id}
                        onClick={() => { setViewMode('tree'); handleSelect(doc.id); }}
                        className={`rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-3 cursor-pointer hover:shadow-sm transition-shadow ${
                          doc.status === 'deprecated' ? 'opacity-50' : ''
                        }`}
                      >
                        <div className={`text-sm font-medium mb-1 ${
                          doc.status === 'deprecated' ? 'line-through text-zinc-400' : 'text-zinc-800 dark:text-zinc-200'
                        }`}>
                          {doc.title}
                        </div>
                        {doc.description && (
                          <div className="text-xs text-zinc-500 line-clamp-2 mb-2">{doc.description}</div>
                        )}
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${statusColor(doc.status)}`}>
                            {statusLabel(doc.status)}
                          </span>
                          {(doc.tags ?? []).slice(0, 2).map(tag => (
                            <span key={tag} className="rounded-full bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">
                              {tag}
                            </span>
                          ))}
                        </div>
                        <div className="text-[10px] text-zinc-300 dark:text-zinc-600 mt-1.5">
                          {formatDate(doc.updatedAt)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : creating ? (
          /* ── Create form ── */
          <div className="flex-1 overflow-auto p-6">
            <h3 className="text-lg font-medium text-zinc-800 dark:text-zinc-200 mb-4">新建文档</h3>
            <div className="space-y-4 max-w-3xl">
              <div>
                <label className="block text-xs font-medium text-zinc-500 mb-1">标题</label>
                <input
                  autoFocus
                  value={docTitle}
                  onChange={e => setDocTitle(e.target.value)}
                  placeholder="文档标题"
                  className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:bg-zinc-900 dark:focus:border-zinc-400"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-500 mb-1">描述</label>
                <input
                  value={docDesc}
                  onChange={e => setDocDesc(e.target.value)}
                  placeholder="一句话描述"
                  className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:bg-zinc-900 dark:focus:border-zinc-400"
                />
              </div>
              <div className="flex gap-4">
                <div className="flex-1">
                  <label className="block text-xs font-medium text-zinc-500 mb-1">分类</label>
                  <select
                    value={docCategory}
                    onChange={e => setDocCategory(e.target.value)}
                    className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:bg-zinc-900"
                  >
                    <option value="">未分类</option>
                    {sortedCategories.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div className="flex-1">
                  <label className="block text-xs font-medium text-zinc-500 mb-1">状态</label>
                  <select
                    value={docStatus}
                    onChange={e => setDocStatus(e.target.value as DocStatus)}
                    className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:bg-zinc-900"
                  >
                    <option value="active">Active</option>
                    <option value="draft">Draft</option>
                  </select>
                </div>
              </div>
              {/* Tags */}
              <div>
                <label className="block text-xs font-medium text-zinc-500 mb-1">标签</label>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {docTags.map(tag => (
                    <span key={tag} className="flex items-center gap-1 rounded-full bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 text-xs text-zinc-600 dark:text-zinc-400">
                      <Tag className="h-2.5 w-2.5" />
                      {tag}
                      <button onClick={() => removeTag(tag)} className="text-zinc-400 hover:text-red-500">
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-1">
                  <input
                    value={newTagInput}
                    onChange={e => setNewTagInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
                    placeholder="添加标签..."
                    className="flex-1 rounded-md border border-zinc-300 dark:border-zinc-700 px-2 py-1 text-xs outline-none focus:border-zinc-400 dark:bg-zinc-900"
                    list="tag-suggestions"
                  />
                  <datalist id="tag-suggestions">
                    {allTags.map(t => <option key={t.tag} value={t.tag} />)}
                  </datalist>
                  <button onClick={addTag} className="rounded-md px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">
                    添加
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-500 mb-1">内容（Markdown）</label>
                <textarea
                  value={docContent}
                  onChange={e => setDocContent(e.target.value)}
                  placeholder="# 文档内容..."
                  rows={16}
                  className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 px-3 py-2 text-sm font-mono outline-none focus:border-zinc-500 dark:bg-zinc-900 dark:focus:border-zinc-400 resize-y"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleCreate}
                  disabled={!docTitle.trim() || saving}
                  className="rounded-md bg-zinc-900 px-4 py-2 text-sm text-white hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                >
                  {saving ? '创建中...' : '创建'}
                </button>
                <button
                  onClick={() => setCreating(false)}
                  className="rounded-md px-4 py-2 text-sm text-zinc-500 hover:text-zinc-700"
                >
                  取消
                </button>
              </div>
            </div>
          </div>
        ) : selectedId && selectedDoc ? (
          /* ── Tree view: Doc detail ── */
          <>
            {/* Metadata bar */}
            <div className="flex items-center gap-3 border-b border-zinc-100 dark:border-zinc-800/50 px-4 py-2">
              <select
                value={docCategory}
                onChange={e => { setDocCategory(e.target.value); if (!editing) setEditing(true); }}
                className="rounded-md border border-zinc-200 dark:border-zinc-700 px-2 py-1 text-xs outline-none dark:bg-zinc-900"
              >
                <option value="">未分类</option>
                {sortedCategories.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>

              <select
                value={docStatus}
                onChange={e => { setDocStatus(e.target.value as DocStatus); if (!editing) setEditing(true); }}
                className="rounded-md border border-zinc-200 dark:border-zinc-700 px-2 py-1 text-xs outline-none dark:bg-zinc-900"
              >
                <option value="active">Active</option>
                <option value="draft">Draft</option>
                <option value="deprecated">Deprecated</option>
              </select>

              {/* Tags inline */}
              <div className="flex items-center gap-1 flex-1 overflow-x-auto">
                {docTags.map(tag => (
                  <span key={tag} className="flex items-center gap-1 shrink-0 rounded-full bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-500">
                    {tag}
                    {editing && (
                      <button onClick={() => removeTag(tag)} className="text-zinc-400 hover:text-red-500">
                        <X className="h-2.5 w-2.5" />
                      </button>
                    )}
                  </span>
                ))}
                {editing && (
                  <input
                    value={newTagInput}
                    onChange={e => setNewTagInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
                    placeholder="+ 标签"
                    className="w-20 shrink-0 bg-transparent text-[10px] outline-none text-zinc-400 placeholder:text-zinc-300"
                    list="tag-suggestions-detail"
                  />
                )}
                <datalist id="tag-suggestions-detail">
                  {allTags.map(t => <option key={t.tag} value={t.tag} />)}
                </datalist>
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-1 shrink-0">
                {editing ? (
                  <>
                    <button
                      onClick={handleSave}
                      disabled={saving}
                      className="rounded-md px-3 py-1.5 text-xs bg-zinc-900 text-white hover:bg-zinc-700 disabled:opacity-40 flex items-center gap-1 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                    >
                      <Save className="h-3 w-3" />
                      {saving ? '保存中...' : '保存'}
                    </button>
                    <button
                      onClick={() => { setEditing(false); handleSelect(selectedId!); }}
                      className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => setEditing(true)}
                    className="rounded-md px-3 py-1.5 text-xs text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
                  >
                    编辑
                  </button>
                )}
              </div>
            </div>

            {/* Title & Description */}
            <div className="px-6 py-3 border-b border-zinc-100 dark:border-zinc-800/50">
              {editing ? (
                <div className="space-y-2">
                  <input
                    value={docTitle}
                    onChange={e => setDocTitle(e.target.value)}
                    className="w-full text-lg font-medium bg-transparent outline-none text-zinc-800 dark:text-zinc-200"
                    placeholder="文档标题"
                  />
                  <input
                    value={docDesc}
                    onChange={e => setDocDesc(e.target.value)}
                    className="w-full text-sm bg-transparent outline-none text-zinc-400"
                    placeholder="一句话描述"
                  />
                </div>
              ) : (
                <>
                  <h3 className="text-lg font-medium text-zinc-800 dark:text-zinc-200">{docTitle}</h3>
                  {docDesc && <p className="text-sm text-zinc-400 mt-1">{docDesc}</p>}
                </>
              )}
              <div className="flex gap-4 mt-2 text-[10px] text-zinc-400">
                <span>创建: {formatDate(selectedDoc.createdAt)}</span>
                <span>更新: {formatDate(selectedDoc.updatedAt)}</span>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-auto">
              {editing ? (
                <textarea
                  ref={textareaRef}
                  value={docContent}
                  onChange={e => setDocContent(e.target.value)}
                  className="w-full h-full px-6 py-4 text-sm font-mono outline-none resize-none bg-transparent dark:text-zinc-300"
                  spellCheck={false}
                />
              ) : (
                <pre className="px-6 py-4 text-sm font-mono whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">
                  {docContent || '（空内容）'}
                </pre>
              )}
            </div>
          </>
        ) : (
          /* ── Empty state ── */
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center text-zinc-400">
              <Library className="h-12 w-12 mx-auto mb-3 opacity-20" />
              <p className="text-sm">选择一个文档查看详情</p>
              <p className="text-xs mt-1">或切换到看板视图总览所有文档</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
