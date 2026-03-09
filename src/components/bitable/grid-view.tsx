'use client';

import { useState, useCallback, useRef } from 'react';
import { Plus, GripVertical, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import type { BitableTable, BitableField, BitableRecord, BitableView, CellValue, SortRule, FilterRule } from '@/types/bitable';
import { CellDisplay, CellEditor } from './cell-editor';

interface GridViewProps {
  table: BitableTable;
  view: BitableView;
  onAddRecord: () => void;
  onUpdateRecord: (recordId: string, cells: Record<string, CellValue>) => void;
  onDeleteRecords: (recordIds: string[]) => void;
  onUpdateView: (data: Partial<BitableView>) => void;
}

/**
 * 表格视图 — 类似电子表格的网格视图，支持行内编辑
 */
export function GridView({ table, view, onAddRecord, onUpdateRecord, onDeleteRecords, onUpdateView }: GridViewProps) {
  const [editingCell, setEditingCell] = useState<{ recordId: string; fieldId: string } | null>(null);
  const [selectedRecords, setSelectedRecords] = useState<Set<string>>(new Set());
  const [resizingField, setResizingField] = useState<string | null>(null);
  const resizeStartX = useRef(0);
  const resizeStartWidth = useRef(0);

  // 获取有序可见字段
  const visibleFields = getVisibleFields(table.fields, view);

  // 应用筛选、排序、分组
  const processedRecords = processRecords(table.records, table.fields, view);

  // 全选/取消全选
  const allSelected = processedRecords.length > 0 && selectedRecords.size === processedRecords.length;
  const toggleAll = () => {
    if (allSelected) {
      setSelectedRecords(new Set());
    } else {
      setSelectedRecords(new Set(processedRecords.map(r => r.id)));
    }
  };

  const handleCellClick = useCallback((recordId: string, fieldId: string, field: BitableField) => {
    // 系统字段不可编辑
    if (field.type === 'createdAt' || field.type === 'updatedAt') return;

    // 复选框直接切换
    if (field.type === 'checkbox') {
      const record = table.records.find(r => r.id === recordId);
      if (record) {
        onUpdateRecord(recordId, { [fieldId]: !record.cells[fieldId] });
      }
      return;
    }

    setEditingCell({ recordId, fieldId });
  }, [table.records, onUpdateRecord]);

  const handleCellChange = useCallback((recordId: string, fieldId: string, value: CellValue) => {
    onUpdateRecord(recordId, { [fieldId]: value });
    setEditingCell(null);
  }, [onUpdateRecord]);

  // 列排序
  const handleSort = (fieldId: string) => {
    const currentSort = view.sorts?.find(s => s.fieldId === fieldId);
    let newSorts: SortRule[];
    if (!currentSort) {
      newSorts = [{ fieldId, direction: 'asc' }];
    } else if (currentSort.direction === 'asc') {
      newSorts = [{ fieldId, direction: 'desc' }];
    } else {
      newSorts = [];
    }
    onUpdateView({ sorts: newSorts });
  };

  // 列宽调整
  const handleResizeStart = (e: React.MouseEvent, fieldId: string, currentWidth: number) => {
    e.preventDefault();
    setResizingField(fieldId);
    resizeStartX.current = e.clientX;
    resizeStartWidth.current = currentWidth;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - resizeStartX.current;
      const newWidth = Math.max(80, resizeStartWidth.current + delta);
      // 实时更新 DOM
      const cells = document.querySelectorAll(`[data-field-id="${fieldId}"]`);
      cells.forEach(cell => {
        (cell as HTMLElement).style.width = `${newWidth}px`;
        (cell as HTMLElement).style.minWidth = `${newWidth}px`;
      });
    };

    const handleMouseUp = () => {
      const delta = (document.querySelector(`[data-field-id="${fieldId}"]`) as HTMLElement)?.offsetWidth;
      if (delta && delta !== resizeStartWidth.current) {
        // 通过 API 持久化列宽（可选，这里简化处理）
      }
      setResizingField(null);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  return (
    <div className="flex flex-col h-full">
      {/* 工具栏 */}
      {selectedRecords.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-2 bg-blue-50 dark:bg-blue-950/30 border-b border-zinc-200 dark:border-zinc-700">
          <span className="text-sm text-blue-600 dark:text-blue-400">已选择 {selectedRecords.size} 条记录</span>
          <button
            className="text-sm text-red-500 hover:text-red-600"
            onClick={() => { onDeleteRecords(Array.from(selectedRecords)); setSelectedRecords(new Set()); }}
          >
            删除选中
          </button>
          <button className="text-sm text-zinc-500 hover:text-zinc-600" onClick={() => setSelectedRecords(new Set())}>
            取消选择
          </button>
        </div>
      )}

      {/* 表格 */}
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse">
          {/* 表头 */}
          <thead className="sticky top-0 z-10 bg-zinc-50 dark:bg-zinc-800/80 backdrop-blur">
            <tr>
              {/* 选择列 */}
              <th className="w-10 px-2 py-2 border-b border-r border-zinc-200 dark:border-zinc-700">
                <input type="checkbox" checked={allSelected} onChange={toggleAll} className="rounded" />
              </th>
              {/* 行号列 */}
              <th className="w-10 px-2 py-2 border-b border-r border-zinc-200 dark:border-zinc-700 text-xs text-zinc-400 font-normal">
                #
              </th>
              {/* 字段列 */}
              {visibleFields.map(field => {
                const width = field.width ?? 200;
                const sortRule = view.sorts?.find(s => s.fieldId === field.id);
                return (
                  <th
                    key={field.id}
                    data-field-id={field.id}
                    className="relative px-3 py-2 border-b border-r border-zinc-200 dark:border-zinc-700 text-left text-xs font-medium text-zinc-600 dark:text-zinc-400 select-none group"
                    style={{ width, minWidth: width }}
                  >
                    <div className="flex items-center gap-1.5">
                      <FieldTypeIcon type={field.type} />
                      <span className="truncate">{field.name}</span>
                      <button
                        className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity p-0.5 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded"
                        onClick={() => handleSort(field.id)}
                      >
                        {sortRule ? (
                          sortRule.direction === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
                        ) : (
                          <ArrowUpDown className="w-3 h-3" />
                        )}
                      </button>
                    </div>
                    {/* 列宽拖拽手柄 */}
                    <div
                      className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500"
                      onMouseDown={e => handleResizeStart(e, field.id, width)}
                    />
                  </th>
                );
              })}
              {/* 添加字段列 */}
              <th className="w-10 px-2 py-2 border-b border-zinc-200 dark:border-zinc-700" />
            </tr>
          </thead>

          {/* 数据行 */}
          <tbody>
            {processedRecords.map((record, rowIdx) => (
              <tr
                key={record.id}
                className={`group hover:bg-zinc-50 dark:hover:bg-zinc-800/50 ${selectedRecords.has(record.id) ? 'bg-blue-50/50 dark:bg-blue-950/20' : ''}`}
              >
                {/* 选择 */}
                <td className="px-2 py-1.5 border-b border-r border-zinc-100 dark:border-zinc-800">
                  <input
                    type="checkbox"
                    checked={selectedRecords.has(record.id)}
                    onChange={() => {
                      const next = new Set(selectedRecords);
                      if (next.has(record.id)) next.delete(record.id); else next.add(record.id);
                      setSelectedRecords(next);
                    }}
                    className="rounded"
                  />
                </td>
                {/* 行号 */}
                <td className="px-2 py-1.5 border-b border-r border-zinc-100 dark:border-zinc-800 text-xs text-zinc-400 text-center">
                  {rowIdx + 1}
                </td>
                {/* 字段值 */}
                {visibleFields.map(field => {
                  const cellValue = record.cells[field.id] ?? null;
                  const isEditing = editingCell?.recordId === record.id && editingCell?.fieldId === field.id;
                  const width = field.width ?? 200;

                  return (
                    <td
                      key={field.id}
                      data-field-id={field.id}
                      className="relative px-3 py-1.5 border-b border-r border-zinc-100 dark:border-zinc-800 text-sm cursor-pointer hover:bg-zinc-100/50 dark:hover:bg-zinc-700/30"
                      style={{ width, minWidth: width, maxWidth: width }}
                      onClick={() => handleCellClick(record.id, field.id, field)}
                    >
                      {isEditing ? (
                        <CellEditor
                          field={field}
                          value={cellValue}
                          onChange={v => handleCellChange(record.id, field.id, v)}
                          onCancel={() => setEditingCell(null)}
                        />
                      ) : (
                        <CellDisplay field={field} value={cellValue} />
                      )}
                    </td>
                  );
                })}
                <td className="border-b border-zinc-100 dark:border-zinc-800" />
              </tr>
            ))}

            {/* 新增行按钮 */}
            <tr>
              <td colSpan={visibleFields.length + 3} className="px-3 py-2">
                <button
                  className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                  onClick={onAddRecord}
                >
                  <Plus className="w-4 h-4" /> 添加记录
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* 底栏 */}
      <div className="flex items-center justify-between px-4 py-2 border-t border-zinc-200 dark:border-zinc-700 text-xs text-zinc-500">
        <span>共 {processedRecords.length} 条记录</span>
      </div>
    </div>
  );
}

