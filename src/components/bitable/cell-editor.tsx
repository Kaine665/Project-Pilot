'use client';

import { useState, useRef, useEffect } from 'react';
import { Check, Star, X } from 'lucide-react';
import type { BitableField, CellValue, SelectOption } from '@/types/bitable';

interface CellEditorProps {
  field: BitableField;
  value: CellValue;
  onChange: (value: CellValue) => void;
  onCancel: () => void;
}

/**
 * 单元格编辑器 — 根据字段类型渲染不同的编辑控件
 */
export function CellEditor({ field, value, onChange, onCancel }: CellEditorProps) {
  switch (field.type) {
    case 'text':
    case 'url':
      return <TextEditor value={(value as string) ?? ''} onChange={onChange} onCancel={onCancel} />;
    case 'number':
    case 'progress':
      return <NumberEditor value={(value as number) ?? 0} onChange={onChange} onCancel={onCancel} isProgress={field.type === 'progress'} />;
    case 'select':
      return <SelectEditor options={field.config?.options ?? []} value={(value as string) ?? ''} onChange={onChange} onCancel={onCancel} />;
    case 'multiSelect':
      return <MultiSelectEditor options={field.config?.options ?? []} value={(value as string[]) ?? []} onChange={onChange} onCancel={onCancel} />;
    case 'checkbox':
      // 复选框直接切换，不需要编辑模式
      onChange(!(value as boolean));
      return null;
    case 'date':
      return <DateEditor value={(value as string) ?? ''} onChange={onChange} onCancel={onCancel} includeTime={field.config?.includeTime} />;
    case 'rating':
      return <RatingEditor value={(value as number) ?? 0} max={field.config?.maxRating ?? 5} onChange={onChange} onCancel={onCancel} />;
    default:
      return null;
  }
}

function TextEditor({ value, onChange, onCancel }: { value: string; onChange: (v: string) => void; onCancel: () => void }) {
  const [text, setText] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);

  return (
    <div className="absolute inset-0 z-10">
      <textarea
        ref={ref}
        className="w-full h-full p-1.5 text-sm border-2 border-blue-500 rounded bg-white dark:bg-zinc-900 resize-none outline-none"
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onChange(text); }
          if (e.key === 'Escape') onCancel();
        }}
        onBlur={() => onChange(text)}
      />
    </div>
  );
}

function NumberEditor({ value, onChange, onCancel, isProgress }: { value: number; onChange: (v: number) => void; onCancel: () => void; isProgress?: boolean }) {
  const [num, setNum] = useState(String(value));
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);

  const commit = () => {
    let n = parseFloat(num) || 0;
    if (isProgress) n = Math.max(0, Math.min(100, n));
    onChange(n);
  };

  return (
    <div className="absolute inset-0 z-10">
      <input
        ref={ref}
        type="number"
        className="w-full h-full p-1.5 text-sm border-2 border-blue-500 rounded bg-white dark:bg-zinc-900 outline-none"
        value={num}
        min={isProgress ? 0 : undefined}
        max={isProgress ? 100 : undefined}
        onChange={e => setNum(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') onCancel();
        }}
        onBlur={commit}
      />
    </div>
  );
}

function SelectEditor({ options, value, onChange, onCancel }: { options: SelectOption[]; value: string; onChange: (v: string) => void; onCancel: () => void }) {
  return (
    <div className="absolute inset-0 z-20 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded shadow-lg overflow-auto max-h-48">
      {options.map(opt => (
        <button
          key={opt.id}
          className={`w-full px-3 py-1.5 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center gap-2 ${value === opt.id ? 'bg-blue-50 dark:bg-blue-950/30' : ''}`}
          onClick={() => onChange(opt.id)}
        >
          <span className={`w-2.5 h-2.5 rounded-full bg-${opt.color}-500`} />
          {opt.label}
          {value === opt.id && <Check className="w-3.5 h-3.5 ml-auto text-blue-500" />}
        </button>
      ))}
      {value && (
        <button className="w-full px-3 py-1.5 text-left text-sm text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center gap-2" onClick={() => onChange('')}>
          <X className="w-3.5 h-3.5" /> 清除
        </button>
      )}
      <div className="absolute inset-0 pointer-events-none" />
      {/* 点击外部关闭 */}
      <div className="fixed inset-0 z-[-1]" onClick={onCancel} />
    </div>
  );
}

function MultiSelectEditor({ options, value, onChange, onCancel }: { options: SelectOption[]; value: string[]; onChange: (v: string[]) => void; onCancel: () => void }) {
  const [selected, setSelected] = useState<Set<string>>(new Set(value));

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  return (
    <div className="absolute inset-0 z-20 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded shadow-lg overflow-auto max-h-48">
      {options.map(opt => (
        <button
          key={opt.id}
          className={`w-full px-3 py-1.5 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center gap-2 ${selected.has(opt.id) ? 'bg-blue-50 dark:bg-blue-950/30' : ''}`}
          onClick={() => toggle(opt.id)}
        >
          <span className={`w-2.5 h-2.5 rounded-full bg-${opt.color}-500`} />
          {opt.label}
          {selected.has(opt.id) && <Check className="w-3.5 h-3.5 ml-auto text-blue-500" />}
        </button>
      ))}
      <div className="flex justify-end p-1.5 border-t border-zinc-100 dark:border-zinc-800">
        <button className="px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600" onClick={() => onChange(Array.from(selected))}>
          确定
        </button>
      </div>
      <div className="fixed inset-0 z-[-1]" onClick={() => { onChange(Array.from(selected)); onCancel(); }} />
    </div>
  );
}

