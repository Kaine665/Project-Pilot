/**
 * 多维表格 (Bitable) 类型定义
 *
 * 数据结构层次：
 * BitableBase (表格集) → BitableTable (数据表) → BitableField (字段) + BitableRecord (记录)
 * BitableView (视图) 是数据表的不同展示方式
 */

// ==================== 字段类型 ====================

/** 支持的字段类型 */
export type BitableFieldType =
  | 'text'       // 多行文本
  | 'number'     // 数字
  | 'select'     // 单选
  | 'multiSelect'// 多选
  | 'checkbox'   // 复选框
  | 'date'       // 日期
  | 'url'        // 超链接
  | 'rating'     // 评分 (1-5)
  | 'progress'   // 进度 (0-100)
  | 'formula'    // 公式（简单计算）
  | 'createdAt'  // 创建时间（系统自动）
  | 'updatedAt'; // 更新时间（系统自动）

/** 单选/多选的选项 */
export interface SelectOption {
  id: string;
  label: string;
  color: string; // Tailwind color name, e.g. 'red', 'blue', 'green'
}

/** 字段配置（各类型特有的配置） */
export interface FieldConfig {
  // number
  precision?: number;           // 小数位数 (0-4)
  numberFormat?: 'plain' | 'percent' | 'currency';

  // select / multiSelect
  options?: SelectOption[];

  // date
  dateFormat?: 'YYYY-MM-DD' | 'YYYY/MM/DD' | 'MM/DD/YYYY' | 'relative';
  includeTime?: boolean;

  // rating
  maxRating?: number;           // 默认 5

  // formula
  expression?: string;          // 公式表达式，如 "{field1} + {field2}"
}

/** 字段定义 */
export interface BitableField {
  id: string;                   // field-{timestamp}-{random}
  name: string;
  type: BitableFieldType;
  config?: FieldConfig;
  width?: number;               // 列宽 (px)，默认 200
  required?: boolean;
  description?: string;
}

// ==================== 记录 ====================

/** 单元格值类型 */
export type CellValue =
  | string                      // text, url, formula result
  | number                      // number, rating, progress
  | boolean                     // checkbox
  | string[]                    // multiSelect (option ids)
  | null;

/** 一条记录 */
export interface BitableRecord {
  id: string;                   // rec-{timestamp}-{random}
  cells: Record<string, CellValue>; // fieldId → value
  createdAt: string;            // ISO timestamp
  updatedAt: string;
}

// ==================== 视图 ====================

/** 视图类型 */
export type BitableViewType = 'grid' | 'kanban';

/** 排序规则 */
export interface SortRule {
  fieldId: string;
  direction: 'asc' | 'desc';
}

/** 筛选条件操作符 */
export type FilterOperator =
  | 'eq' | 'neq'               // 等于/不等于
  | 'gt' | 'gte' | 'lt' | 'lte'// 大于/大于等于/小于/小于等于
  | 'contains' | 'notContains' // 包含/不包含
  | 'isEmpty' | 'isNotEmpty';  // 为空/不为空

/** 筛选条件 */
export interface FilterRule {
  fieldId: string;
  operator: FilterOperator;
  value?: CellValue;
}

/** 分组规则 */
export interface GroupRule {
  fieldId: string;
  direction: 'asc' | 'desc';
}

/** 视图定义 */
export interface BitableView {
  id: string;                   // view-{timestamp}-{random}
  name: string;
  type: BitableViewType;

  // 数据操作
  filters?: FilterRule[];
  sorts?: SortRule[];
  groups?: GroupRule[];

  // grid 视图配置
  fieldOrder?: string[];        // 字段显示顺序 (fieldId[])
  hiddenFields?: string[];      // 隐藏的字段 (fieldId[])

  // kanban 视图配置
  kanbanFieldId?: string;       // 看板分组字段（必须是 select 类型）
}

// ==================== 数据表 ====================

/** 数据表 */
export interface BitableTable {
  id: string;                   // table-{timestamp}-{random}
  name: string;
  description?: string;
  fields: BitableField[];
  views: BitableView[];
  records: BitableRecord[];
  createdAt: string;
  updatedAt: string;
}

// ==================== 表格集 (Base) ====================

/** 一个多维表格（包含多个数据表） */
export interface BitableBase {
  id: string;                   // base-{timestamp}-{random}
  name: string;
  description?: string;
  icon?: string;                // emoji
  projectKey?: string;          // 关联的项目 key
  tables: BitableTable[];
  createdAt: string;
  updatedAt: string;
}

/** 多维表格索引文件 (bitable/_index.json) */
export interface BitableIndex {
  bases: BitableBaseMeta[];
}

/** 索引中的 base 元信息（不含完整数据） */
export interface BitableBaseMeta {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  projectKey?: string;
  tableCount: number;
  createdAt: string;
  updatedAt: string;
}
