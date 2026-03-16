/**
 * 多维表格 (Bitable) 数据存储层
 *
 * 数据文件结构：
 * ~/.project-pilot/data/bitable/
 *   _index.json           — 所有 base 的元信息索引
 *   {baseId}.json          — 单个 base 的完整数据（含 tables, fields, records）
 */

import path from 'path';
import { getDataDir, readJsonFile, writeJsonFile, modifyJsonFile } from './file-store';
import type {
  BitableBase,
  BitableBaseMeta,
  BitableIndex,
  BitableTable,
  BitableField,
  BitableRecord,
  BitableView,
  CellValue,
} from '@/types/bitable';

// ==================== 路径函数 ====================

export function getBitableDir(): string {
  return path.join(getDataDir(), 'storage', 'bitable');
}

export function getBitableIndexPath(): string {
  return path.join(getBitableDir(), '_index.json');
}

export function getBitableBasePath(baseId: string): string {
  const safe = baseId.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safe || safe.length < 1 || safe.length > 100) {
    throw new Error(`Invalid base id: ${baseId}`);
  }
  return path.join(getBitableDir(), `${safe}.json`);
}

// ==================== ID 生成 ====================

function generateId(prefix: string): string {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 6);
  return `${prefix}-${ts}-${rand}`;
}

// ==================== 索引操作 ====================

const DEFAULT_INDEX: BitableIndex = { bases: [] };

export async function readBitableIndex(): Promise<BitableIndex> {
  return readJsonFile<BitableIndex>(getBitableIndexPath(), DEFAULT_INDEX);
}

async function updateIndex(updater: (index: BitableIndex) => BitableIndex): Promise<BitableIndex> {
  return modifyJsonFile<BitableIndex>(getBitableIndexPath(), DEFAULT_INDEX, updater);
}

function baseToMeta(base: BitableBase): BitableBaseMeta {
  return {
    id: base.id,
    name: base.name,
    description: base.description,
    icon: base.icon,
    projectKey: base.projectKey,
    tableCount: base.tables.length,
    createdAt: base.createdAt,
    updatedAt: base.updatedAt,
  };
}

// ==================== Base CRUD ====================

export async function createBase(data: {
  name: string;
  description?: string;
  icon?: string;
  projectKey?: string;
}): Promise<BitableBase> {
  const now = new Date().toISOString();
  const base: BitableBase = {
    id: generateId('base'),
    name: data.name,
    description: data.description,
    icon: data.icon,
    projectKey: data.projectKey,
    tables: [],
    createdAt: now,
    updatedAt: now,
  };

  // 写入 base 数据文件
  await writeJsonFile(getBitableBasePath(base.id), base);

  // 更新索引
  await updateIndex(idx => ({
    ...idx,
    bases: [...idx.bases, baseToMeta(base)],
  }));

  return base;
}

export async function readBase(baseId: string): Promise<BitableBase | null> {
  try {
    const base = await readJsonFile<BitableBase | null>(getBitableBasePath(baseId), null);
    return base;
  } catch {
    return null;
  }
}

export async function updateBase(baseId: string, data: {
  name?: string;
  description?: string;
  icon?: string;
}): Promise<BitableBase | null> {
  const basePath = getBitableBasePath(baseId);
  const base = await readJsonFile<BitableBase | null>(basePath, null);
  if (!base) return null;

  const updated: BitableBase = {
    ...base,
    ...(data.name !== undefined && { name: data.name }),
    ...(data.description !== undefined && { description: data.description }),
    ...(data.icon !== undefined && { icon: data.icon }),
    updatedAt: new Date().toISOString(),
  };

  await writeJsonFile(basePath, updated);

  // 同步索引
  await updateIndex(idx => ({
    ...idx,
    bases: idx.bases.map(b => b.id === baseId ? baseToMeta(updated) : b),
  }));

  return updated;
}

export async function deleteBase(baseId: string): Promise<boolean> {
  const { promises: fs } = await import('fs');
  try {
    await fs.unlink(getBitableBasePath(baseId));
  } catch {
    // 文件不存在也算成功
  }

  await updateIndex(idx => ({
    ...idx,
    bases: idx.bases.filter(b => b.id !== baseId),
  }));

  return true;
}

// ==================== Table CRUD ====================

async function modifyBase(
  baseId: string,
  modifier: (base: BitableBase) => BitableBase,
): Promise<BitableBase | null> {
  const basePath = getBitableBasePath(baseId);
  const base = await readJsonFile<BitableBase | null>(basePath, null);
  if (!base) return null;

  const updated = modifier({
    ...base,
    updatedAt: new Date().toISOString(),
  });

  await writeJsonFile(basePath, updated);

  // 同步索引的 tableCount 和 updatedAt
  await updateIndex(idx => ({
    ...idx,
    bases: idx.bases.map(b => b.id === baseId ? baseToMeta(updated) : b),
  }));

  return updated;
}

