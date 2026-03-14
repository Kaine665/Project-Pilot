'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Plus, Trash2, History, RotateCcw, Save, X, ChevronRight, Blocks } from 'lucide-react';

// ── Types ──

interface SkillListItem {
  name: string;
  description: string;
  updatedAt: string;
}

// ── Page ──

export default function SkillsPage() {
  const [skills, setSkills] = useState<SkillListItem[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newContent, setNewContent] = useState('');
  const [versions, setVersions] = useState<string[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [viewingVersion, setViewingVersion] = useState<string | null>(null);
  const [versionContent, setVersionContent] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ── Fetch skills list ──
  const fetchSkills = useCallback(async () => {
    try {
      const res = await fetch('/api/skills');
      if (res.ok) {
        const data = await res.json();
        setSkills(data);
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchSkills(); }, [fetchSkills]);

  // ── Select skill ──
  const handleSelect = useCallback(async (name: string) => {
    setSelected(name);
    setEditing(false);
    setCreating(false);
    setShowHistory(false);
    setViewingVersion(null);
    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(name)}`);
      if (res.ok) {
        const data = await res.json();
        setContent(data.content ?? '');
        setOriginalContent(data.content ?? '');
      }
    } catch { /* ignore */ }
  }, []);

  // ── Save skill ──
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
    // 确保有基本的 frontmatter
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
  const handleDelete = async (name: string) => {
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
  const handleShowHistory = async () => {
    if (!selected) return;
    setShowHistory(v => !v);
    if (!showHistory) {
      try {
        const res = await fetch(`/api/skills/${encodeURIComponent(selected)}/history`);
        if (res.ok) {
          const data = await res.json();
          setVersions(data);
        }
      } catch { /* ignore */ }
    }
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
    if (!confirm(`确定回滚到版本 ${versionName}？当前版本会被快照保存。`)) return;
    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(selected)}/history/${encodeURIComponent(versionName)}/revert`, {
        method: 'POST',
      });
      if (res.ok) {
        setViewingVersion(null);
        setShowHistory(false);
        handleSelect(selected);
        fetchSkills();
      }
    } catch { /* ignore */ }
  };

  // ── Ctrl+S save ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's' && editing) {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  const isDirty = content !== originalContent;

  // ── Format version name for display ──
  const formatVersion = (v: string) => {
    // v_260314_054100 → 26-03-14 05:41:00
    const m = v.match(/v_(\d{2})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/);
    if (!m) return v;
    return `20${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}`;
  };

  return (
    <div className="flex h-full">
      {/* ── Left: Skill list ── */}
      <div className="w-72 shrink-0 border-r border-zinc-200 dark:border-zinc-800 flex flex-col bg-zinc-50/30 dark:bg-zinc-950/50">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 px-4 py-3">
          <div className="flex items-center gap-2">
            <Blocks className="h-4 w-4 text-zinc-500" />
            <h2 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Skills</h2>
            <span className="text-xs text-zinc-400">({skills.length})</span>
          </div>
          <button
            onClick={() => { setCreating(true); setSelected(null); setShowHistory(false); }}
            className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
            title="新建 Skill"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="px-4 py-8 text-center text-xs text-zinc-400">加载中...</div>
          ) : skills.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-zinc-400">
              暂无 Skill
              <br />
              <button
                onClick={() => setCreating(true)}
                className="mt-2 text-zinc-500 underline hover:text-zinc-700"
              >
                创建第一个
              </button>
            </div>
          ) : (
            skills.map(skill => (
              <div
                key={skill.name}
                onClick={() => handleSelect(skill.name)}
                className={`group flex items-start gap-2 cursor-pointer border-b border-zinc-100 dark:border-zinc-800/50 px-4 py-3 transition-colors ${
                  selected === skill.name
                    ? 'bg-zinc-100 dark:bg-zinc-800/60'
                    : 'hover:bg-zinc-50 dark:hover:bg-zinc-900/30'
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-zinc-800 dark:text-zinc-200 truncate">
                    {skill.name}
                  </div>
                  <div className="text-xs text-zinc-400 mt-0.5 line-clamp-2">
                    {skill.description || '无描述'}
                  </div>
                  <div className="text-[10px] text-zinc-300 dark:text-zinc-600 mt-1">
                    {new Date(skill.updatedAt).toLocaleDateString('zh-CN')}
                  </div>
                </div>
                <button
                  onClick={e => { e.stopPropagation(); handleDelete(skill.name); }}
                  className="opacity-0 group-hover:opacity-100 rounded p-1 text-zinc-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all"
                  title="删除"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── Right: Detail / Editor ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {creating ? (
          /* ── Create form ── */
          <div className="flex-1 flex flex-col p-6">
            <h3 className="text-lg font-medium text-zinc-800 dark:text-zinc-200 mb-4">新建 Skill</h3>
            <div className="space-y-4 max-w-2xl">
              <div>
                <label className="block text-xs font-medium text-zinc-500 mb-1">Skill 名称</label>
                <input
                  autoFocus
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder="如 git-commit, deploy-helper"
                  className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:bg-zinc-900 dark:focus:border-zinc-400"
                />
                <p className="mt-1 text-[10px] text-zinc-400">只能使用字母、数字、连字符和下划线</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-500 mb-1">内容（Markdown + YAML frontmatter）</label>
                <textarea
                  value={newContent}
                  onChange={e => setNewContent(e.target.value)}
                  placeholder={`---\nname: my-skill\ndescription: 一句话描述\n---\n\n# 指令\n\n你的 skill 指令...`}
                  rows={16}
                  className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 px-3 py-2 text-sm font-mono outline-none focus:border-zinc-500 dark:bg-zinc-900 dark:focus:border-zinc-400 resize-y"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleCreate}
                  disabled={!newName.trim() || saving}
                  className="rounded-md bg-zinc-900 px-4 py-2 text-sm text-white hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
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
        ) : selected ? (
          /* ── View/Edit skill ── */
          <>
            {/* Toolbar */}
            <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 px-4 py-2">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{selected}</h3>
                {isDirty && (
                  <span className="text-[10px] bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 px-1.5 py-0.5 rounded">
                    未保存
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={handleShowHistory}
                  className={`rounded-md p-1.5 text-xs flex items-center gap-1 transition-colors ${
                    showHistory
                      ? 'bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200'
                      : 'text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300'
                  }`}
                  title="版本历史"
                >
                  <History className="h-3.5 w-3.5" />
                  <span>历史</span>
                </button>
                {editing ? (
                  <>
                    <button
                      onClick={handleSave}
                      disabled={saving || !isDirty}
                      className="rounded-md px-3 py-1.5 text-xs bg-zinc-900 text-white hover:bg-zinc-700 disabled:opacity-40 flex items-center gap-1 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                    >
                      <Save className="h-3 w-3" />
                      {saving ? '保存中...' : '保存'}
                    </button>
                    <button
                      onClick={() => { setEditing(false); setContent(originalContent); }}
                      className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800"
                      title="取消编辑"
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

            <div className="flex flex-1 overflow-hidden">
              {/* Content area */}
              <div className="flex-1 overflow-auto">
                {editing ? (
                  <textarea
                    ref={textareaRef}
                    value={content}
                    onChange={e => setContent(e.target.value)}
                    className="w-full h-full px-6 py-4 text-sm font-mono outline-none resize-none bg-transparent dark:text-zinc-300"
                    spellCheck={false}
                  />
                ) : (
                  <pre className="px-6 py-4 text-sm font-mono whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">
                    {content || '（空内容）'}
                  </pre>
                )}
              </div>

              {/* History panel */}
              {showHistory && (
                <div className="w-64 shrink-0 border-l border-zinc-200 dark:border-zinc-800 overflow-y-auto bg-zinc-50/50 dark:bg-zinc-950/50">
                  <div className="px-3 py-2 border-b border-zinc-200 dark:border-zinc-800">
                    <h4 className="text-xs font-medium text-zinc-500">版本历史</h4>
                  </div>
                  {versions.length === 0 ? (
                    <div className="px-3 py-4 text-xs text-zinc-400 text-center">暂无历史版本</div>
                  ) : (
                    versions.map(v => (
                      <div
                        key={v}
                        className={`flex items-center justify-between px-3 py-2 border-b border-zinc-100 dark:border-zinc-800/50 cursor-pointer transition-colors ${
                          viewingVersion === v
                            ? 'bg-zinc-100 dark:bg-zinc-800/60'
                            : 'hover:bg-zinc-50 dark:hover:bg-zinc-900/30'
                        }`}
                        onClick={() => handleViewVersion(v)}
                      >
                        <div className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400">
                          <ChevronRight className="h-3 w-3" />
                          {formatVersion(v)}
                        </div>
                        <button
                          onClick={e => { e.stopPropagation(); handleRevert(v); }}
                          className="opacity-0 group-hover:opacity-100 rounded p-1 text-zinc-400 hover:text-blue-500"
                          title="回滚到此版本"
                        >
                          <RotateCcw className="h-3 w-3" />
                        </button>
                      </div>
                    ))
                  )}

                  {/* Version preview */}
                  {viewingVersion && (
                    <div className="border-t border-zinc-200 dark:border-zinc-800">
                      <div className="flex items-center justify-between px-3 py-2 bg-zinc-100 dark:bg-zinc-800/40">
                        <span className="text-[10px] text-zinc-500">预览: {formatVersion(viewingVersion)}</span>
                        <button
                          onClick={() => handleRevert(viewingVersion)}
                          className="flex items-center gap-1 text-[10px] text-blue-500 hover:text-blue-700"
                        >
                          <RotateCcw className="h-3 w-3" />
                          回滚
                        </button>
                      </div>
                      <pre className="px-3 py-2 text-[11px] font-mono whitespace-pre-wrap text-zinc-600 dark:text-zinc-400 max-h-60 overflow-y-auto">
                        {versionContent || '（空）'}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        ) : (
          /* ── Empty state ── */
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center text-zinc-400">
              <Blocks className="h-12 w-12 mx-auto mb-3 opacity-20" />
              <p className="text-sm">选择一个 Skill 查看详情</p>
              <p className="text-xs mt-1">或点击左上角 + 创建新 Skill</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
