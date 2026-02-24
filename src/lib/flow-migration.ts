/**
 * 旧格式（flows[] + crossCutting[]）→ 新格式（sections[]）迁移
 *
 * API GET 时自动检测并迁移，迁移后立即写回文件（只做一次）。
 */

import type {
  FlowData,
  Section,
  TreeItem,
  LegacyFlowData,
  LegacyTask,
} from '@/types/flow';

/** 检测是否为旧格式 */
export function isLegacyFormat(data: unknown): data is LegacyFlowData {
  return (
    data !== null &&
    typeof data === 'object' &&
    'flows' in data &&
    Array.isArray((data as LegacyFlowData).flows)
  );
}

/** 将旧格式迁移为新格式 */
export function migrateLegacyToSections(legacy: LegacyFlowData): FlowData {
  const sections: Section[] = [];

  // 每个 Flow → 一个 Section
  for (const flow of legacy.flows) {
    const items: TreeItem[] = flow.nodes.map((node) => ({
      id: node.id,
      content: node.name,
      status: node.status,
      description: node.description && node.description !== '描述' ? node.description : undefined,
      children: node.tasks.length > 0 ? node.tasks.map(migrateTask) : undefined,
    }));

    sections.push({
      id: flow.id,
      name: flow.name,
      description: flow.description && flow.description !== '描述' ? flow.description : undefined,
      items,
    });
  }

  // 所有 CrossCutting → 合并成一个 Section "基础设施"
  if (legacy.crossCutting.length > 0) {
    const ccItems: TreeItem[] = legacy.crossCutting.map((cc) => ({
      id: cc.id,
      content: cc.name,
      status: cc.status,
      children: cc.tasks.length > 0 ? cc.tasks.map(migrateTask) : undefined,
    }));

    sections.push({
      id: '_cc',
      name: '基础设施',
      description: '影响所有链路',
      items: ccItems,
    });
  }

  return {
    sections,
    cycleDeadline: legacy.cycleDeadline,
  };
}

function migrateTask(task: LegacyTask): TreeItem {
  const item: TreeItem = {
    id: task.id,
    content: task.content,
    status: task.status,
  };
  if (task.deferred) item.deferred = true;
  if (task.children && task.children.length > 0) {
    item.children = task.children.map(migrateTask);
  }
  return item;
}
