'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { BookOpen, Plus, Trash2, X, User, Key, Server, Monitor, FolderTree, Globe, Database, Mail, Clock, FolderOpen, Upload, Check, Bot } from 'lucide-react';
import type { ContextEntry } from '@/types';
import type { LucideIcon } from 'lucide-react';
import { useProject } from '@/components/project-context';

type FormData = {
  label: string;
  description: string;
  fileName: string;
  format: 'json' | 'markdown' | 'text';
  group: string;
  sourcePath: string;
};

const emptyForm: FormData = { label: '', description: '', fileName: '', format: 'text', group: '', sourcePath: '' };

type ContextTemplate = {
  icon: LucideIcon;
  label: string;
  description: string;
  fileName: string;
  format: FormData['format'];
  content: string;
};

const CONTEXT_TEMPLATES: ContextTemplate[] = [
  {
    icon: User,
    label: '个人信息',
    description: '姓名、邮箱、偏好语言等基本信息',
    fileName: 'personal-info.json',
    format: 'json',
    content: JSON.stringify({
      name: '',
      email: '',
      language: 'zh-CN',
      timezone: 'Asia/Shanghai',
      github: '',
      preferences: {
        codeStyle: '',
        favoriteEditor: '',
        communicationLanguage: '',
      },
    }, null, 2),
  },
  {
    icon: Key,
    label: 'AI API Keys',
    description: 'OpenAI、Anthropic、Google 等 AI 服务密钥',
    fileName: 'ai-api-keys.json',
    format: 'json',
    content: JSON.stringify({
      openai: { apiKey: '', organization: '', defaultModel: 'gpt-4o' },
      anthropic: { apiKey: '', defaultModel: 'claude-sonnet-4-20250514' },
      google: { apiKey: '', defaultModel: 'gemini-2.0-flash' },
      deepseek: { apiKey: '', defaultModel: 'deepseek-chat' },
      groq: { apiKey: '' },
    }, null, 2),
  },
  {
    icon: Server,
    label: '服务 API Keys',
    description: 'GitHub、Vercel、AWS 等第三方服务凭证',
    fileName: 'service-api-keys.json',
    format: 'json',
    content: JSON.stringify({
      github: { token: '', username: '' },
      vercel: { token: '' },
      aws: { accessKeyId: '', secretAccessKey: '', region: '' },
      cloudflare: { apiToken: '', accountId: '' },
      supabase: { url: '', anonKey: '', serviceRoleKey: '' },
      firebase: { projectId: '', apiKey: '' },
    }, null, 2),
  },
  {
    icon: Monitor,
    label: '开发环境',
    description: '操作系统、Node 版本、包管理器等开发环境信息',
    fileName: 'dev-environment.md',
    format: 'markdown',
    content: `# 开发环境

## 操作系统
- OS:
- 架构:

## 运行时
- Node.js:
- Python:
- Java:

## 包管理器
- npm/yarn/pnpm:
- pip/conda:

## 编辑器 & IDE
- 主力编辑器:
- 常用插件:

## 其他工具
- Docker:
- Git 版本:
`,
  },
  {
    icon: FolderTree,
    label: '项目概览',
    description: '项目名称、技术栈、目录结构等项目级信息',
    fileName: 'project-overview.md',
    format: 'markdown',
    content: `# 项目概览

## 基本信息
- 项目名称:
- 仓库地址:
- 部署地址:

## 技术栈
- 框架:
- 语言:
- 数据库:
- 部署平台:

## 目录结构
\`\`\`
src/
├── app/          #
├── components/   #
├── lib/          #
└── types/        #
\`\`\`

## 开发命令
- 启动: \`npm run dev\`
- 构建: \`npm run build\`
- 测试: \`npm test\`
`,
  },
  {
    icon: Globe,
    label: '常用网址',
    description: '项目文档、管理后台、API 端点等常用链接',
    fileName: 'bookmarks.json',
    format: 'json',
    content: JSON.stringify({
      documentation: [],
      dashboards: [],
      apis: [],
      repositories: [],
    }, null, 2),
  },
  {
    icon: Database,
    label: '数据库连接',
    description: '数据库连接字符串、Redis 地址等',
    fileName: 'database-connections.json',
    format: 'json',
    content: JSON.stringify({
      postgres: { host: '', port: 5432, database: '', user: '', password: '' },
      mysql: { host: '', port: 3306, database: '', user: '', password: '' },
      redis: { host: '', port: 6379, password: '' },
      mongodb: { uri: '' },
    }, null, 2),
  },
  {
    icon: Mail,
    label: '邮件 & 通知',
    description: 'SMTP、Webhook、通知服务等配置',
    fileName: 'notifications.json',
    format: 'json',
    content: JSON.stringify({
      smtp: { host: '', port: 587, user: '', password: '', from: '' },
      slack: { webhookUrl: '' },
      discord: { webhookUrl: '' },
      telegram: { botToken: '', chatId: '' },
    }, null, 2),
  },
];

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function entryToForm(e: ContextEntry): FormData {
  return {
    label: e.label,
    description: e.description,
    fileName: e.fileName,
    format: e.format,
    group: e.group ?? '',
    sourcePath: e.sourcePath ?? '',
  };
}

