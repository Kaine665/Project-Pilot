export type Status = 'done' | 'doing' | 'todo';

// ==================== 统一树形结构 ====================

export interface ContextItem {
  id: string;
  type: 'text' | 'file';
  label: string;
  content: string;
}

export interface TreeItem {
  id: string;
  content: string;
  status: Status;
  description?: string;
  children?: TreeItem[];
  deferred?: boolean;
  agentId?: string;               // 预绑定的 Agent ID
  context?: {
    items?: ContextItem[];          // 用户手动添加的上下文
    excludes?: string[];            // 关掉的自动采集类别 key
    globalContextIds?: string[];    // 选中的全局上下文条目 ID（来自 /flows/context 页面的 ContextEntry.id）
  };
}

export interface Section {
  id: string;
  name: string;
  description?: string;
  items: TreeItem[];
}

export interface FlowData {
  sections: Section[];
  cycleDeadline?: string; // ISO date string, e.g. "2026-03-01"
}

// ==================== 旧类型（仅迁移用） ====================

/** @deprecated 仅供 flow-migration.ts 使用 */
export interface LegacyTask {
  id: string;
  content: string;
  status: Status;
  children?: LegacyTask[];
  deferred?: boolean;
}

/** @deprecated 仅供 flow-migration.ts 使用 */
export interface LegacyFlowNode {
  id: string;
  name: string;
  status: Status;
  description: string;
  tasks: LegacyTask[];
}

/** @deprecated 仅供 flow-migration.ts 使用 */
export interface LegacyFlow {
  id: string;
  name: string;
  description: string;
  nodes: LegacyFlowNode[];
}

/** @deprecated 仅供 flow-migration.ts 使用 */
export interface LegacyCrossCutting {
  id: string;
  name: string;
  status: Status;
  tasks: LegacyTask[];
}

/** @deprecated 仅供 flow-migration.ts 使用 */
export interface LegacyFlowData {
  flows: LegacyFlow[];
  crossCutting: LegacyCrossCutting[];
  cycleDeadline?: string;
}
