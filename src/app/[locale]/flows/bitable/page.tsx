'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Table2, Plus, Trash2, MoreHorizontal, Grid3X3, Kanban, ChevronDown, Settings, ArrowLeft } from 'lucide-react';
import type {
  BitableBase,
  BitableBaseMeta,
  BitableTable,
  BitableField,
  BitableView,
  CellValue,
} from '@/types/bitable';
import { useProject } from '@/components/project-context';
import { GridView } from '@/components/bitable/grid-view';
import { KanbanView } from '@/components/bitable/kanban-view';

type PageMode = 'list' | 'detail';

export default function BitablePage() {
  const { activeKey } = useProject();

  // 页面模式
  const [mode, setMode] = useState<PageMode>('list');
  const [bases, setBases] = useState<BitableBaseMeta[]>([]);
  const [loading, setLoading] = useState(true);

  // 详情模式
  const [activeBase, setActiveBase] = useState<BitableBase | null>(null);
  const [activeTableId, setActiveTableId] = useState<string>('');
  const [activeViewId, setActiveViewId] = useState<string>('');

  // 创建对话框
  const [showCreateBase, setShowCreateBase] = useState(false);
  const [newBaseName, setNewBaseName] = useState('');
  const [showCreateTable, setShowCreateTable] = useState(false);
  const [newTableName, setNewTableName] = useState('');
  const [showAddField, setShowAddField] = useState(false);

  // ==================== 数据获取 ====================

  const fetchBases = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/bitable');
      if (res.ok) {
        const data = await res.json();
        setBases(data.bases ?? []);
      }
    } catch (err) {
      console.error('Failed to fetch bases:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchBase = useCallback(async (baseId: string) => {
    try {
      const res = await fetch(`/api/bitable/${baseId}`);
      if (res.ok) {
        const base: BitableBase = await res.json();
        setActiveBase(base);
        // 自动选择第一个 table 和 view
        if (base.tables.length > 0) {
          const t = base.tables[0];
          setActiveTableId(t.id);
          if (t.views.length > 0) setActiveViewId(t.views[0].id);
        }
      }
    } catch (err) {
      console.error('Failed to fetch base:', err);
    }
  }, []);

  useEffect(() => { fetchBases(); }, [fetchBases]);

  // ==================== Base 操作 ====================

  const handleCreateBase = async () => {
    if (!newBaseName.trim()) return;
    try {
      const res = await fetch('/api/bitable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newBaseName.trim(), projectKey: activeKey }),
      });
      if (res.ok) {
        setNewBaseName('');
        setShowCreateBase(false);
        fetchBases();
      }
    } catch (err) {
      console.error('Failed to create base:', err);
    }
  };

  const handleOpenBase = (baseId: string) => {
    setMode('detail');
    fetchBase(baseId);
  };

  const handleDeleteBase = async (baseId: string) => {
    if (!confirm('确定删除此多维表格？所有数据将被永久删除。')) return;
    try {
      await fetch(`/api/bitable/${baseId}`, { method: 'DELETE' });
      fetchBases();
    } catch (err) {
      console.error('Failed to delete base:', err);
    }
  };

  // ==================== Table 操作 ====================

  const handleCreateTable = async () => {
    if (!activeBase || !newTableName.trim()) return;
    try {
      const res = await fetch(`/api/bitable/${activeBase.id}/tables`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newTableName.trim() }),
      });
      if (res.ok) {
        setNewTableName('');
        setShowCreateTable(false);
        fetchBase(activeBase.id);
      }
    } catch (err) {
      console.error('Failed to create table:', err);
    }
  };

  // ==================== Record 操作 ====================

  const handleAddRecord = async (defaultCells?: Record<string, CellValue>) => {
    if (!activeBase) return;
    try {
      await fetch(`/api/bitable/${activeBase.id}/tables/${activeTableId}/records`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cells: defaultCells ?? {} }),
      });
      fetchBase(activeBase.id);
    } catch (err) {
      console.error('Failed to add record:', err);
    }
  };

  const handleUpdateRecord = async (recordId: string, cells: Record<string, CellValue>) => {
    if (!activeBase) return;
    try {
      await fetch(`/api/bitable/${activeBase.id}/tables/${activeTableId}/records/${recordId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cells }),
      });
      fetchBase(activeBase.id);
    } catch (err) {
      console.error('Failed to update record:', err);
    }
  };

  const handleDeleteRecords = async (recordIds: string[]) => {
    if (!activeBase) return;
    try {
      await fetch(`/api/bitable/${activeBase.id}/tables/${activeTableId}/records`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recordIds }),
      });
      fetchBase(activeBase.id);
    } catch (err) {
      console.error('Failed to delete records:', err);
    }
  };

  // ==================== View 操作 ====================

  const handleUpdateView = async (data: Partial<BitableView>) => {
    if (!activeBase) return;
    try {
      await fetch(`/api/bitable/${activeBase.id}/tables/${activeTableId}/views/${activeViewId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      fetchBase(activeBase.id);
    } catch (err) {
      console.error('Failed to update view:', err);
    }
  };

  // ==================== Field 操作 ====================

  const handleAddField = async (name: string, type: BitableField['type'], config?: BitableField['config']) => {
    if (!activeBase) return;
    try {
      await fetch(`/api/bitable/${activeBase.id}/tables/${activeTableId}/fields`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, type, config }),
      });
      setShowAddField(false);
      fetchBase(activeBase.id);
    } catch (err) {
      console.error('Failed to add field:', err);
    }
  };

  // ==================== 获取当前 table 和 view ====================

  const activeTable = useMemo(() => activeBase?.tables.find(t => t.id === activeTableId), [activeBase, activeTableId]);
  const activeView = useMemo(() => activeTable?.views.find(v => v.id === activeViewId), [activeTable, activeViewId]);

  // ==================== 渲染 ====================

  // 列表模式 — 显示所有 base
  if (mode === 'list') {
    return (
      <div className="h-full flex flex-col">
        {/* 头部 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center gap-3">
            <Table2 className="w-5 h-5 text-zinc-600 dark:text-zinc-400" />
            <h1 className="text-lg font-semibold">多维表格</h1>
          </div>
          <button
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
            onClick={() => setShowCreateBase(true)}
          >
            <Plus className="w-4 h-4" /> 新建
          </button>
        </div>

        {/* 内容 */}
        <div className="flex-1 overflow-auto p-6">
          {loading ? (
            <div className="text-center text-zinc-500 py-12">加载中...</div>
          ) : bases.length === 0 ? (
            <div className="text-center py-20">
              <Table2 className="w-12 h-12 mx-auto text-zinc-300 dark:text-zinc-600 mb-4" />
              <p className="text-zinc-500 mb-4">还没有多维表格</p>
              <button
                className="px-4 py-2 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600"
                onClick={() => setShowCreateBase(true)}
              >
                创建第一个表格
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {bases.map(base => (
                <div
                  key={base.id}
                  className="group relative bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 hover:shadow-md transition-shadow cursor-pointer"
                  onClick={() => handleOpenBase(base.id)}
                >
                  <div className="flex items-start gap-3">
                    <span className="text-2xl">{base.icon || '📊'}</span>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium truncate">{base.name}</h3>
                      {base.description && (
                        <p className="text-sm text-zinc-500 truncate mt-1">{base.description}</p>
                      )}
                      <div className="text-xs text-zinc-400 mt-2">
                        {base.tableCount} 个数据表
                      </div>
                    </div>
                  </div>
                  {/* 删除按钮 */}
                  <button
                    className="absolute top-3 right-3 p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-all"
                    onClick={e => { e.stopPropagation(); handleDeleteBase(base.id); }}
                  >
                    <Trash2 className="w-4 h-4 text-zinc-400 hover:text-red-500" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 创建对话框 */}
        {showCreateBase && (
          <Modal onClose={() => setShowCreateBase(false)}>
            <h2 className="text-lg font-semibold mb-4">新建多维表格</h2>
            <input
              className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-transparent text-sm outline-none focus:border-blue-500"
              placeholder="输入表格名称..."
              value={newBaseName}
              onChange={e => setNewBaseName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleCreateBase(); }}
              autoFocus
            />
            <div className="flex justify-end gap-2 mt-4">
              <button className="px-3 py-1.5 text-sm text-zinc-500 hover:text-zinc-700" onClick={() => setShowCreateBase(false)}>取消</button>
              <button className="px-3 py-1.5 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600" onClick={handleCreateBase}>创建</button>
            </div>
          </Modal>
        )}
      </div>
    );
  }

  // 详情模式 — 显示 base 内容
  return (
    <div className="h-full flex flex-col">
      {/* 顶部导航 */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        {/* 返回按钮 */}
        <button
          className="p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg"
          onClick={() => { setMode('list'); setActiveBase(null); }}
        >
          <ArrowLeft className="w-4 h-4" />
        </button>

        {/* 表格名称 */}
        <span className="text-lg mr-2">{activeBase?.icon || '📊'}</span>
        <h1 className="font-semibold mr-4">{activeBase?.name}</h1>

        {/* 数据表标签页 */}
        <div className="flex items-center gap-1 border-l border-zinc-200 dark:border-zinc-700 pl-4">
          {activeBase?.tables.map(table => (
            <button
              key={table.id}
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                table.id === activeTableId
                  ? 'bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400'
                  : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
              }`}
              onClick={() => {
                setActiveTableId(table.id);
                if (table.views.length > 0) setActiveViewId(table.views[0].id);
              }}
            >
              {table.name}
            </button>
          ))}
          <button
            className="p-1.5 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg"
            onClick={() => setShowCreateTable(true)}
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 视图栏 */}
      {activeTable && (
        <div className="flex items-center gap-2 px-4 py-1.5 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50">
          {/* 视图切换 */}
          {activeTable.views.map(view => (
            <button
              key={view.id}
              className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md transition-colors ${
                view.id === activeViewId
                  ? 'bg-white dark:bg-zinc-900 shadow-sm text-zinc-900 dark:text-zinc-100'
                  : 'text-zinc-500 hover:text-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-700'
              }`}
              onClick={() => setActiveViewId(view.id)}
            >
              {view.type === 'grid' ? <Grid3X3 className="w-3.5 h-3.5" /> : <Kanban className="w-3.5 h-3.5" />}
              {view.name}
            </button>
          ))}

          {/* 分隔 */}
          <div className="w-px h-4 bg-zinc-200 dark:bg-zinc-700 mx-1" />

          {/* 添加字段 */}
          <button
            className="flex items-center gap-1 px-2 py-1 text-xs text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-md"
            onClick={() => setShowAddField(true)}
          >
            <Plus className="w-3.5 h-3.5" /> 添加字段
          </button>
        </div>
      )}

      {/* 主内容区 */}
      <div className="flex-1 overflow-hidden">
        {!activeTable ? (
          <div className="flex items-center justify-center h-full text-zinc-500">
            <div className="text-center">
              <Table2 className="w-10 h-10 mx-auto text-zinc-300 mb-3" />
              <p className="mb-3">还没有数据表</p>
              <button
                className="px-3 py-1.5 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600"
                onClick={() => setShowCreateTable(true)}
              >
                创建数据表
              </button>
            </div>
          </div>
        ) : !activeView ? (
          <div className="flex items-center justify-center h-full text-zinc-500">选择一个视图</div>
        ) : activeView.type === 'grid' ? (
          <GridView
            table={activeTable}
            view={activeView}
            onAddRecord={() => handleAddRecord()}
            onUpdateRecord={handleUpdateRecord}
            onDeleteRecords={handleDeleteRecords}
            onUpdateView={handleUpdateView}
          />
        ) : activeView.type === 'kanban' ? (
          <KanbanView
            table={activeTable}
            view={activeView}
            onAddRecord={handleAddRecord}
            onUpdateRecord={handleUpdateRecord}
          />
        ) : null}
      </div>

      {/* 创建数据表对话框 */}
      {showCreateTable && (
        <Modal onClose={() => setShowCreateTable(false)}>
          <h2 className="text-lg font-semibold mb-4">新建数据表</h2>
          <input
            className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-transparent text-sm outline-none focus:border-blue-500"
            placeholder="输入数据表名称..."
            value={newTableName}
            onChange={e => setNewTableName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleCreateTable(); }}
            autoFocus
          />
          <div className="flex justify-end gap-2 mt-4">
            <button className="px-3 py-1.5 text-sm text-zinc-500 hover:text-zinc-700" onClick={() => setShowCreateTable(false)}>取消</button>
            <button className="px-3 py-1.5 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600" onClick={handleCreateTable}>创建</button>
          </div>
        </Modal>
      )}

      {/* 添加字段对话框 */}
      {showAddField && (
        <AddFieldDialog
          onAdd={handleAddField}
          onClose={() => setShowAddField(false)}
        />
      )}
    </div>
  );
}

