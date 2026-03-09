'use client';

import { Plus } from 'lucide-react';
import type { BitableTable, BitableView, BitableRecord, CellValue, SelectOption } from '@/types/bitable';
import { CellDisplay } from './cell-editor';

interface KanbanViewProps {
  table: BitableTable;
  view: BitableView;
  onAddRecord: (defaultCells?: Record<string, CellValue>) => void;
  onUpdateRecord: (recordId: string, cells: Record<string, CellValue>) => void;
}

/**
 * 看板视图 — 按单选字段分组的卡片视图
 */
export function KanbanView({ table, view, onAddRecord, onUpdateRecord }: KanbanViewProps) {
  const groupField = table.fields.find(f => f.id === view.kanbanFieldId);

  if (!groupField || (groupField.type !== 'select' && groupField.type !== 'multiSelect')) {
    return (
      <div className="flex items-center justify-center h-64 text-zinc-500">
        请为看板视图选择一个单选或多选字段作为分组依据
      </div>
    );
  }

  const options = groupField.config?.options ?? [];
  // 未分类的记录（没有设置分组字段值的）
  const unassigned = table.records.filter(r => {
    const v = r.cells[groupField.id];
    return v === null || v === undefined || v === '';
  });

  // 显示的字段（排除分组字段，最多显示 4 个）
  const displayFields = table.fields
    .filter(f => f.id !== groupField.id)
    .slice(0, 4);

  return (
    <div className="flex gap-4 p-4 h-full overflow-x-auto">
      {/* 各分组列 */}
      {options.map(opt => {
        const records = table.records.filter(r => {
          const v = r.cells[groupField.id];
          if (groupField.type === 'multiSelect') {
            return Array.isArray(v) && v.includes(opt.id);
          }
          return v === opt.id;
        });

        return (
          <KanbanColumn
            key={opt.id}
            option={opt}
            records={records}
            displayFields={displayFields}
            table={table}
            groupFieldId={groupField.id}
            onAddRecord={() => onAddRecord({ [groupField.id]: opt.id })}
            onMoveRecord={(recordId, targetOptId) => {
              onUpdateRecord(recordId, { [groupField.id]: targetOptId });
            }}
          />
        );
      })}

      {/* 未分类列 */}
      {unassigned.length > 0 && (
        <KanbanColumn
          option={{ id: '__unassigned', label: '未分类', color: 'zinc' }}
          records={unassigned}
          displayFields={displayFields}
          table={table}
          groupFieldId={groupField.id}
          onAddRecord={() => onAddRecord()}
          onMoveRecord={(recordId, targetOptId) => {
            onUpdateRecord(recordId, { [groupField.id]: targetOptId });
          }}
        />
      )}
    </div>
  );
}

interface KanbanColumnProps {
  option: SelectOption;
  records: BitableRecord[];
  displayFields: { id: string; name: string; type: string }[];
  table: BitableTable;
  groupFieldId: string;
  onAddRecord: () => void;
  onMoveRecord: (recordId: string, targetOptId: string) => void;
}

function KanbanColumn({ option, records, displayFields, table, onAddRecord }: KanbanColumnProps) {
  return (
    <div className="flex flex-col w-72 min-w-72 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg">
      {/* 列头 */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-zinc-200 dark:border-zinc-700">
        <span className={`w-2.5 h-2.5 rounded-full bg-${option.color}-500`} />
        <span className="text-sm font-medium truncate">{option.label}</span>
        <span className="ml-auto text-xs text-zinc-400">{records.length}</span>
      </div>

      {/* 卡片列表 */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {records.map(record => (
          <div
            key={record.id}
            className="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-700 p-3 hover:shadow-sm transition-shadow cursor-pointer"
          >
            {displayFields.map(df => {
              const field = table.fields.find(f => f.id === df.id);
              if (!field) return null;
              const cellValue = record.cells[field.id] ?? null;
              if (cellValue === null || cellValue === undefined || cellValue === '') return null;

              return (
                <div key={df.id} className="mb-1.5 last:mb-0">
                  <div className="text-[10px] text-zinc-400 mb-0.5">{field.name}</div>
                  <div className="text-sm">
                    <CellDisplay field={field} value={cellValue} />
                  </div>
                </div>
              );
            })}
            {displayFields.every(df => {
              const v = record.cells[df.id];
              return v === null || v === undefined || v === '';
            }) && (
              <span className="text-xs text-zinc-400">空记录</span>
            )}
          </div>
        ))}
      </div>

      {/* 添加按钮 */}
      <button
        className="flex items-center gap-1.5 px-3 py-2 text-sm text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 border-t border-zinc-200 dark:border-zinc-700"
        onClick={onAddRecord}
      >
        <Plus className="w-4 h-4" /> 添加
      </button>
    </div>
  );
}