function DateEditor({ value, onChange, onCancel, includeTime }: { value: string; onChange: (v: string) => void; onCancel: () => void; includeTime?: boolean }) {
  const [date, setDate] = useState(value ? value.slice(0, includeTime ? 16 : 10) : '');
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => { ref.current?.focus(); }, []);

  return (
    <div className="absolute inset-0 z-10">
      <input
        ref={ref}
        type={includeTime ? 'datetime-local' : 'date'}
        className="w-full h-full p-1.5 text-sm border-2 border-blue-500 rounded bg-white dark:bg-zinc-900 outline-none"
        value={date}
        onChange={e => setDate(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') onChange(date || '');
          if (e.key === 'Escape') onCancel();
        }}
        onBlur={() => onChange(date || '')}
      />
    </div>
  );
}

function RatingEditor({ value, max, onChange, onCancel }: { value: number; max: number; onChange: (v: number) => void; onCancel: () => void }) {
  return (
    <div className="absolute inset-0 z-20 flex items-center gap-0.5 px-1 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded">
      {Array.from({ length: max }, (_, i) => (
        <button key={i} onClick={() => onChange(value === i + 1 ? 0 : i + 1)} className="p-0.5">
          <Star className={`w-4 h-4 ${i < value ? 'fill-amber-400 text-amber-400' : 'text-zinc-300'}`} />
        </button>
      ))}
      <div className="fixed inset-0 z-[-1]" onClick={onCancel} />
    </div>
  );
}

// ==================== 单元格只读渲染 ====================

interface CellDisplayProps {
  field: BitableField;
  value: CellValue;
}

export function CellDisplay({ field, value }: CellDisplayProps) {
  if (value === null || value === undefined || value === '') {
    return <span className="text-zinc-300 dark:text-zinc-600">—</span>;
  }

  switch (field.type) {
    case 'text':
      return <span className="truncate">{value as string}</span>;
    case 'number':
      return <span className="font-mono">{formatNumber(value as number, field.config)}</span>;
    case 'select': {
      const opt = field.config?.options?.find(o => o.id === value);
      if (!opt) return <span>{value as string}</span>;
      return (
        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs bg-${opt.color}-100 dark:bg-${opt.color}-950/40 text-${opt.color}-700 dark:text-${opt.color}-300`}>
          {opt.label}
        </span>
      );
    }
    case 'multiSelect': {
      const ids = (value as string[]) ?? [];
      const opts = field.config?.options?.filter(o => ids.includes(o.id)) ?? [];
      return (
        <div className="flex flex-wrap gap-1">
          {opts.map(opt => (
            <span key={opt.id} className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-${opt.color}-100 dark:bg-${opt.color}-950/40 text-${opt.color}-700 dark:text-${opt.color}-300`}>
              {opt.label}
            </span>
          ))}
        </div>
      );
    }
    case 'checkbox':
      return (
        <div className="flex items-center justify-center">
          <div className={`w-4 h-4 rounded border ${value ? 'bg-blue-500 border-blue-500' : 'border-zinc-300 dark:border-zinc-600'} flex items-center justify-center`}>
            {value && <Check className="w-3 h-3 text-white" />}
          </div>
        </div>
      );
    case 'date':
      return <span className="text-sm">{formatDateValue(value as string)}</span>;
    case 'url':
      return (
        <a href={value as string} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline truncate">
          {value as string}
        </a>
      );
    case 'rating': {
      const n = (value as number) || 0;
      const max = field.config?.maxRating ?? 5;
      return (
        <div className="flex items-center gap-0.5">
          {Array.from({ length: max }, (_, i) => (
            <Star key={i} className={`w-3.5 h-3.5 ${i < n ? 'fill-amber-400 text-amber-400' : 'text-zinc-300'}`} />
          ))}
        </div>
      );
    }
    case 'progress': {
      const pct = Math.max(0, Math.min(100, (value as number) || 0));
      return (
        <div className="flex items-center gap-2">
          <div className="flex-1 h-2 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden">
            <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
          </div>
          <span className="text-xs text-zinc-500 w-8 text-right">{pct}%</span>
        </div>
      );
    }
    case 'createdAt':
    case 'updatedAt':
      return <span className="text-xs text-zinc-500">{formatDateValue(value as string)}</span>;
    default:
      return <span>{String(value)}</span>;
  }
}

function formatNumber(n: number, config?: { precision?: number; numberFormat?: string }): string {
  const precision = config?.precision ?? 0;
  if (config?.numberFormat === 'percent') return `${n.toFixed(precision)}%`;
  if (config?.numberFormat === 'currency') return `¥${n.toFixed(precision)}`;
  return precision > 0 ? n.toFixed(precision) : String(n);
}

function formatDateValue(iso: string): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  } catch {
    return iso;
  }
}