function detectFormat(fileName: string): FormData['format'] {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'json') return 'json';
  if (ext === 'md' || ext === 'markdown') return 'markdown';
  return 'text';
}

const FORMAT_OPTIONS: Array<{ value: FormData['format']; label: string }> = [
  { value: 'json', label: 'JSON' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'text', label: 'Text' },
];

function EntryCard({ entry, selectedId, onSelect, onDelete, isGlobal }: {
  entry: ContextEntry;
  selectedId: string | null;
  onSelect: (entry: ContextEntry) => void;
  onDelete: (id: string) => void;
  isGlobal?: boolean;
}) {
  return (
    <div
      onClick={() => onSelect(entry)}
      className={`group relative cursor-pointer rounded-lg border px-5 py-4 transition-colors ${
        selectedId === entry.id
          ? 'border-zinc-400 bg-zinc-100 dark:border-zinc-500 dark:bg-zinc-800'
          : 'border-zinc-200 bg-white hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-zinc-600 dark:hover:bg-zinc-800/60'
      }`}
    >
      <button
        onClick={e => { e.stopPropagation(); onDelete(entry.id); }}
        className="absolute right-2 top-2 rounded-md p-1 text-zinc-300 opacity-0 transition-opacity hover:bg-red-50 hover:text-red-500 group-hover:opacity-100 dark:text-zinc-600 dark:hover:bg-red-900/20 dark:hover:text-red-400"
        title="删除"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
      <div className="flex items-center gap-2 pr-6">
        <div className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
          {entry.label}
        </div>
        <span className="shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500">
          {entry.format}
        </span>
        {isGlobal && (
          <span className="shrink-0 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-400 dark:bg-blue-900/20 dark:text-blue-400">
            全局
          </span>
        )}
      </div>
      <div className="mt-1.5 text-xs leading-relaxed text-zinc-400 dark:text-zinc-500 line-clamp-1">
        {entry.description || entry.fileName}
      </div>
      <div className="mt-2 text-[10px] text-zinc-300 dark:text-zinc-600">
        {formatDateTime(entry.updatedAt)}
      </div>
    </div>
  );
}

