'use client';

import { useState, useEffect, useCallback } from 'react';
import { Trash2, ArchiveRestore, FolderKanban, Bot, Layers } from 'lucide-react';

type RecycleBinCategory = 'project' | 'agent' | 'dimension';

interface RecycleBinItem {
  category: RecycleBinCategory;
  id: string;
  name: string;
  archivedAt: string;
}

const CATEGORIES: { key: RecycleBinCategory; label: string; icon: typeof Trash2 }[] = [
  { key: 'project', label: '流程项目', icon: FolderKanban },
  { key: 'agent', label: 'Agents', icon: Bot },
  { key: 'dimension', label: '信息角度', icon: Layers },
];

function formatDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function RecycleBinPage() {
  const [items, setItems] = useState<RecycleBinItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchItems = useCallback(async () => {
    try {
      const res = await fetch('/api/recycle-bin');
      const data = await res.json();
      setItems(data.items ?? []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  const handleRestore = async (item: RecycleBinItem) => {
    try {
      const res = await fetch('/api/recycle-bin/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: item.category, id: item.id }),
      });
      if (res.ok) await fetchItems();
    } catch { /* ignore */ }
  };

  const handlePermanentDelete = async (item: RecycleBinItem) => {
    const cat = CATEGORIES.find(c => c.key === item.category);
    if (!confirm(`确定要永久删除${cat?.label ?? ''}「${item.name}」吗？此操作不可撤销。`)) return;
    try {
      const res = await fetch('/api/recycle-bin', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: item.category, id: item.id }),
      });
      if (res.ok) await fetchItems();
    } catch { /* ignore */ }
  };

  const totalCount = items.length;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-center gap-2 border-b border-zinc-200 px-6 py-3 dark:border-zinc-800">
        <Trash2 className="h-5 w-5 text-zinc-500 dark:text-zinc-400" />
        <span className="text-base font-semibold text-zinc-900 dark:text-zinc-100">回收站</span>
        {totalCount > 0 && <span className="text-sm text-zinc-400">({totalCount})</span>}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <span className="text-sm text-zinc-400">加载中...</span>
          </div>
        ) : (
          <div className="mx-auto flex h-full max-w-[1100px] flex-col px-6 py-4">
            {CATEGORIES.map(cat => {
              const Icon = cat.icon;
              const catItems = items.filter(i => i.category === cat.key);
              return (
                <div key={cat.key} className="flex min-h-0 flex-1 flex-col">
                  {/* Row header */}
                  <div className="mb-2 flex shrink-0 items-center gap-2">
                    <Icon className="h-4 w-4 text-zinc-400" />
                    <span className="text-base font-medium text-zinc-600 dark:text-zinc-300">
                      {cat.label}
                    </span>
                    {catItems.length > 0 && (
                      <span className="text-xs text-zinc-400">({catItems.length})</span>
                    )}
                  </div>

                  {/* Items — horizontal flow */}
                  {catItems.length === 0 ? (
                    <div className="flex-1 text-xs text-zinc-300 dark:text-zinc-600">
                      无已删除项
                    </div>
                  ) : (
                    <div className="flex-1 overflow-y-auto">
                      <div className="flex flex-wrap content-start gap-2">
                        {catItems.map(item => (
                          <div
                            key={`${item.category}-${item.id}`}
                            className="group flex items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 py-2 transition-colors hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700"
                          >
                            <div className="min-w-0">
                              <div className="truncate text-sm text-zinc-900 dark:text-zinc-100 max-w-48">
                                {item.name}
                              </div>
                              <div className="text-xs text-zinc-400">
                                {formatDate(item.archivedAt)}
                              </div>
                            </div>
                            <div className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                onClick={() => handleRestore(item)}
                                className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 transition-colors dark:hover:bg-zinc-700 dark:hover:text-zinc-300"
                                title="恢复"
                              >
                                <ArchiveRestore className="h-3.5 w-3.5" />
                              </button>
                              <button
                                onClick={() => handlePermanentDelete(item)}
                                className="rounded p-1 text-zinc-400 hover:bg-red-50 hover:text-red-500 transition-colors dark:hover:bg-red-900/20"
                                title="永久删除"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
