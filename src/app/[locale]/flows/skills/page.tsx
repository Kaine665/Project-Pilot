'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Plus, Trash2, History, RotateCcw, Save, X, Blocks,
  FileText, FileCode, BookOpen, Image, FolderOpen,
  ArrowLeft, ChevronRight, Clock, Search,
} from 'lucide-react';

// ── Types ──

interface SkillListItem {
  name: string;
  description: string;
  updatedAt: string;
}

interface SkillFileItem {
  name: string;
  subdir: 'scripts' | 'references' | 'assets';
  size: number;
  updatedAt: string;
}

type DetailTab = 'overview' | 'scripts' | 'references' | 'assets' | 'history';

// ── Helpers ──

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

function formatVersion(v: string) {
  const m = v.match(/v_(\d{2})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/);
  if (!m) return v;
  return `20${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}`;
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function subdirIcon(subdir: string) {
  switch (subdir) {
    case 'scripts': return <FileCode className="h-4 w-4 text-blue-500" />;
    case 'references': return <BookOpen className="h-4 w-4 text-amber-500" />;
    case 'assets': return <Image className="h-4 w-4 text-purple-500" />;
    default: return <FileText className="h-4 w-4 text-zinc-400" />;
  }
}

const SUBDIR_LABELS: Record<string, string> = {
  scripts: 'Scripts',
  references: 'References',
  assets: 'Assets',
};

// ── Page ──

export default function SkillsPage() {
  // Global state
  const [skills, setSkills] = useState<SkillListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // Detail view
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<DetailTab>('overview');

  // Sub-files
  const [subFiles, setSubFiles] = useState<SkillFileItem[]>([]);
  const [viewingFile, setViewingFile] = useState<{ subdir: string; name: string; content: string } | null>(null);
  const [editingFile, setEditingFile] = useState(false);
  const [fileContent, setFileContent] = useState('');

  // History
  const [versions, setVersions] = useState<string[]>([]);
  const [viewingVersion, setViewingVersion] = useState<string | null>(null);
  const [versionContent, setVersionContent] = useState('');

  // Create
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newContent, setNewContent] = useState('');

  // Add file
  const [addingFile, setAddingFile] = useState<string | null>(null); // subdir name
  const [newFileName, setNewFileName] = useState('');
  const [newFileContent, setNewFileContent] = useState('');

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ── Fetch skills list ──
  const fetchSkills = useCallback(async () => {
    try {
      const res = await fetch('/api/skills');
      if (res.ok) setSkills(await res.json());
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchSkills(); }, [fetchSkills]);

  // ── Select skill ──
  const handleSelect = useCallback(async (name: string) => {
    setSelected(name);
    setEditing(false);
    setActiveTab('overview');
    setViewingFile(null);
    setViewingVersion(null);
    setAddingFile(null);
    try {
      const [skillRes, filesRes] = await Promise.all([
        fetch(`/api/skills/${encodeURIComponent(name)}`),
        fetch(`/api/skills/${encodeURIComponent(name)}/files`),
      ]);
      if (skillRes.ok) {
        const data = await skillRes.json();
        setContent(data.content ?? '');
        setOriginalContent(data.content ?? '');
      }
      if (filesRes.ok) {
        setSubFiles(await filesRes.json());
      }
    } catch { /* ignore */ }
  }, []);

  // ── Save SKILL.md ──
  const handleSave = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(selected)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      if (res.ok) {
        setOriginalContent(content);
        setEditing(false);
        fetchSkills();
      }
    } catch { /* ignore */ }
    finally { setSaving(false); }
  };

  // ── Create skill ──
  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    let finalContent = newContent.trim();
    if (!finalContent.startsWith('---')) {
      finalContent = `---\nname: ${name}\ndescription: \n---\n\n${finalContent}`;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, content: finalContent }),
      });
      if (res.ok) {
        setCreating(false);
        setNewName('');
        setNewContent('');
        await fetchSkills();
        handleSelect(name);
      }
    } catch { /* ignore */ }
    finally { setSaving(false); }
  };

  // ── Delete skill ──
  const handleDelete = async (name: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!confirm(`确定删除 skill "${name}"？此操作不可恢复。`)) return;
    try {
      await fetch(`/api/skills/${encodeURIComponent(name)}`, { method: 'DELETE' });
      if (selected === name) {
        setSelected(null);
        setContent('');
        setOriginalContent('');
      }
      fetchSkills();
    } catch { /* ignore */ }
  };

  // ── Version history ──
  const fetchVersions = async (name: string) => {
    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(name)}/history`);
      if (res.ok) setVersions(await res.json());
    } catch { /* ignore */ }
  };

  const handleViewVersion = async (versionName: string) => {
    if (!selected) return;
    setViewingVersion(versionName);
    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(selected)}/history/${encodeURIComponent(versionName)}`);
      if (res.ok) {
        const data = await res.json();
        setVersionContent(data.content ?? '');
      }
    } catch { /* ignore */ }
  };

  const handleRevert = async (versionName: string) => {
    if (!selected) return;
    if (!confirm(`确定回滚到版本 ${formatVersion(versionName)}？当前版本会被快照保存。`)) return;
    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(selected)}/history/${encodeURIComponent(versionName)}/revert`, {
        method: 'POST',
      });
      if (res.ok) {
        setViewingVersion(null);
        handleSelect(selected);
        fetchSkills();
      }
    } catch { /* ignore */ }
  };

  // ── Sub-file operations ──
  const handleViewSubFile = async (subdir: string, fileName: string) => {
    if (!selected) return;
    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(selected)}/files/${encodeURIComponent(subdir)}/${encodeURIComponent(fileName)}`);
      if (res.ok) {
        const data = await res.json();
        setViewingFile({ subdir, name: fileName, content: data.content });
        setFileContent(data.content);
        setEditingFile(false);
      }
    } catch { /* ignore */ }
  };

  const handleSaveSubFile = async () => {
    if (!selected || !viewingFile) return;
    setSaving(true);
    try {
      const res = await fetch(
        `/api/skills/${encodeURIComponent(selected)}/files/${encodeURIComponent(viewingFile.subdir)}/${encodeURIComponent(viewingFile.name)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: fileContent }),
        },
      );
      if (res.ok) {
        setViewingFile({ ...viewingFile, content: fileContent });
        setEditingFile(false);
        // Refresh file list
        const filesRes = await fetch(`/api/skills/${encodeURIComponent(selected)}/files`);
        if (filesRes.ok) setSubFiles(await filesRes.json());
      }
    } catch { /* ignore */ }
    finally { setSaving(false); }
  };

  const handleDeleteSubFile = async (subdir: string, fileName: string) => {
    if (!selected) return;
    if (!confirm(`确定删除文件 "${fileName}"？`)) return;
    try {
      await fetch(
        `/api/skills/${encodeURIComponent(selected)}/files/${encodeURIComponent(subdir)}/${encodeURIComponent(fileName)}`,
        { method: 'DELETE' },
      );
      if (viewingFile?.subdir === subdir && viewingFile?.name === fileName) {
        setViewingFile(null);
      }
      const filesRes = await fetch(`/api/skills/${encodeURIComponent(selected)}/files`);
      if (filesRes.ok) setSubFiles(await filesRes.json());
    } catch { /* ignore */ }
  };

  const handleAddFile = async () => {
    if (!selected || !addingFile || !newFileName.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(
        `/api/skills/${encodeURIComponent(selected)}/files/${encodeURIComponent(addingFile)}/${encodeURIComponent(newFileName.trim())}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: newFileContent }),
        },
      );
      if (res.ok) {
        setAddingFile(null);
        setNewFileName('');
        setNewFileContent('');
        const filesRes = await fetch(`/api/skills/${encodeURIComponent(selected)}/files`);
        if (filesRes.ok) setSubFiles(await filesRes.json());
      }
    } catch { /* ignore */ }
    finally { setSaving(false); }
  };

  // ── Tab switching ──
  const handleTabChange = (tab: DetailTab) => {
    setActiveTab(tab);
    setViewingFile(null);
    setViewingVersion(null);
    setAddingFile(null);
    if (tab === 'history' && selected) {
      fetchVersions(selected);
    }
  };

  // ── Ctrl+S ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        if (editing) { e.preventDefault(); handleSave(); }
        else if (editingFile && viewingFile) { e.preventDefault(); handleSaveSubFile(); }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  const isDirty = content !== originalContent;
  const filteredSkills = searchQuery
    ? skills.filter(s =>
        s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.description.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : skills;

  const filesForTab = (subdir: string) => subFiles.filter(f => f.subdir === subdir);

  // ── Detail View ──
  if (selected) {
    const skill = skills.find(s => s.name === selected);
    const TABS: { key: DetailTab; label: string; count?: number }[] = [
      { key: 'overview', label: 'Overview' },
      { key: 'scripts', label: 'Scripts', count: filesForTab('scripts').length },
      { key: 'references', label: 'References', count: filesForTab('references').length },
      { key: 'assets', label: 'Assets', count: filesForTab('assets').length },
      { key: 'history', label: 'History' },
    ];

    return (
      <div className="flex h-full flex-col overflow-hidden">
        {/* Header */}
        <div className="shrink-0 border-b border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-950/80 backdrop-blur-sm">
          <div className="flex items-center gap-3 px-5 py-3">
            <button
              onClick={() => { setSelected(null); setEditing(false); }}
              className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300 transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <Blocks className="h-4 w-4 text-zinc-400" />
                <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200 truncate">{selected}</h2>
                {isDirty && activeTab === 'overview' && (
                  <span className="text-[10px] bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 px-1.5 py-0.5 rounded-full font-medium">
                    未保存
                  </span>
                )}
              </div>
              {skill && (
                <p className="text-xs text-zinc-400 mt-0.5 truncate">{skill.description || '无描述'}</p>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              {activeTab === 'overview' && (
                editing ? (
                  <>
                    <button
                      onClick={handleSave}
                      disabled={saving || !isDirty}
                      className="rounded-md px-3 py-1.5 text-xs bg-zinc-900 text-white hover:bg-zinc-700 disabled:opacity-40 flex items-center gap-1.5 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300 transition-colors"
                    >
                      <Save className="h-3 w-3" />
                      {saving ? '保存中...' : '保存'}
                    </button>
                    <button
                      onClick={() => { setEditing(false); setContent(originalContent); }}
                      className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 transition-colors"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => setEditing(true)}
                    className="rounded-md px-3 py-1.5 text-xs text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-300 transition-colors"
                  >
                    编辑
                  </button>
                )
              )}
              {(activeTab === 'scripts' || activeTab === 'references' || activeTab === 'assets') && (
                <button
                  onClick={() => { setAddingFile(activeTab); setNewFileName(''); setNewFileContent(''); }}
                  className="rounded-md px-3 py-1.5 text-xs text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-300 flex items-center gap-1.5 transition-colors"
                >
                  <Plus className="h-3 w-3" />
                  添加文件
                </button>
              )}
              <button
                onClick={() => handleDelete(selected)}
                className="rounded-md p-1.5 text-zinc-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                title="删除 Skill"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex px-5 gap-0 -mb-px">
            {TABS.map(tab => (
              <button
                key={tab.key}
                onClick={() => handleTabChange(tab.key)}
                className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
                  activeTab === tab.key
                    ? 'border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100'
                    : 'border-transparent text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300'
                }`}
              >
                {tab.label}
                {tab.count !== undefined && tab.count > 0 && (
                  <span className="ml-1.5 text-[10px] bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded-full">
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-auto">
          {/* Overview Tab */}
          {activeTab === 'overview' && (
            <div className="h-full">
              {editing ? (
                <textarea
                  ref={textareaRef}
                  value={content}
                  onChange={e => setContent(e.target.value)}
                  className="w-full h-full px-6 py-4 text-sm font-mono outline-none resize-none bg-transparent dark:text-zinc-300"
                  spellCheck={false}
                />
              ) : (
                <pre className="px-6 py-4 text-sm font-mono whitespace-pre-wrap text-zinc-700 dark:text-zinc-300 leading-relaxed">
                  {content || '（空内容）'}
                </pre>
              )}
            </div>
          )}

          {/* Scripts / References / Assets Tab */}
          {(activeTab === 'scripts' || activeTab === 'references' || activeTab === 'assets') && (
            <div className="flex h-full">
              {/* File list */}
              <div className={`${viewingFile ? 'w-72 shrink-0 border-r border-zinc-200 dark:border-zinc-800' : 'flex-1 max-w-3xl mx-auto'}`}>
                {/* Add file form */}
                {addingFile === activeTab && (
                  <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50">
                    <div className="space-y-3">
                      <input
                        autoFocus
                        value={newFileName}
                        onChange={e => setNewFileName(e.target.value)}
                        placeholder="文件名（如 deploy.sh）"
                        className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 text-sm outline-none focus:border-zinc-500 dark:bg-zinc-900 dark:focus:border-zinc-400"
                      />
                      <textarea
                        value={newFileContent}
                        onChange={e => setNewFileContent(e.target.value)}
                        placeholder="文件内容..."
                        rows={4}
                        className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 text-sm font-mono outline-none focus:border-zinc-500 dark:bg-zinc-900 dark:focus:border-zinc-400 resize-y"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={handleAddFile}
                          disabled={!newFileName.trim() || saving}
                          className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs text-white hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                        >
                          {saving ? '创建中...' : '创建'}
                        </button>
                        <button
                          onClick={() => setAddingFile(null)}
                          className="rounded-md px-3 py-1.5 text-xs text-zinc-500 hover:text-zinc-700"
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* File entries */}
                {filesForTab(activeTab).length === 0 && addingFile !== activeTab ? (
                  <div className="flex flex-col items-center justify-center py-16 text-zinc-400">
                    <FolderOpen className="h-10 w-10 mb-3 opacity-30" />
                    <p className="text-sm">暂无 {SUBDIR_LABELS[activeTab]} 文件</p>
                    <button
                      onClick={() => { setAddingFile(activeTab); setNewFileName(''); setNewFileContent(''); }}
                      className="mt-3 text-xs text-zinc-500 underline hover:text-zinc-700 dark:hover:text-zinc-300"
                    >
                      添加第一个
                    </button>
                  </div>
                ) : (
                  <div className="divide-y divide-zinc-100 dark:divide-zinc-800/50">
                    {filesForTab(activeTab).map(file => (
                      <div
                        key={file.name}
                        onClick={() => handleViewSubFile(file.subdir, file.name)}
                        className={`group flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors ${
                          viewingFile?.name === file.name && viewingFile?.subdir === file.subdir
                            ? 'bg-zinc-100 dark:bg-zinc-800/60'
                            : 'hover:bg-zinc-50 dark:hover:bg-zinc-900/30'
                        }`}
                      >
                        {subdirIcon(file.subdir)}
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-zinc-700 dark:text-zinc-300 truncate font-medium">{file.name}</div>
                          <div className="text-[10px] text-zinc-400 mt-0.5">
                            {formatSize(file.size)} · {formatDateTime(file.updatedAt)}
                          </div>
                        </div>
                        <button
                          onClick={e => { e.stopPropagation(); handleDeleteSubFile(file.subdir, file.name); }}
                          className="opacity-0 group-hover:opacity-100 rounded p-1 text-zinc-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                        <ChevronRight className="h-3.5 w-3.5 text-zinc-300 dark:text-zinc-600" />
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* File preview */}
              {viewingFile && (
                <div className="flex-1 flex flex-col overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/30 dark:bg-zinc-950/30">
                    <div className="flex items-center gap-2">
                      {subdirIcon(viewingFile.subdir)}
                      <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{viewingFile.name}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      {editingFile ? (
                        <>
                          <button
                            onClick={handleSaveSubFile}
                            disabled={saving || fileContent === viewingFile.content}
                            className="rounded-md px-3 py-1.5 text-xs bg-zinc-900 text-white hover:bg-zinc-700 disabled:opacity-40 flex items-center gap-1 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                          >
                            <Save className="h-3 w-3" />
                            {saving ? '保存中...' : '保存'}
                          </button>
                          <button
                            onClick={() => { setEditingFile(false); setFileContent(viewingFile.content); }}
                            className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => setEditingFile(true)}
                          className="rounded-md px-3 py-1.5 text-xs text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
                        >
                          编辑
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="flex-1 overflow-auto">
                    {editingFile ? (
                      <textarea
                        value={fileContent}
                        onChange={e => setFileContent(e.target.value)}
                        className="w-full h-full px-6 py-4 text-sm font-mono outline-none resize-none bg-transparent dark:text-zinc-300"
                        spellCheck={false}
                      />
                    ) : (
                      <pre className="px-6 py-4 text-sm font-mono whitespace-pre-wrap text-zinc-700 dark:text-zinc-300 leading-relaxed">
                        {viewingFile.content || '（空文件）'}
                      </pre>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* History Tab */}
          {activeTab === 'history' && (
            <div className="flex h-full">
              {/* Version list */}
              <div className={`${viewingVersion ? 'w-80 shrink-0 border-r border-zinc-200 dark:border-zinc-800' : 'flex-1 max-w-2xl mx-auto'}`}>
                {versions.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-zinc-400">
                    <History className="h-10 w-10 mb-3 opacity-30" />
                    <p className="text-sm">暂无历史版本</p>
                    <p className="text-xs mt-1">编辑保存后会自动创建版本快照</p>
                  </div>
                ) : (
                  <div className="divide-y divide-zinc-100 dark:divide-zinc-800/50">
                    {versions.map(v => (
                      <div
                        key={v}
                        onClick={() => handleViewVersion(v)}
                        className={`group flex items-center justify-between px-4 py-3 cursor-pointer transition-colors ${
                          viewingVersion === v
                            ? 'bg-zinc-100 dark:bg-zinc-800/60'
                            : 'hover:bg-zinc-50 dark:hover:bg-zinc-900/30'
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <Clock className="h-3.5 w-3.5 text-zinc-400" />
                          <span className="text-sm text-zinc-600 dark:text-zinc-400 font-mono">
                            {formatVersion(v)}
                          </span>
                        </div>
                        <button
                          onClick={e => { e.stopPropagation(); handleRevert(v); }}
                          className="opacity-0 group-hover:opacity-100 rounded-md px-2 py-1 text-xs text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 flex items-center gap-1 transition-all"
                        >
                          <RotateCcw className="h-3 w-3" />
                          回滚
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Version preview */}
              {viewingVersion && (
                <div className="flex-1 flex flex-col overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/30 dark:bg-zinc-950/30">
                    <div className="flex items-center gap-2">
                      <Clock className="h-3.5 w-3.5 text-zinc-400" />
                      <span className="text-xs text-zinc-500 font-mono">{formatVersion(viewingVersion)}</span>
                    </div>
                    <button
                      onClick={() => handleRevert(viewingVersion)}
                      className="rounded-md px-3 py-1.5 text-xs text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 flex items-center gap-1"
                    >
                      <RotateCcw className="h-3 w-3" />
                      回滚到此版本
                    </button>
                  </div>
                  <pre className="flex-1 overflow-auto px-6 py-4 text-sm font-mono whitespace-pre-wrap text-zinc-600 dark:text-zinc-400 leading-relaxed">
                    {versionContent || '（空）'}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Create Form ──
  if (creating) {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <div className="shrink-0 border-b border-zinc-200 dark:border-zinc-800 px-5 py-3 flex items-center gap-3">
          <button
            onClick={() => { setCreating(false); setNewName(''); setNewContent(''); }}
            className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">新建 Skill</h2>
        </div>
        <div className="flex-1 overflow-auto p-6">
          <div className="space-y-4 max-w-2xl">
            <div>
              <label className="block text-xs font-medium text-zinc-500 mb-1.5">Skill 名称</label>
              <input
                autoFocus
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="如 git-commit, deploy-helper"
                className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 px-3 py-2 text-sm outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500/20 dark:bg-zinc-900 dark:focus:border-zinc-400"
              />
              <p className="mt-1 text-[10px] text-zinc-400">只能使用字母、数字、连字符和下划线</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-500 mb-1.5">SKILL.md 内容</label>
              <textarea
                value={newContent}
                onChange={e => setNewContent(e.target.value)}
                placeholder={`---\nname: my-skill\ndescription: 一句话描述\n---\n\n# 指令\n\n你的 skill 指令...`}
                rows={18}
                className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 px-3 py-2 text-sm font-mono outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500/20 dark:bg-zinc-900 dark:focus:border-zinc-400 resize-y"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleCreate}
                disabled={!newName.trim() || saving}
                className="rounded-md bg-zinc-900 px-4 py-2 text-sm text-white hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300 transition-colors"
              >
                {saving ? '创建中...' : '创建'}
              </button>
              <button
                onClick={() => { setCreating(false); setNewName(''); setNewContent(''); }}
                className="rounded-md px-4 py-2 text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Grid Dashboard ──
  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 border-b border-zinc-200 dark:border-zinc-800 px-5 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Blocks className="h-5 w-5 text-zinc-400" />
            <h1 className="text-base font-semibold text-zinc-800 dark:text-zinc-200">Skills</h1>
            <span className="text-xs text-zinc-400 bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded-full">
              {skills.length}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400" />
              <input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="搜索..."
                className="w-48 rounded-md border border-zinc-200 dark:border-zinc-700 pl-8 pr-3 py-1.5 text-xs outline-none focus:border-zinc-400 dark:bg-zinc-900 dark:focus:border-zinc-500 transition-colors"
              />
            </div>
            <button
              onClick={() => { setCreating(true); setSelected(null); }}
              className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs text-white hover:bg-zinc-700 flex items-center gap-1.5 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              新建
            </button>
          </div>
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-auto p-5">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-zinc-400 text-sm">加载中...</div>
        ) : filteredSkills.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-zinc-400">
            <Blocks className="h-12 w-12 mb-4 opacity-20" />
            {searchQuery ? (
              <p className="text-sm">未找到匹配的 Skill</p>
            ) : (
              <>
                <p className="text-sm">暂无 Skill</p>
                <button
                  onClick={() => setCreating(true)}
                  className="mt-3 text-xs text-zinc-500 underline hover:text-zinc-700 dark:hover:text-zinc-300"
                >
                  创建第一个 Skill
                </button>
              </>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {filteredSkills.map(skill => (
              <div
                key={skill.name}
                onClick={() => handleSelect(skill.name)}
                className="group rounded-lg border border-zinc-200 dark:border-zinc-800 p-4 cursor-pointer hover:border-zinc-300 dark:hover:border-zinc-700 hover:shadow-sm transition-all bg-white dark:bg-zinc-950"
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className="rounded-md bg-zinc-100 dark:bg-zinc-800 p-1.5">
                      <Blocks className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
                    </div>
                    <h3 className="text-sm font-medium text-zinc-800 dark:text-zinc-200 truncate">
                      {skill.name}
                    </h3>
                  </div>
                  <button
                    onClick={e => handleDelete(skill.name, e)}
                    className="opacity-0 group-hover:opacity-100 rounded p-1 text-zinc-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
                <p className="text-xs text-zinc-400 line-clamp-2 mb-3 min-h-[2rem]">
                  {skill.description || '无描述'}
                </p>
                <div className="flex items-center justify-between text-[10px] text-zinc-400">
                  <div className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {formatDate(skill.updatedAt)}
                  </div>
                  <div className="flex items-center gap-1 text-zinc-300">
                    <FolderOpen className="h-3 w-3" />
                    <span>SKILL.md</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