export async function createTable(baseId: string, data: {
  name: string;
  description?: string;
}): Promise<BitableTable | null> {
  const now = new Date().toISOString();

  // 默认字段：标题
  const defaultField: BitableField = {
    id: generateId('field'),
    name: '标题',
    type: 'text',
    width: 300,
  };

  // 默认视图：表格视图
  const defaultView: BitableView = {
    id: generateId('view'),
    name: '表格视图',
    type: 'grid',
    fieldOrder: [defaultField.id],
  };

  const table: BitableTable = {
    id: generateId('table'),
    name: data.name,
    description: data.description,
    fields: [defaultField],
    views: [defaultView],
    records: [],
    createdAt: now,
    updatedAt: now,
  };

  const result = await modifyBase(baseId, base => ({
    ...base,
    tables: [...base.tables, table],
  }));

  return result ? table : null;
}

export async function updateTable(baseId: string, tableId: string, data: {
  name?: string;
  description?: string;
}): Promise<BitableTable | null> {
  let updated: BitableTable | null = null;

  await modifyBase(baseId, base => ({
    ...base,
    tables: base.tables.map(t => {
      if (t.id !== tableId) return t;
      updated = {
        ...t,
        ...(data.name !== undefined && { name: data.name }),
        ...(data.description !== undefined && { description: data.description }),
        updatedAt: new Date().toISOString(),
      };
      return updated;
    }),
  }));

  return updated;
}

export async function deleteTable(baseId: string, tableId: string): Promise<boolean> {
  const result = await modifyBase(baseId, base => ({
    ...base,
    tables: base.tables.filter(t => t.id !== tableId),
  }));
  return result !== null;
}

// ==================== Field CRUD ====================

export async function addField(baseId: string, tableId: string, data: {
  name: string;
  type: BitableField['type'];
  config?: BitableField['config'];
  width?: number;
  required?: boolean;
  description?: string;
}): Promise<BitableField | null> {
  const field: BitableField = {
    id: generateId('field'),
    name: data.name,
    type: data.type,
    config: data.config,
    width: data.width ?? 200,
    required: data.required,
    description: data.description,
  };

  let added = false;
  await modifyBase(baseId, base => ({
    ...base,
    tables: base.tables.map(t => {
      if (t.id !== tableId) return t;
      added = true;
      return {
        ...t,
        fields: [...t.fields, field],
        // 将新字段追加到所有 grid 视图的 fieldOrder
        views: t.views.map(v => {
          if (v.type === 'grid' && v.fieldOrder) {
            return { ...v, fieldOrder: [...v.fieldOrder, field.id] };
          }
          return v;
        }),
        updatedAt: new Date().toISOString(),
      };
    }),
  }));

  return added ? field : null;
}

export async function updateField(baseId: string, tableId: string, fieldId: string, data: {
  name?: string;
  config?: BitableField['config'];
  width?: number;
  required?: boolean;
  description?: string;
}): Promise<BitableField | null> {
  let updated: BitableField | null = null;

  await modifyBase(baseId, base => ({
    ...base,
    tables: base.tables.map(t => {
      if (t.id !== tableId) return t;
      return {
        ...t,
        fields: t.fields.map(f => {
          if (f.id !== fieldId) return f;
          updated = { ...f, ...data };
          return updated;
        }),
        updatedAt: new Date().toISOString(),
      };
    }),
  }));

  return updated;
}

export async function deleteField(baseId: string, tableId: string, fieldId: string): Promise<boolean> {
  let deleted = false;

  await modifyBase(baseId, base => ({
    ...base,
    tables: base.tables.map(t => {
      if (t.id !== tableId) return t;
      // 至少保留一个字段
      if (t.fields.length <= 1) return t;

      deleted = true;
      return {
        ...t,
        fields: t.fields.filter(f => f.id !== fieldId),
        // 清理记录中的对应字段值
        records: t.records.map(r => {
          const cells = { ...r.cells };
          delete cells[fieldId];
          return { ...r, cells };
        }),
        // 清理视图中的字段引用
        views: t.views.map(v => ({
          ...v,
          fieldOrder: v.fieldOrder?.filter(id => id !== fieldId),
          hiddenFields: v.hiddenFields?.filter(id => id !== fieldId),
          sorts: v.sorts?.filter(s => s.fieldId !== fieldId),
          filters: v.filters?.filter(f => f.fieldId !== fieldId),
          groups: v.groups?.filter(g => g.fieldId !== fieldId),
          kanbanFieldId: v.kanbanFieldId === fieldId ? undefined : v.kanbanFieldId,
        })),
        updatedAt: new Date().toISOString(),
      };
    }),
  }));

  return deleted;
}

