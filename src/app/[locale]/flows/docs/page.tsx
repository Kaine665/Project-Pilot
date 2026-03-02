'use client';

import { useState, useEffect, useCallback } from 'react';
import { FileText, Plus, Trash2, X, Clock } from 'lucide-react';
import type { DocEntry } from '@/types';

interface ProjectOption {
  key: string;
  name: string;
}

function formatDateTime(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function DocsPage() {
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [selectedProject, setSelectedProject] = useState('');
  const [docs, setDocs] = useState<DocEntry[]>([]);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [content, setContent] = useState('');
  const [originalTitle, setOriginalTitle] = useState('');
  const [originalDescription, setOriginalDescription] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [saving, setSaving] = useState(false);

  // Fetch project list
  const fetchProjects = useCallback(async () => {
    try {
      const res = await fetch('/api/data/projects');
      const data = await res.json();
      const list: ProjectOption[] = (data.projects ?? [])
        .filter((p: ProjectOption & { archived?: boolean }) => !p.archived)
        .map((p: ProjectOption) => ({ key: p.key, name: p.name }));
      setProjects(list);
      return list;
    } catch {
      return [];
    }
  }, []);

  useEffect(() => {
    fetchProjects().then(list => {
      if (list.length > 0 && !selectedProject) {
        setSelectedProject(list[0].key);
      }
    });
  }, [fetchProjects, selectedProject]);

  // Fetch docs for selected project
  const fetchDocs = useCallback(async (projectKey: string) => {
    if (!projectKey) { setDocs([]); return; }
    try {
      const res = await fetch(`/api/docs?project=${encodeURIComponent(projectKey)}`);
      const data = await res.json();
      setDocs(data.docs ?? []);
    } catch {
      setDocs([]);
    }
  }, []);

  useEffect(() => {
    if (selectedProject) {
      fetchDocs(selectedProject);
      handleClose();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProject, fetchDocs]);

  const loadDocContent = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/docs/${id}`);
      if (!res.ok) return;
      const data = await res.json();
      setTitle(data.entry.title ?? '');
      setDescription(data.entry.description ?? '');
      setContent(data.content ?? '');
      setOriginalTitle(data.entry.title ?? '');
      setOriginalDescription(data.entry.description ?? '');
      setOriginalContent(data.content ?? '');
    } catch { /* ignore */ }
  }, []);

  const handleSelect = (doc: DocEntry) => {
    setCreating(false);
    setSelectedDocId(doc.id);
    loadDocContent(doc.id);
  };

  const handleStartCreate = () => {
    setSelectedDocId(null);
    setCreating(true);
    setTitle('');
    setDescription('');
    setContent('');
    setOriginalTitle('');
    setOriginalDescription('');
    setOriginalContent('');
  };

  const handleClose = () => {
    setSelectedDocId(null);
    setCreating(false);
    setTitle('');
    setDescription('');
    setContent('');
    setOriginalTitle('');
    setOriginalDescription('');
    setOriginalContent('');
  };

  const hasChanges = creating
    ? title.trim().length > 0
    : title !== originalTitle || description !== originalDescription || content !== originalContent;

  const handleSave = async () => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      if (creating) {
        const res = await fetch('/api/docs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectKey: selectedProject,
            title: title.trim(),
            description: description.trim() || undefined,
            content,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          await fetchDocs(selectedProject);
          setCreating(false);
          setSelectedDocId(data.entry.id);
          setOriginalTitle(data.entry.title);
          setOriginalDescription(data.entry.description ?? '');
          setOriginalContent(content);
        }
      } else if (selectedDocId) {
        const res = await fetch(`/api/docs/${selectedDocId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: title.trim(),
            description: description.trim() || '',
            content,
          }),
        });
        if (res.ok) {
          await fetchDocs(selectedProject);
          setOriginalTitle(title.trim());
          setOriginalDescription(description.trim());
          setOriginalContent(content);
        }
      }
    } catch { /* ignore */ }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    const doc = docs.find(d => d.id === id);
    if (!confirm(`确定要删除文档「${doc?.title ?? id}」吗？此操作不可撤销。`)) return;
    try {
      const res = await fetch(`/api/docs/${id}`, { method: 'DELETE' });
      if (res.ok) {
        await fetchDocs(selectedProject);
        if (selectedDocId === id) handleClose();
      }
    } catch { /* ignore */ }
  };

  const isEditing = creating || selectedDocId !== null;
  const selectedDoc = selectedDocId ? docs.find(d => d.id === selectedDocId) : null;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1100px] px-6 py-10">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <FileText className="h-5 w-5 text-zinc-400" />
            <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">设计文档</h1>
            <span className="text-sm text-zinc-400">({docs.length})</span>
          </div>
          <div className="flex items-center gap-3">
            {/* Project selector */}
            <select
              value={selectedProject}
              onChange={e => setSelectedProject(e.target.value)}
              className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-700 outline-none focus:border-zinc-400 focus:ring-1 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:focus:border-zinc-500 dark:focus:ring-zinc-500"
            >
              {projects.length === 0 && (
                <option value="">请先创建项目</option>
              )}
              {projects.map(p => (
                <option key={p.key} value={p.key}>{p.name}</option>
              ))}
            </select>
            <button
              onClick={handleStartCreate}
              disabled={!selectedProject}
              className="flex items-center gap-1.5 rounded-md bg-zinc-900 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              <Plus className="h-3.5 w-3.5" />
              新建文档
            </button>
          </div>
        </div>

        {/* Doc list */}
        {docs.length === 0 && !isEditing ? (
          <div className="flex flex-col items-center justify-center py-20 text-zinc-400">
            <FileText className="mb-3 h-10 w-10" />
            <p className="text-sm">暂无设计文档</p>
            <p className="mt-1 text-xs">添加项目设计文档，记录架构决策和设计约束，供 AI Agent 按需读取</p>
          </div>
        ) : (
          <div className="space-y-2">
            {docs.map(doc => (
              <button
                key={doc.id}
                onClick={() => handleSelect(doc)}
                className={`group flex w-full items-center justify-between rounded-lg border px-5 py-3.5 text-left transition-colors ${
                  selectedDocId === doc.id
                    ? 'border-zinc-400 bg-zinc-100 dark:border-zinc-500 dark:bg-zinc-800'
                    : 'border-zinc-200 bg-white hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-zinc-600 dark:hover:bg-zinc-800'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 shrink-0 text-zinc-400" />
                    <span className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">{doc.title}</span>
                  </div>
                  {doc.description && (
                    <p className="mt-1 truncate pl-6 text-xs text-zinc-400">{doc.description}</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-3 pl-4">
                  <span className="text-[11px] text-zinc-300 dark:text-zinc-600">
                    {formatDateTime(doc.updatedAt)}
                  </span>
                  <button
                    onClick={e => { e.stopPropagation(); handleDelete(doc.id); }}
                    className="rounded p-1 text-zinc-300 opacity-0 transition-all hover:bg-red-50 hover:text-red-500 group-hover:opacity-100 dark:text-zinc-600 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                    title="删除"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Editor area */}
        {isEditing && (
          <div className="mt-6 rounded-xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
            {/* Editor header */}
            <div className="flex items-center justify-between border-b border-zinc-100 px-6 py-3 dark:border-zinc-800">
              <div className="flex items-center gap-3">
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  {creating ? '新建设计文档' : '编辑设计文档'}
                </h3>
                {selectedDoc && (
                  <div className="flex items-center gap-3 text-[11px] text-zinc-400 dark:text-zinc-500">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      创建于 {formatDateTime(selectedDoc.createdAt)}
                    </span>
                    {selectedDoc.updatedAt !== selectedDoc.createdAt && (
                      <span>修改于 {formatDateTime(selectedDoc.updatedAt)}</span>
                    )}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1">
                {!creating && selectedDocId && (
                  <button
                    onClick={() => handleDelete(selectedDocId)}
                    className="rounded-md p-1.5 text-zinc-400 hover:bg-red-50 hover:text-red-500 transition-colors dark:hover:bg-red-900/20"
                    title="删除"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
                <button
                  onClick={handleClose}
                  className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 transition-colors dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
                  title="关闭"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Form */}
            <div className="space-y-4 px-6 py-4">
              {/* Row 1: Title + Description */}
              <div className="flex gap-4">
                <div className="flex-1">
                  <label className="mb-1.5 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
                    标题 <span className="text-red-400">*</span>
                  </label>
                  <input
                    autoFocus
                    value={title}
                    onChange={e => setTitle(e.target.value)}
                    placeholder="例如：数据库迁移规范"
                    className="w-full rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none placeholder:text-zinc-400 focus:border-zinc-400 focus:ring-1 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 dark:placeholder:text-zinc-500 dark:focus:border-zinc-500 dark:focus:ring-zinc-500"
                  />
                </div>
                <div className="flex-1">
                  <label className="mb-1.5 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
                    描述
                  </label>
                  <input
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    placeholder="简要描述此文档的内容，帮助 AI 判断是否需要读取"
                    className="w-full rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none placeholder:text-zinc-400 focus:border-zinc-400 focus:ring-1 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 dark:placeholder:text-zinc-500 dark:focus:border-zinc-500 dark:focus:ring-zinc-500"
                  />
                </div>
              </div>

              {/* Content */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  文档内容（Markdown）
                </label>
                <textarea
                  value={content}
                  onChange={e => setContent(e.target.value)}
                  placeholder="输入设计文档内容..."
                  rows={18}
                  className="w-full resize-y rounded-md border border-zinc-200 px-3 py-2 font-mono text-sm leading-relaxed outline-none placeholder:text-zinc-400 focus:border-zinc-400 focus:ring-1 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 dark:placeholder:text-zinc-500 dark:focus:border-zinc-500 dark:focus:ring-zinc-500"
                />
              </div>

              {/* Actions */}
              <div className="flex items-center gap-3 pt-1">
                <button
                  onClick={handleSave}
                  disabled={!title.trim() || saving || !hasChanges}
                  className="rounded-md bg-zinc-900 px-5 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                >
                  {saving ? '保存中...' : creating ? '创建' : '保存'}
                </button>
                <button
                  onClick={handleClose}
                  className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-600 transition-colors"
                >
                  取消
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
