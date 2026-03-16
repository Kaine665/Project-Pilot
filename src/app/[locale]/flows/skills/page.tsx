'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Plus, Trash2, History, RotateCcw, Save, X, Blocks,
  FileText, FileCode, BookOpen, Image, FolderOpen,
  ArrowLeft, ChevronRight, ChevronDown, Clock, Search,
  Folder, Download, Copy, Check,
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

type ActiveFile =
  | { type: 'skill.md' }
  | { type: 'subfile'; subdir: string; name: string };

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

function subdirIcon(subdir: string, className = 'h-4 w-4') {
  switch (subdir) {
    case 'scripts': return <FileCode className={`${className} text-blue-500`} />;
    case 'references': return <BookOpen className={`${className} text-amber-500`} />;
    case 'assets': return <Image className={`${className} text-purple-500`} />;
    default: return <FileText className={`${className} text-zinc-400`} />;
  }
}

const SUBDIRS = ['scripts', 'references', 'assets'] as const;
const SUBDIR_LABELS: Record<string, string> = {
  scripts: 'Scripts',
  references: 'References',
  assets: 'Assets',
};
const SUBDIR_COLORS: Record<string, string> = {
  scripts: 'text-blue-500',
  references: 'text-amber-500',
  assets: 'text-purple-500',
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

  // File tree
  const [activeFile, setActiveFile] = useState<ActiveFile>({ type: 'skill.md' });
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set(['scripts', 'references', 'assets']));

  // Sub-files
  const [subFiles, setSubFiles] = useState<SkillFileItem[]>([]);
  const [fileContent, setFileContent] = useState('');
  const [originalFileContent, setOriginalFileContent] = useState('');
  const [editingFile, setEditingFile] = useState(false);

  // History panel
  const [showHistory, setShowHistory] = useState(false);
  const [versions, setVersions] = useState<string[]>([]);
  const [viewingVersion, setViewingVersion] = useState<string | null>(null);
  const [versionContent, setVersionContent] = useState('');

  // Create
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newContent, setNewContent] = useState('');

  // Add file
  const [addingFile, setAddingFile] = useState<string | null>(null);
  const [newFileName, setNewFileName] = useState('');
  const [newFileContent, setNewFileContent] = useState('');

  // Export
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showBatchExportMenu, setShowBatchExportMenu] = useState(false);
  const [exportCopied, setExportCopied] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const batchExportMenuRef = useRef<HTMLDivElement>(null);

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
    setEditingFile(false);
    setActiveFile({ type: 'skill.md' });
    setShowHistory(false);
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

  // ── Select file in tree ──
  const handleSelectFile = async (file: ActiveFile) => {
    setActiveFile(file);
    setEditingFile(false);
    setEditing(false);
    setAddingFile(null);
    if (file.type === 'subfile' && selected) {
      try {
        const res = await fetch(
          `/api/skills/${encodeURIComponent(selected)}/files/${encodeURIComponent(file.subdir)}/${encodeURIComponent(file.name)}`
        );
        if (res.ok) {
          const data = await res.json();
          setFileContent(data.content);
          setOriginalFileContent(data.content);
        }
      } catch { /* ignore */ }
    }
  };

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

  // ── Save sub-file ──
  const handleSaveSubFile = async () => {
    if (!selected || activeFile.type !== 'subfile') return;
    setSaving(true);
    try {
      const res = await fetch(
        `/api/skills/${encodeURIComponent(selected)}/files/${encodeURIComponent(activeFile.subdir)}/${encodeURIComponent(activeFile.name)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: fileContent }),
        },
      );
      if (res.ok) {
        setOriginalFileContent(fileContent);
        setEditingFile(false);
        const filesRes = await fetch(`/api/skills/${encodeURIComponent(selected)}/files`);
        if (filesRes.ok) setSubFiles(await filesRes.json());
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

  // ── Delete sub-file ──
  const handleDeleteSubFile = async (subdir: string, fileName: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!selected) return;
    if (!confirm(`确定删除文件 "${fileName}"？`)) return;
    try {
      await fetch(
        `/api/skills/${encodeURIComponent(selected)}/files/${encodeURIComponent(subdir)}/${encodeURIComponent(fileName)}`,
        { method: 'DELETE' },
      );
      // If we were viewing this file, go back to SKILL.md
      if (activeFile.type === 'subfile' && activeFile.subdir === subdir && activeFile.name === fileName) {
        setActiveFile({ type: 'skill.md' });
        setEditingFile(false);
      }
      const filesRes = await fetch(`/api/skills/${encodeURIComponent(selected)}/files`);
      if (filesRes.ok) setSubFiles(await filesRes.json());
    } catch { /* ignore */ }
  };

  // ── Add file ──
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
        const addedSubdir = addingFile;
        const addedName = newFileName.trim();
        setAddingFile(null);
        setNewFileName('');
        setNewFileContent('');
        const filesRes = await fetch(`/api/skills/${encodeURIComponent(selected)}/files`);
        if (filesRes.ok) setSubFiles(await filesRes.json());
        // Auto-select the new file
        handleSelectFile({ type: 'subfile', subdir: addedSubdir, name: addedName });
      }
    } catch { /* ignore */ }
    finally { setSaving(false); }
  };

  // ── Version history ──
  const fetchVersions = async (name: string) => {
    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(name)}/history`);
      if (res.ok) setVersions(await res.json());
    } catch { /* ignore */ }
  };

  const handleToggleHistory = () => {
    if (!showHistory && selected) {
      fetchVersions(selected);
    }
    setShowHistory(!showHistory);
    setViewingVersion(null);
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
        setShowHistory(false);
        setViewingVersion(null);
        handleSelect(selected);
        fetchSkills();
      }
    } catch { /* ignore */ }
  };

  // ── Toggle folder ──
  const toggleDir = (dir: string) => {
    setExpandedDirs(prev => {
      const next = new Set(prev);
      if (next.has(dir)) next.delete(dir);
      else next.add(dir);
      return next;
    });
  };

  // ── Export ──
  const handleExport = async (format: string) => {
    if (!selected) return;
    setShowExportMenu(false);
    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(selected)}/export?format=${format}`);
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${selected}-${format}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch { /* ignore */ }
  };

  const handleCopyExport = async (_format: string) => {
    // ZIP 格式无法复制到剪贴板，此功能已停用
    setShowExportMenu(false);
  };

  const handleBatchExport = async (format: string) => {
    setShowBatchExportMenu(false);
    try {
      const res = await fetch(`/api/skills/export-all?format=${format}&output=zip`);
      if (!res.ok) return;
      const blob = await res.blob();
      const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `skills-export-${format}-${timestamp}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch { /* ignore */ }
  };

  // Close export menus on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (showExportMenu && exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setShowExportMenu(false);
      }
      if (showBatchExportMenu && batchExportMenuRef.current && !batchExportMenuRef.current.contains(e.target as Node)) {
        setShowBatchExportMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showExportMenu, showBatchExportMenu]);

  // ── Ctrl+S ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        if (editing && activeFile.type === 'skill.md') { e.preventDefault(); handleSave(); }
        else if (editingFile && activeFile.type === 'subfile') { e.preventDefault(); handleSaveSubFile(); }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  const isDirty = activeFile.type === 'skill.md' && content !== originalContent;
  const isFileDirty = activeFile.type === 'subfile' && fileContent !== originalFileContent;
  const filteredSkills = searchQuery
    ? skills.filter(s =>
        s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.description.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : skills;

  const filesForDir = (subdir: string) => subFiles.filter(f => f.subdir === subdir);

  // Helper: is this file currently active?
  const isFileActive = (file: ActiveFile) => {
    if (activeFile.type === 'skill.md' && file.type === 'skill.md') return true;
    if (activeFile.type === 'subfile' && file.type === 'subfile') {
      return activeFile.subdir === file.subdir && activeFile.name === file.name;
    }
    return false;
  };

  // ── Breadcrumb path ──
  const breadcrumb = () => {
    const parts: string[] = [selected ?? ''];
    if (activeFile.type === 'skill.md') {
      parts.push('SKILL.md');
    } else {
      parts.push(activeFile.subdir, activeFile.name);
    }
    return parts;
  };

  // ── Detail View (File Tree + Editor) ──
  if (selected) {
    const skill = skills.find(s => s.name === selected);
    const isEditing = activeFile.type === 'skill.md' ? editing : editingFile;
    const currentIsDirty = activeFile.type === 'skill.md' ? isDirty : isFileDirty;

    return (
      <div className="flex h-full flex-col overflow-hidden">
        {/* Header with breadcrumb */}
        <div className="shrink-0 border-b border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-950/80 backdrop-blur-sm">
          <div className="flex items-center gap-3 px-4 py-2.5">
            <button
              onClick={() => { setSelected(null); setEditing(false); setShowHistory(false); }}
              className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300 transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>

            {/* Breadcrumb */}
            <div className="flex items-center gap-1 flex-1 min-w-0 text-xs">
              {breadcrumb().map((part, i) => (
                <span key={i} className="flex items-center gap-1">
                  {i > 0 && <ChevronRight className="h-3 w-3 text-zinc-300 dark:text-zinc-600 shrink-0" />}
                  <span className={`truncate ${i === breadcrumb().length - 1 ? 'text-zinc-800 dark:text-zinc-200 font-medium' : 'text-zinc-400'}`}>
                    {part}
                  </span>
                </span>
              ))}
              {currentIsDirty && (
                <span className="ml-2 text-[10px] bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 px-1.5 py-0.5 rounded-full font-medium shrink-0">
                  未保存
                </span>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1 shrink-0">
              {isEditing ? (
                <>
                  <button
                    onClick={activeFile.type === 'skill.md' ? handleSave : handleSaveSubFile}
                    disabled={saving || !currentIsDirty}
                    className="rounded-md px-3 py-1.5 text-xs bg-zinc-900 text-white hover:bg-zinc-700 disabled:opacity-40 flex items-center gap-1.5 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300 transition-colors"
                  >
                    <Save className="h-3 w-3" />
                    {saving ? '保存中...' : '保存'}
                  </button>
                  <button
                    onClick={() => {
                      if (activeFile.type === 'skill.md') { setEditing(false); setContent(originalContent); }
                      else { setEditingFile(false); setFileContent(originalFileContent); }
                    }}
                    className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 transition-colors"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </>
              ) : (
                <button
                  onClick={() => {
                    if (activeFile.type === 'skill.md') setEditing(true);
                    else setEditingFile(true);
                  }}
                  className="rounded-md px-3 py-1.5 text-xs text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-300 transition-colors"
                >
                  编辑
                </button>
              )}
              {/* Export dropdown */}
              <div className="relative" ref={exportMenuRef}>
                <button
                  onClick={() => setShowExportMenu(!showExportMenu)}
                  className={`rounded-md p-1.5 transition-colors ${
                    showExportMenu
                      ? 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
                      : 'text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300'
                  }`}
                  title="导出"
                >
                  {exportCopied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Download className="h-3.5 w-3.5" />}
                </button>
                {showExportMenu && (
                  <div className="absolute right-0 top-full mt-1 w-52 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-lg z-50 py-1 overflow-hidden">
                    <div className="px-3 py-1.5 text-[10px] font-medium text-zinc-400 uppercase tracking-wider">下载</div>
                    <button
                      onClick={() => handleExport('openclaw')}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                    >
                      <Download className="h-3 w-3 text-zinc-400" />
                      OpenClaw 格式
                    </button>
                    <button
                      onClick={() => handleExport('raw')}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                    >
                      <Download className="h-3 w-3 text-zinc-400" />
                      原始 Markdown
                    </button>
                    <button
                      onClick={() => handleExport('json')}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                    >
                      <Download className="h-3 w-3 text-zinc-400" />
                      JSON（通用）
                    </button>
                    <div className="border-t border-zinc-100 dark:border-zinc-800 my-1" />
                    <div className="px-3 py-1.5 text-[10px] font-medium text-zinc-400 uppercase tracking-wider">复制到剪贴板</div>
                    <button
                      onClick={() => handleCopyExport('openclaw')}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                    >
                      <Copy className="h-3 w-3 text-zinc-400" />
                      OpenClaw 格式
                    </button>
                    <button
                      onClick={() => handleCopyExport('raw')}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                    >
                      <Copy className="h-3 w-3 text-zinc-400" />
                      原始 Markdown
                    </button>
                  </div>
                )}
              </div>
              <button
                onClick={handleToggleHistory}
                className={`rounded-md p-1.5 transition-colors ${
                  showHistory
                    ? 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
                    : 'text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300'
                }`}
                title="版本历史"
              >
                <History className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => handleDelete(selected)}
                className="rounded-md p-1.5 text-zinc-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                title="删除 Skill"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Main area: File Tree + Editor + History */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left: File Tree */}
          <div className="w-56 shrink-0 border-r border-zinc-200 dark:border-zinc-800 overflow-y-auto bg-zinc-50/30 dark:bg-zinc-950/30">
            {/* Skill info */}
            <div className="px-3 py-3 border-b border-zinc-100 dark:border-zinc-800/50">
              <div className="flex items-center gap-2 mb-1">
                <Blocks className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
                <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 truncate">{selected}</span>
              </div>
              {skill && (
                <p className="text-[10px] text-zinc-400 truncate pl-5.5">{skill.description || '无描述'}</p>
              )}
            </div>

            {/* File tree */}
            <div className="py-1">
              {/* SKILL.md - root file */}
              <button
                onClick={() => handleSelectFile({ type: 'skill.md' })}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors ${
                  isFileActive({ type: 'skill.md' })
                    ? 'bg-zinc-200/70 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 font-medium'
                    : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/50'
                }`}
              >
                <FileText className="h-3.5 w-3.5 text-zinc-500 shrink-0" />
                <span className="truncate">SKILL.md</span>
              </button>

              {/* Subdirectories */}
              {SUBDIRS.map(subdir => {
                const files = filesForDir(subdir);
                const isExpanded = expandedDirs.has(subdir);
                return (
                  <div key={subdir}>
                    {/* Folder header */}
                    <div className="flex items-center group">
                      <button
                        onClick={() => toggleDir(subdir)}
                        className="flex-1 flex items-center gap-1.5 px-3 py-1.5 text-xs text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/50 transition-colors"
                      >
                        {isExpanded
                          ? <ChevronDown className="h-3 w-3 shrink-0" />
                          : <ChevronRight className="h-3 w-3 shrink-0" />
                        }
                        <Folder className={`h-3.5 w-3.5 shrink-0 ${SUBDIR_COLORS[subdir]}`} />
                        <span className="truncate">{SUBDIR_LABELS[subdir]}</span>
                        {files.length > 0 && (
                          <span className="text-[10px] text-zinc-400 ml-auto">{files.length}</span>
                        )}
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!isExpanded) toggleDir(subdir);
                          setAddingFile(subdir);
                          setNewFileName('');
                          setNewFileContent('');
                        }}
                        className="opacity-0 group-hover:opacity-100 p-1 mr-1 rounded text-zinc-400 hover:text-zinc-600 hover:bg-zinc-200 dark:hover:text-zinc-300 dark:hover:bg-zinc-700 transition-all"
                        title={`添加 ${SUBDIR_LABELS[subdir]} 文件`}
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                    </div>

                    {/* Folder contents */}
                    {isExpanded && (
                      <div>
                        {/* Add file inline form */}
                        {addingFile === subdir && (
                          <div className="pl-8 pr-2 py-2">
                            <input
                              autoFocus
                              value={newFileName}
                              onChange={e => setNewFileName(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter' && newFileName.trim()) handleAddFile();
                                if (e.key === 'Escape') setAddingFile(null);
                              }}
                              placeholder="文件名..."
                              className="w-full rounded border border-zinc-300 dark:border-zinc-600 px-2 py-1 text-[11px] outline-none focus:border-zinc-500 dark:bg-zinc-900 dark:focus:border-zinc-400"
                            />
                            <div className="flex gap-1 mt-1">
                              <button
                                onClick={handleAddFile}
                                disabled={!newFileName.trim() || saving}
                                className="rounded px-2 py-0.5 text-[10px] bg-zinc-900 text-white hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                              >
                                {saving ? '...' : '创建'}
                              </button>
                              <button
                                onClick={() => setAddingFile(null)}
                                className="rounded px-2 py-0.5 text-[10px] text-zinc-400 hover:text-zinc-600"
                              >
                                取消
                              </button>
                            </div>
                          </div>
                        )}

                        {/* File entries */}
                        {files.map(file => {
                          const fileRef: ActiveFile = { type: 'subfile', subdir: file.subdir, name: file.name };
                          return (
                            <div
                              key={`${file.subdir}/${file.name}`}
                              className={`group flex items-center gap-2 pl-8 pr-2 py-1.5 cursor-pointer transition-colors ${
                                isFileActive(fileRef)
                                  ? 'bg-zinc-200/70 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100'
                                  : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/50'
                              }`}
                              onClick={() => handleSelectFile(fileRef)}
                            >
                              {subdirIcon(file.subdir, 'h-3.5 w-3.5')}
                              <span className="flex-1 text-xs truncate">{file.name}</span>
                              <span className="text-[9px] text-zinc-400 opacity-0 group-hover:opacity-100 shrink-0">
                                {formatSize(file.size)}
                              </span>
                              <button
                                onClick={e => handleDeleteSubFile(file.subdir, file.name, e)}
                                className="opacity-0 group-hover:opacity-100 rounded p-0.5 text-zinc-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all shrink-0"
                              >
                                <Trash2 className="h-2.5 w-2.5" />
                              </button>
                            </div>
                          );
                        })}

                        {/* Empty state */}
                        {files.length === 0 && addingFile !== subdir && (
                          <div className="pl-8 pr-2 py-2">
                            <span className="text-[10px] text-zinc-400 italic">空</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Center: Editor */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* File header bar */}
            <div className="shrink-0 flex items-center justify-between px-4 py-2 border-b border-zinc-100 dark:border-zinc-800/50 bg-white dark:bg-zinc-950">
              <div className="flex items-center gap-2">
                {activeFile.type === 'skill.md'
                  ? <FileText className="h-3.5 w-3.5 text-zinc-500" />
                  : subdirIcon(activeFile.subdir, 'h-3.5 w-3.5')
                }
                <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  {activeFile.type === 'skill.md' ? 'SKILL.md' : activeFile.name}
                </span>
              </div>
              {activeFile.type === 'subfile' && (
                <span className="text-[10px] text-zinc-400">
                  {SUBDIR_LABELS[activeFile.subdir]}
                </span>
              )}
            </div>

            {/* Editor content */}
            <div className="flex-1 overflow-auto">
              {activeFile.type === 'skill.md' ? (
                // SKILL.md content
                editing ? (
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
                )
              ) : (
                // Sub-file content
                editingFile ? (
                  <textarea
                    value={fileContent}
                    onChange={e => setFileContent(e.target.value)}
                    className="w-full h-full px-6 py-4 text-sm font-mono outline-none resize-none bg-transparent dark:text-zinc-300"
                    spellCheck={false}
                  />
                ) : (
                  <pre className="px-6 py-4 text-sm font-mono whitespace-pre-wrap text-zinc-700 dark:text-zinc-300 leading-relaxed">
                    {fileContent || '（空文件）'}
                  </pre>
                )
              )}
            </div>
          </div>

          {/* Right: History Panel (slide-out) */}
          {showHistory && (
            <div className="w-72 shrink-0 border-l border-zinc-200 dark:border-zinc-800 flex flex-col overflow-hidden bg-white dark:bg-zinc-950">
              <div className="shrink-0 flex items-center justify-between px-3 py-2.5 border-b border-zinc-100 dark:border-zinc-800/50">
                <div className="flex items-center gap-2">
                  <History className="h-3.5 w-3.5 text-zinc-400" />
                  <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">版本历史</span>
                </div>
                <button
                  onClick={() => { setShowHistory(false); setViewingVersion(null); }}
                  className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 transition-colors"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>

              {/* Version list or preview */}
              <div className="flex-1 overflow-auto">
                {viewingVersion ? (
                  // Version preview
                  <div className="flex flex-col h-full">
                    <div className="shrink-0 flex items-center justify-between px-3 py-2 border-b border-zinc-100 dark:border-zinc-800/50 bg-zinc-50/50 dark:bg-zinc-900/50">
                      <button
                        onClick={() => setViewingVersion(null)}
                        className="flex items-center gap-1 text-[10px] text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                      >
                        <ArrowLeft className="h-3 w-3" />
                        返回
                      </button>
                      <button
                        onClick={() => handleRevert(viewingVersion)}
                        className="rounded px-2 py-1 text-[10px] text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 flex items-center gap-1"
                      >
                        <RotateCcw className="h-2.5 w-2.5" />
                        回滚
                      </button>
                    </div>
                    <div className="px-2 py-1.5 text-[10px] text-zinc-400 font-mono border-b border-zinc-100 dark:border-zinc-800/50">
                      {formatVersion(viewingVersion)}
                    </div>
                    <pre className="flex-1 overflow-auto px-3 py-3 text-[11px] font-mono whitespace-pre-wrap text-zinc-600 dark:text-zinc-400 leading-relaxed">
                      {versionContent || '（空）'}
                    </pre>
                  </div>
                ) : versions.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-zinc-400">
                    <History className="h-8 w-8 mb-2 opacity-20" />
                    <p className="text-xs">暂无历史版本</p>
                    <p className="text-[10px] mt-1 text-zinc-400/60">保存后自动创建快照</p>
                  </div>
                ) : (
                  <div className="divide-y divide-zinc-100 dark:divide-zinc-800/50">
                    {versions.map(v => (
                      <div
                        key={v}
                        onClick={() => handleViewVersion(v)}
                        className="group flex items-center justify-between px-3 py-2.5 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-900/30 transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <Clock className="h-3 w-3 text-zinc-400 shrink-0" />
                          <span className="text-[11px] text-zinc-600 dark:text-zinc-400 font-mono">
                            {formatVersion(v)}
                          </span>
                        </div>
                        <button
                          onClick={e => { e.stopPropagation(); handleRevert(v); }}
                          className="opacity-0 group-hover:opacity-100 rounded px-1.5 py-0.5 text-[10px] text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 flex items-center gap-0.5 transition-all"
                        >
                          <RotateCcw className="h-2.5 w-2.5" />
                          回滚
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
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
            {/* Batch export */}
            <div className="relative" ref={batchExportMenuRef}>
              <button
                onClick={() => setShowBatchExportMenu(!showBatchExportMenu)}
                disabled={skills.length === 0}
                className="rounded-md border border-zinc-200 dark:border-zinc-700 px-3 py-1.5 text-xs text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-40 flex items-center gap-1.5 transition-colors"
              >
                <Download className="h-3.5 w-3.5" />
                批量导出
              </button>
              {showBatchExportMenu && (
                <div className="absolute right-0 top-full mt-1 w-48 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-lg z-50 py-1 overflow-hidden">
                  <button
                    onClick={() => handleBatchExport('openclaw')}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                  >
                    <Download className="h-3 w-3 text-zinc-400" />
                    OpenClaw 格式
                  </button>
                  <button
                    onClick={() => handleBatchExport('raw')}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                  >
                    <Download className="h-3 w-3 text-zinc-400" />
                    原始 Markdown
                  </button>
                  <button
                    onClick={() => handleBatchExport('json')}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                  >
                    <Download className="h-3 w-3 text-zinc-400" />
                    JSON（通用）
                  </button>
                </div>
              )}
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