export default function ContextPage() {
  const { activeKey } = useProject();
  const [entries, setEntries] = useState<ContextEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FormData>(emptyForm);
  const [content, setContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [originalForm, setOriginalForm] = useState<FormData>(emptyForm);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = (ev.target?.result as string) ?? '';
      setContent(text);
      setForm(f => ({
        ...f,
        fileName: f.fileName || file.name,
        label: f.label || file.name.replace(/\.[^.]+$/, ''),
        format: detectFormat(file.name),
        sourcePath: f.sourcePath || file.name,
      }));
    };
    reader.readAsText(file);
    // Reset so the same file can be re-selected
    e.target.value = '';
  };

  const fetchEntries = useCallback(async () => {
    try {
      const url = activeKey ? `/api/context?projectKey=${activeKey}` : '/api/context';
      const res = await fetch(url);
      const data = await res.json();
      setEntries(data.entries ?? []);
    } catch {
      setEntries([]);
    }
  }, [activeKey]);

  useEffect(() => { fetchEntries(); handleClose(); }, [fetchEntries]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadEntryContent = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/context/${id}`);
      if (!res.ok) return;
      const data = await res.json();
      setContent(data.content ?? '');
      setOriginalContent(data.content ?? '');
    } catch { /* ignore */ }
  }, []);

  const handleSelect = (entry: ContextEntry) => {
    setCreating(false);
    setSelectedId(entry.id);
    const f = entryToForm(entry);
    setForm(f);
    setOriginalForm(f);
    loadEntryContent(entry.id);
  };

  const handleStartCreate = () => {
    setSelectedId(null);
    setCreating(true);
    setForm(emptyForm);
    setOriginalForm(emptyForm);
    setContent('');
    setOriginalContent('');
  };

  const handleTemplateClick = (tpl: ContextTemplate) => {
    setSelectedId(null);
    setCreating(true);
    const f: FormData = {
      label: tpl.label,
      description: tpl.description,
      fileName: tpl.fileName,
      format: tpl.format,
      group: '',
      sourcePath: '',
    };
    setForm(f);
    setOriginalForm(emptyForm);
    setContent(tpl.content);
    setOriginalContent('');
  };

  const usedFileNames = new Set(entries.map(e => e.fileName));
  const availableTemplates = CONTEXT_TEMPLATES.filter(t => !usedFileNames.has(t.fileName));

  const handleClose = () => {
    setSelectedId(null);
    setCreating(false);
    setForm(emptyForm);
    setOriginalForm(emptyForm);
    setContent('');
    setOriginalContent('');
  };

  const hasChanges = creating
    ? form.label.trim().length > 0
    : form.label !== originalForm.label
      || form.description !== originalForm.description
      || form.fileName !== originalForm.fileName
      || form.format !== originalForm.format
      || form.group !== originalForm.group
      || form.sourcePath !== originalForm.sourcePath
      || content !== originalContent;

  const handleSave = async () => {
    const label = form.label.trim();
    const fileName = form.fileName.trim();
    if (!label || !fileName) return;
    setSaving(true);
    try {
      if (creating) {
        const res = await fetch('/api/context', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            label,
            description: form.description.trim(),
            fileName,
            format: form.format,
            group: form.group.trim() || undefined,
            sourcePath: form.sourcePath.trim() || undefined,
            projectKey: activeKey || undefined,
            content,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          await fetchEntries();
          setCreating(false);
          setSelectedId(data.entry.id);
          const f = entryToForm(data.entry);
          setForm(f);
          setOriginalForm(f);
          setOriginalContent(content);
        }
      } else if (selectedId) {
        const res = await fetch(`/api/context/${selectedId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            label,
            description: form.description.trim(),
            fileName,
            format: form.format,
            group: form.group.trim() || '',
            sourcePath: form.sourcePath.trim() || '',
            content,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          await fetchEntries();
          const f = entryToForm(data.entry);
          setForm(f);
          setOriginalForm(f);
          setOriginalContent(content);
        }
      }
    } catch { /* ignore */ }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    const entry = entries.find(e => e.id === id);
    if (!confirm(`确定要删除上下文条目「${entry?.label ?? id}」吗？此操作不可撤销。`)) return;
    try {
      const res = await fetch(`/api/context/${id}`, { method: 'DELETE' });
      if (res.ok) {
        await fetchEntries();
        if (selectedId === id) handleClose();
      }
    } catch { /* ignore */ }
  };

  const handleConfirmDraft = async (id: string) => {
    try {
      const res = await fetch(`/api/context/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'active' }),
      });
      if (res.ok) await fetchEntries();
    } catch { /* ignore */ }
  };

  const handleDiscardDraft = async (id: string) => {
    try {
      const res = await fetch(`/api/context/${id}`, { method: 'DELETE' });
      if (res.ok) {
        await fetchEntries();
        if (selectedId === id) handleClose();
      }
    } catch { /* ignore */ }
  };

  const draftEntries = entries.filter(e => e.status === 'draft');
  const activeEntries = entries.filter(e => !e.status || e.status === 'active');

  const existingGroups = useMemo(
    () => [...new Set(activeEntries.map(e => e.group).filter((g): g is string => !!g))].sort(),
    [activeEntries],
  );

  const isEditing = creating || selectedId !== null;
  const selectedEntry = selectedId ? entries.find(e => e.id === selectedId) : null;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1100px] px-6 py-10">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <BookOpen className="h-5 w-5 text-zinc-400" />
            <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">上下文</h1>
            <span className="text-sm text-zinc-400">({activeEntries.length})</span>
            {draftEntries.length > 0 && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                {draftEntries.length} 待确认
              </span>
            )}
          </div>
          <button
            onClick={handleStartCreate}
            className="flex items-center gap-1.5 rounded-md bg-zinc-900 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 transition-colors dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            <Plus className="h-3.5 w-3.5" />
            新建条目
          </button>
        </div>

        {/* Template chips */}
        {availableTemplates.length > 0 && !isEditing && (
          <div className="mb-5">
            <p className="mb-2.5 text-xs text-zinc-400">快速创建</p>
            <div className="flex flex-wrap gap-2">
              {availableTemplates.map(tpl => {
                const Icon = tpl.icon;
                return (
                  <button
                    key={tpl.fileName}
                    onClick={() => handleTemplateClick(tpl)}
                    className="flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-600 transition-colors hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:bg-zinc-700"
                  >
                    <Icon className="h-3 w-3" />
                    {tpl.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Draft section — Agent-produced knowledge awaiting confirmation */}
        {draftEntries.length > 0 && !isEditing && (
          <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 dark:border-amber-800/50 dark:bg-amber-900/10">
            <div className="mb-3 flex items-center gap-2">
              <Bot className="h-4 w-4 text-amber-500" />
              <span className="text-sm font-medium text-amber-800 dark:text-amber-400">待确认知识</span>
              <span className="text-xs text-amber-500">Agent 自动产出，确认后生效</span>
            </div>
            <div className="space-y-2">
              {draftEntries.map(entry => (
                <div
                  key={entry.id}
                  className="flex items-start justify-between gap-4 rounded-lg border border-amber-200 bg-white px-4 py-3 dark:border-amber-800/40 dark:bg-zinc-900"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">{entry.label}</span>
                      <span className="shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500">{entry.format}</span>
                    </div>
                    <p className="mt-0.5 text-xs text-zinc-400 line-clamp-1">{entry.description}</p>
                    {entry.producedAt && (
                      <p className="mt-1 text-[10px] text-zinc-300 dark:text-zinc-600">
                        产出于 {formatDateTime(entry.producedAt)}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      onClick={() => handleSelect(entry)}
                      className="rounded px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
                    >
                      查看
                    </button>
                    <button
                      onClick={() => handleDiscardDraft(entry.id)}
                      className="flex items-center gap-1 rounded px-2 py-1 text-xs text-zinc-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                    >
                      <X className="h-3 w-3" />
                      丢弃
                    </button>
                    <button
                      onClick={() => handleConfirmDraft(entry.id)}
                      className="flex items-center gap-1 rounded bg-amber-500 px-2.5 py-1 text-xs font-medium text-white hover:bg-amber-600 dark:bg-amber-600 dark:hover:bg-amber-500"
                    >
                      <Check className="h-3 w-3" />
                      确认
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Card grid — grouped by group field */}
        {activeEntries.length === 0 && !isEditing ? (
          <div className="flex flex-col items-center justify-center py-20 text-zinc-400">
            <BookOpen className="mb-3 h-10 w-10" />
            <p className="text-sm">暂无上下文信息</p>
            <p className="mt-1 text-xs">添加用户信息、项目结构等数据，供 AI Agent 按需读取</p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Grouped entries */}
            {existingGroups.map(group => {
              const groupEntries = activeEntries.filter(e => e.group === group);
              if (groupEntries.length === 0) return null;
              return (
                <div key={group}>
                  <div className="mb-3 flex items-center gap-2">
                    <FolderOpen className="h-3.5 w-3.5 text-zinc-400" />
                    <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{group}</span>
                    <span className="text-[10px] text-zinc-300 dark:text-zinc-600">({groupEntries.length})</span>
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    {groupEntries.map(entry => (
                      <EntryCard key={entry.id} entry={entry} selectedId={selectedId} onSelect={handleSelect} onDelete={handleDelete} isGlobal={!!activeKey && !entry.projectKey} />
                    ))}
                  </div>
                </div>
              );
            })}
            {/* Ungrouped entries */}
            {(() => {
              const ungrouped = activeEntries.filter(e => !e.group);
              if (ungrouped.length === 0) return null;
              return (
                <div>
                  {existingGroups.length > 0 && (
                    <div className="mb-3 flex items-center gap-2">
                      <span className="text-xs font-medium text-zinc-400 dark:text-zinc-500">未分组</span>
                      <span className="text-[10px] text-zinc-300 dark:text-zinc-600">({ungrouped.length})</span>
                    </div>
                  )}
                  <div className="grid grid-cols-3 gap-4">
                    {ungrouped.map(entry => (
                      <EntryCard key={entry.id} entry={entry} selectedId={selectedId} onSelect={handleSelect} onDelete={handleDelete} isGlobal={!!activeKey && !entry.projectKey} />
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* Editor area — appears below cards when editing or creating */}
        {isEditing && (
          <div className="mt-6 rounded-xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={handleFileSelect}
            />

            {/* Editor header */}
            <div className="flex items-center justify-between border-b border-zinc-100 px-6 py-3 dark:border-zinc-800">
              <div className="flex items-center gap-3">
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  {creating ? '新建上下文条目' : '编辑上下文条目'}
                </h3>
                {creating && (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-1.5 rounded-md border border-zinc-200 px-2.5 py-1 text-xs text-zinc-500 hover:border-zinc-300 hover:bg-zinc-50 transition-colors dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:bg-zinc-800"
                  >
                    <Upload className="h-3 w-3" />
                    从本地文件读取
                  </button>
                )}

                {selectedEntry && (
                  <div className="flex items-center gap-3 text-[11px] text-zinc-400 dark:text-zinc-500">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      创建于 {formatDateTime(selectedEntry.createdAt)}
                    </span>
                    {selectedEntry.updatedAt !== selectedEntry.createdAt && (
                      <span>
                        修改于 {formatDateTime(selectedEntry.updatedAt)}
                      </span>
                    )}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1">
                {!creating && selectedId && (
                  <button
                    onClick={() => handleDelete(selectedId)}
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
              {/* Row 1: Label + Description */}
              <div className="flex gap-4">
                <div className="flex-1">
                  <label className="mb-1.5 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
                    标签 <span className="text-red-400">*</span>
                  </label>
                  <input
                    autoFocus
                    value={form.label}
                    onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
                    placeholder="例如：用户基本信息"
                    className="w-full rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none placeholder:text-zinc-400 focus:border-zinc-400 focus:ring-1 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 dark:placeholder:text-zinc-500 dark:focus:border-zinc-500 dark:focus:ring-zinc-500"
                  />
                </div>
                <div className="flex-1">
                  <label className="mb-1.5 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
                    描述
                  </label>
                  <input
                    value={form.description}
                    onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                    placeholder="简要描述此上下文的内容，帮助 AI 判断是否需要读取"
                    className="w-full rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none placeholder:text-zinc-400 focus:border-zinc-400 focus:ring-1 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 dark:placeholder:text-zinc-500 dark:focus:border-zinc-500 dark:focus:ring-zinc-500"
                  />
                </div>
              </div>

              {/* Row 2: Group + FileName + Format */}
              <div className="flex gap-4">
                <div className="w-44">
                  <label className="mb-1.5 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
                    分组
                  </label>
                  <input
                    value={form.group}
                    onChange={e => setForm(f => ({ ...f, group: e.target.value }))}
                    placeholder="可选，如 ELApp"
                    list="context-groups"
                    className="w-full rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none placeholder:text-zinc-400 focus:border-zinc-400 focus:ring-1 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 dark:placeholder:text-zinc-500 dark:focus:border-zinc-500 dark:focus:ring-zinc-500"
                  />
                  <datalist id="context-groups">
                    {existingGroups.map(g => (
                      <option key={g} value={g} />
                    ))}
                  </datalist>
                </div>
                <div className="flex-1">
                  <label className="mb-1.5 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
                    文件名 <span className="text-red-400">*</span>
                  </label>
                  <input
                    value={form.fileName}
                    onChange={e => setForm(f => ({ ...f, fileName: e.target.value }))}
                    placeholder="例如：user-profile.json"
                    disabled={!creating}
                    className="w-full rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none placeholder:text-zinc-400 focus:border-zinc-400 focus:ring-1 focus:ring-zinc-400 disabled:opacity-50 disabled:cursor-not-allowed dark:border-zinc-700 dark:bg-zinc-800 dark:placeholder:text-zinc-500 dark:focus:border-zinc-500 dark:focus:ring-zinc-500"
                  />
                </div>
                <div className="w-52">
                  <label className="mb-1.5 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
                    格式
                  </label>
                  <div className="flex rounded-md border border-zinc-200 dark:border-zinc-700">
                    {FORMAT_OPTIONS.map(opt => (
                      <button
                        key={opt.value}
                        onClick={() => setForm(f => ({ ...f, format: opt.value }))}
                        className={`flex flex-1 items-center justify-center py-2 text-xs font-medium transition-colors first:rounded-l-md last:rounded-r-md ${
                          form.format === opt.value
                            ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                            : 'text-zinc-500 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-800'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Content */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  内容
                </label>
                <textarea
                  value={content}
                  onChange={e => setContent(e.target.value)}
                  placeholder="输入上下文内容..."
                  rows={12}
                  className="w-full resize-y rounded-md border border-zinc-200 px-3 py-2 font-mono text-sm leading-relaxed outline-none placeholder:text-zinc-400 focus:border-zinc-400 focus:ring-1 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 dark:placeholder:text-zinc-500 dark:focus:border-zinc-500 dark:focus:ring-zinc-500"
                />
              </div>

              {/* Source path */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  原始文件路径
                  <span className="ml-1.5 font-normal text-zinc-400">（供 AI 修改源文件使用，如 /Users/me/project/src/foo.ts）</span>
                </label>
                <input
                  value={form.sourcePath}
                  onChange={e => setForm(f => ({ ...f, sourcePath: e.target.value }))}
                  placeholder="例如：/Users/me/project/src/config.ts"
                  className="w-full rounded-md border border-zinc-200 px-3 py-2 font-mono text-sm outline-none placeholder:text-zinc-400 focus:border-zinc-400 focus:ring-1 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 dark:placeholder:text-zinc-500 dark:focus:border-zinc-500 dark:focus:ring-zinc-500"
                />
              </div>

              {/* Actions */}
              <div className="flex items-center gap-3 pt-1">
                <button
                  onClick={handleSave}
                  disabled={!form.label.trim() || !form.fileName.trim() || saving || !hasChanges}
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