// ==================== 辅助组件 ====================

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-xl p-6 w-96 max-w-[90vw]" onClick={e => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

// 字段类型列表
const FIELD_TYPES: { type: BitableField['type']; label: string; icon: string }[] = [
  { type: 'text', label: '文本', icon: 'Aa' },
  { type: 'number', label: '数字', icon: '#' },
  { type: 'select', label: '单选', icon: '◉' },
  { type: 'multiSelect', label: '多选', icon: '◎' },
  { type: 'checkbox', label: '复选框', icon: '☑' },
  { type: 'date', label: '日期', icon: '📅' },
  { type: 'url', label: '链接', icon: '🔗' },
  { type: 'rating', label: '评分', icon: '⭐' },
  { type: 'progress', label: '进度', icon: '▓' },
];

function AddFieldDialog({ onAdd, onClose }: {
  onAdd: (name: string, type: BitableField['type'], config?: BitableField['config']) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [type, setType] = useState<BitableField['type']>('text');

  // 单选/多选的选项配置
  const [options, setOptions] = useState<{ label: string; color: string }[]>([]);
  const [newOptionLabel, setNewOptionLabel] = useState('');

  const colors = ['red', 'orange', 'amber', 'green', 'blue', 'purple', 'pink'];

  const handleSubmit = () => {
    if (!name.trim()) return;

    let config: BitableField['config'] | undefined;
    if ((type === 'select' || type === 'multiSelect') && options.length > 0) {
      config = {
        options: options.map((opt, i) => ({
          id: `opt-${Date.now()}-${i}`,
          label: opt.label,
          color: opt.color,
        })),
      };
    }

    onAdd(name.trim(), type, config);
  };

  return (
    <Modal onClose={onClose}>
      <h2 className="text-lg font-semibold mb-4">添加字段</h2>

      {/* 字段名 */}
      <input
        className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-transparent text-sm outline-none focus:border-blue-500 mb-3"
        placeholder="字段名称..."
        value={name}
        onChange={e => setName(e.target.value)}
        autoFocus
      />

      {/* 字段类型 */}
      <div className="grid grid-cols-3 gap-1.5 mb-4">
        {FIELD_TYPES.map(ft => (
          <button
            key={ft.type}
            className={`flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-xs transition-colors ${
              type === ft.type
                ? 'bg-blue-50 dark:bg-blue-950/30 text-blue-600 border border-blue-200 dark:border-blue-800'
                : 'bg-zinc-50 dark:bg-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-700 border border-transparent'
            }`}
            onClick={() => setType(ft.type)}
          >
            <span>{ft.icon}</span> {ft.label}
          </button>
        ))}
      </div>

      {/* 单选/多选的选项配置 */}
      {(type === 'select' || type === 'multiSelect') && (
        <div className="mb-4">
          <p className="text-xs text-zinc-500 mb-2">选项</p>
          <div className="space-y-1.5 mb-2">
            {options.map((opt, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className={`w-3 h-3 rounded-full bg-${opt.color}-500`} />
                <span className="text-sm flex-1">{opt.label}</span>
                <button
                  className="text-xs text-zinc-400 hover:text-red-500"
                  onClick={() => setOptions(options.filter((_, j) => j !== i))}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              className="flex-1 px-2.5 py-1.5 border border-zinc-300 dark:border-zinc-600 rounded bg-transparent text-sm outline-none"
              placeholder="输入选项名称..."
              value={newOptionLabel}
              onChange={e => setNewOptionLabel(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && newOptionLabel.trim()) {
                  setOptions([...options, { label: newOptionLabel.trim(), color: colors[options.length % colors.length] }]);
                  setNewOptionLabel('');
                }
              }}
            />
            <button
              className="px-2 py-1 text-xs bg-zinc-100 dark:bg-zinc-800 rounded hover:bg-zinc-200"
              onClick={() => {
                if (newOptionLabel.trim()) {
                  setOptions([...options, { label: newOptionLabel.trim(), color: colors[options.length % colors.length] }]);
                  setNewOptionLabel('');
                }
              }}
            >
              添加
            </button>
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2">
        <button className="px-3 py-1.5 text-sm text-zinc-500 hover:text-zinc-700" onClick={onClose}>取消</button>
        <button className="px-3 py-1.5 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600" onClick={handleSubmit}>添加</button>
      </div>
    </Modal>
  );
}
