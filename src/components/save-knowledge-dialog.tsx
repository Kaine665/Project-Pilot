'use client';

import { memo, useState } from 'react';
import { BookMarked, Loader2, X } from 'lucide-react';

interface SaveKnowledgeDialogProps {
  content: string;
  onClose: () => void;
}

export const SaveKnowledgeDialog = memo(function SaveKnowledgeDialog({
  content,
  onClose,
}: SaveKnowledgeDialogProps) {
  const [form, setForm] = useState<{ label: string; description: string; format: 'text' | 'json' | 'markdown' }>({
    label: '',
    description: '',
    format: 'text',
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!form.label.trim() || !form.description.trim()) return;
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const id = `ctx-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const extMap = { json: 'json', markdown: 'md', text: 'txt' };
      const fileName = `knowledge-${id}.${extMap[form.format]}`;
      await fetch('/api/context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: form.label.trim(),
          description: form.description.trim(),
          fileName,
          format: form.format,
          content,
          producedAt: now,
        }),
      });
      onClose();
    } catch { /* ignore */ }
    setSaving(false);
  };

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-5 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BookMarked className="h-4 w-4 text-zinc-500" />
            <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">存为知识</span>
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs text-zinc-500">标题 *</label>
            <input
              type="text"
              value={form.label}
              onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
              placeholder="如：数据库表结构"
              className="w-full rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 dark:focus:border-zinc-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-zinc-500">描述 * （帮助 AI 决定何时读取）</label>
            <input
              type="text"
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="如：包含所有表名、字段类型和关联关系"
              className="w-full rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 dark:focus:border-zinc-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-zinc-500">格式</label>
            <div className="flex gap-2">
              {(['text', 'markdown', 'json'] as const).map(fmt => (
                <button
                  key={fmt}
                  onClick={() => setForm(f => ({ ...f, format: fmt }))}
                  className={`rounded px-3 py-1 text-xs transition-colors ${
                    form.format === fmt
                      ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                      : 'border border-zinc-200 text-zinc-500 hover:border-zinc-300 dark:border-zinc-700 dark:hover:border-zinc-600'
                  }`}
                >
                  {fmt}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={!form.label.trim() || !form.description.trim() || saving}
            className="flex items-center gap-1.5 rounded-md bg-zinc-900 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BookMarked className="h-3.5 w-3.5" />}
            保存
          </button>
        </div>
      </div>
    </div>
  );
});