// ==================== 辅助函数 ====================

function getVisibleFields(fields: BitableField[], view: BitableView): BitableField[] {
  const hiddenSet = new Set(view.hiddenFields ?? []);
  if (view.fieldOrder && view.fieldOrder.length > 0) {
    return view.fieldOrder
      .filter(id => !hiddenSet.has(id))
      .map(id => fields.find(f => f.id === id))
      .filter((f): f is BitableField => !!f);
  }
  return fields.filter(f => !hiddenSet.has(f.id));
}

function processRecords(records: BitableRecord[], fields: BitableField[], view: BitableView): BitableRecord[] {
  let result = [...records];

  // 筛选
  if (view.filters && view.filters.length > 0) {
    result = result.filter(r => view.filters!.every(f => matchFilter(r, f)));
  }

  // 排序
  if (view.sorts && view.sorts.length > 0) {
    result.sort((a, b) => {
      for (const sort of view.sorts!) {
        const va = a.cells[sort.fieldId];
        const vb = b.cells[sort.fieldId];
        const cmp = compareValues(va, vb);
        if (cmp !== 0) return sort.direction === 'asc' ? cmp : -cmp;
      }
      return 0;
    });
  }

  return result;
}

function matchFilter(record: BitableRecord, filter: FilterRule): boolean {
  const value = record.cells[filter.fieldId];
  switch (filter.operator) {
    case 'isEmpty': return value === null || value === undefined || value === '';
    case 'isNotEmpty': return value !== null && value !== undefined && value !== '';
    case 'eq': return value === filter.value;
    case 'neq': return value !== filter.value;
    case 'contains': return typeof value === 'string' && typeof filter.value === 'string' && value.includes(filter.value);
    case 'notContains': return typeof value === 'string' && typeof filter.value === 'string' && !value.includes(filter.value);
    case 'gt': return typeof value === 'number' && typeof filter.value === 'number' && value > filter.value;
    case 'gte': return typeof value === 'number' && typeof filter.value === 'number' && value >= filter.value;
    case 'lt': return typeof value === 'number' && typeof filter.value === 'number' && value < filter.value;
    case 'lte': return typeof value === 'number' && typeof filter.value === 'number' && value <= filter.value;
    default: return true;
  }
}

function compareValues(a: CellValue, b: CellValue): number {
  if (a === null || a === undefined) return b === null || b === undefined ? 0 : -1;
  if (b === null || b === undefined) return 1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'string' && typeof b === 'string') return a.localeCompare(b, 'zh');
  return String(a).localeCompare(String(b), 'zh');
}

// 字段类型图标
function FieldTypeIcon({ type }: { type: string }) {
  const iconMap: Record<string, string> = {
    text: 'Aa', number: '#', select: '◉', multiSelect: '◎',
    checkbox: '☑', date: '📅', url: '🔗', rating: '⭐',
    progress: '▓', formula: 'fx', createdAt: '🕐', updatedAt: '🕐',
  };
  return <span className="text-[10px] w-4 text-center opacity-60">{iconMap[type] || '?'}</span>;
}
