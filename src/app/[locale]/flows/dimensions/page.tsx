'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Layers, Plus, Search, Trash2, X } from 'lucide-react';
import type { Dimension } from '@/types';

type FormData = {
  name: string;
  description: string;
};

const emptyForm: FormData = { name: '', description: '' };

function dimensionToForm(d: Dimension): FormData {
  return {
    name: d.name,
    description: d.description ?? '',
  };
}

export default function DimensionsPage() {
  const [dimensions, setDimensions] = useState<Dimension[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FormData>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');

  const fetchDimensions = useCallback(async () => {
    try {
      const res = await fetch('/api/dimensions');
      const data = await res.json();
      setDimensions(data.dimensions ?? []);
    } catch {
      setDimensions([]);
    }
  }, []);

  useEffect(() => { fetchDimensions(); }, [fetchDimensions]);

  const selectedDimension = useMemo(() => dimensions.find(d => d.id === selectedId) ?? null, [dimensions, selectedId]);

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return keyword
      ? dimensions.filter(d => d.name.toLowerCase().includes(keyword) || (d.description ?? '').toLowerCase().includes(keyword))
      : dimensions;
  }, [dimensions, search]);

  const handleSelect = (dimension: Dimension) => {
    setCreating(false);
    setSelectedId(dimension.id);
    setForm(dimensionToForm(dimension));
  };

  const handleStartCreate = () => {
    setSelectedId(null);
    setCreating(true);
    setForm(emptyForm);
  };

  const handleClose = () => {
    setSelectedId(null);
    setCreating(false);
    setForm(emptyForm);
  };

  const handleSave = async () => {
    const name = form.name.trim();
    if (!name) return;
    setSaving(true);
    try {
      if (creating) {
        const res = await fetch('/api/dimensions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            description: form.description.trim() || undefined,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          await fetchDimensions();
          setCreating(false);
          setSelectedId(data.dimension.id);
          setForm(dimensionToForm(data.dimension));
        }
      } else if (selectedId) {
        const res = await fetch('/api/dimensions', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: selectedId,
            name,
            description: form.description.trim() || undefined,
          }),
        });
        if (res.ok) await fetchDimensions();
      }
    } catch { /* ignore */ }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    const dimension = dimensions.find(d => d.id === id);
    if (!confirm(`确定要将信息角度「${dimension?.name ?? id}」移到回收站吗？`)) return;
    try {
      const res = await fetch('/api/dimensions', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (res.ok) {
        await fetchDimensions();
        if (selectedId === id) {
          setSelectedId(null);
          setForm(emptyForm);
        }
      }
    } catch { /* ignore */ }
  };

  const isEditing = creating || selectedId !== null;
  const hasChanges = useMemo(() => creating
    ? form.name.trim().length > 0
    : selectedDimension
      ? form.name !== selectedDimension.name
        || form.description !== (selectedDimension.description ?? '')
      : false, [creating, form.name, form.description, selectedDimension]);

  return (
    <>
      <div className="h-full overflow-y-auto">
        <div className="mx-auto max-w-[1100px] px-6 py-10">
          {/* Header */}
          <div className="mb-6 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <Layers className="h-5 w-5 text-zinc-400" />
              <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">信息角度</h1>
              <span className="text-sm text-zinc-400">({dimensions.length})</span>
            </div>
            <button
              onClick={handleStartCreate}
              className="flex items-center gap-1.5 rounded-md bg-zinc-900 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 transition-colors dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              <Plus className="h-3.5 w-3.5" />
              新建角度
            </button>
          </div>

          {/* Search */}
          <div className="relative mb-6">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="搜索角度名称或描述…"
              className="w-full rounded-md border border-zinc-200 py-2 pl-9 pr-3 text-sm outline-none placeholder:text-zinc-400 focus:border-zinc-400 focus:ring-1 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:placeholder:text-zinc-500 dark:focus:border-zinc-500 dark:focus:ring-zinc-500"
            />
          </div>

          {/* Chip grid */}
          {dimensions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-zinc-400">
              <Layers className="mb-3 h-10 w-10" />
              <p className="text-sm">暂无信息角度</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center text-sm text-zinc-400">
              没有匹配「{search.trim()}」的信息角度
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-4">
              {filtered.map(d => (
                <div
                  key={d.id}
                  onClick={() => handleSelect(d)}
                  className={`group relative cursor-pointer rounded-lg border px-5 py-4 transition-colors ${
                    selectedId === d.id
                      ? 'border-zinc-400 bg-zinc-100 dark:border-zinc-500 dark:bg-zinc-800'
                      : 'border-zinc-200 bg-white hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-zinc-600 dark:hover:bg-zinc-800/60'
                  }`}
                >
                  <button
                    onClick={e => { e.stopPropagation(); handleDelete(d.id); }}
                    className="absolute right-2 top-2 rounded-md p-1 text-zinc-300 opacity-0 transition-opacity hover:bg-red-50 hover:text-red-500 group-hover:opacity-100 dark:text-zinc-600 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                    title="删除"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                  <div className="truncate pr-6 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {d.name}
                  </div>
                  <div className="mt-1.5 text-xs leading-relaxed text-zinc-400 dark:text-zinc-500 line-clamp-3">
                    {d.description || '暂无描述'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Edit / Create modal overlay */}
      {isEditing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 dark:bg-black/50" onClick={handleClose}>
          <div
            className="w-full max-w-lg rounded-xl border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
            onClick={e => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                {creating ? '新建信息角度' : '编辑信息角度'}
              </h2>
              <div className="flex items-center gap-1.5">
                {!creating && (
                  <button
                    onClick={() => handleDelete(selectedId!)}
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
            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  名称 <span className="text-red-400">*</span>
                </label>
                <input
                  autoFocus
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="信息角度名称，如「页面清单」"
                  className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500 dark:border-zinc-600 dark:bg-zinc-800 dark:focus:border-zinc-400 dark:focus:ring-zinc-400"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  描述
                </label>
                <textarea
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="简要描述这个角度关注什么"
                  rows={4}
                  className="w-full resize-y rounded-md border border-zinc-300 px-3 py-2 text-sm leading-relaxed outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500 dark:border-zinc-600 dark:bg-zinc-800 dark:focus:border-zinc-400 dark:focus:ring-zinc-400"
                />
              </div>
              <div className="flex items-center gap-3 pt-1">
                <button
                  onClick={handleSave}
                  disabled={!form.name.trim() || saving || !hasChanges}
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
        </div>
      )}
    </>
  );
}