// ==================== Record CRUD ====================

export async function addRecord(baseId: string, tableId: string, cells?: Record<string, CellValue>): Promise<BitableRecord | null> {
  const now = new Date().toISOString();
  const record: BitableRecord = {
    id: generateId('rec'),
    cells: cells ?? {},
    createdAt: now,
    updatedAt: now,
  };

  let added = false;
  await modifyBase(baseId, base => ({
    ...base,
    tables: base.tables.map(t => {
      if (t.id !== tableId) return t;
      added = true;
      return {
        ...t,
        records: [...t.records, record],
        updatedAt: now,
      };
    }),
  }));

  return added ? record : null;
}

export async function updateRecord(baseId: string, tableId: string, recordId: string, cells: Record<string, CellValue>): Promise<BitableRecord | null> {
  let updated: BitableRecord | null = null;

  await modifyBase(baseId, base => ({
    ...base,
    tables: base.tables.map(t => {
      if (t.id !== tableId) return t;
      return {
        ...t,
        records: t.records.map(r => {
          if (r.id !== recordId) return r;
          updated = {
            ...r,
            cells: { ...r.cells, ...cells },
            updatedAt: new Date().toISOString(),
          };
          return updated;
        }),
        updatedAt: new Date().toISOString(),
      };
    }),
  }));

  return updated;
}

export async function deleteRecord(baseId: string, tableId: string, recordId: string): Promise<boolean> {
  let deleted = false;

  await modifyBase(baseId, base => ({
    ...base,
    tables: base.tables.map(t => {
      if (t.id !== tableId) return t;
      deleted = t.records.some(r => r.id === recordId);
      return {
        ...t,
        records: t.records.filter(r => r.id !== recordId),
        updatedAt: new Date().toISOString(),
      };
    }),
  }));

  return deleted;
}

export async function batchDeleteRecords(baseId: string, tableId: string, recordIds: string[]): Promise<number> {
  const idSet = new Set(recordIds);
  let count = 0;

  await modifyBase(baseId, base => ({
    ...base,
    tables: base.tables.map(t => {
      if (t.id !== tableId) return t;
      const before = t.records.length;
      const after = t.records.filter(r => !idSet.has(r.id));
      count = before - after.length;
      return {
        ...t,
        records: after,
        updatedAt: new Date().toISOString(),
      };
    }),
  }));

  return count;
}

// ==================== View CRUD ====================

export async function addView(baseId: string, tableId: string, data: {
  name: string;
  type: BitableView['type'];
  kanbanFieldId?: string;
}): Promise<BitableView | null> {
  let view: BitableView | null = null;

  await modifyBase(baseId, base => ({
    ...base,
    tables: base.tables.map(t => {
      if (t.id !== tableId) return t;

      view = {
        id: generateId('view'),
        name: data.name,
        type: data.type,
        fieldOrder: data.type === 'grid' ? t.fields.map(f => f.id) : undefined,
        kanbanFieldId: data.kanbanFieldId,
      };

      return {
        ...t,
        views: [...t.views, view],
        updatedAt: new Date().toISOString(),
      };
    }),
  }));

  return view;
}

export async function updateView(baseId: string, tableId: string, viewId: string, data: Partial<Omit<BitableView, 'id' | 'type'>>): Promise<BitableView | null> {
  let updated: BitableView | null = null;

  await modifyBase(baseId, base => ({
    ...base,
    tables: base.tables.map(t => {
      if (t.id !== tableId) return t;
      return {
        ...t,
        views: t.views.map(v => {
          if (v.id !== viewId) return v;
          updated = { ...v, ...data };
          return updated;
        }),
        updatedAt: new Date().toISOString(),
      };
    }),
  }));

  return updated;
}

export async function deleteView(baseId: string, tableId: string, viewId: string): Promise<boolean> {
  let deleted = false;

  await modifyBase(baseId, base => ({
    ...base,
    tables: base.tables.map(t => {
      if (t.id !== tableId) return t;
      // 至少保留一个视图
      if (t.views.length <= 1) return t;
      deleted = true;
      return {
        ...t,
        views: t.views.filter(v => v.id !== viewId),
        updatedAt: new Date().toISOString(),
      };
    }),
  }));

  return deleted;
}
