/**
 * 板块→Pilot 协作协议：上下文数据结构
 *
 * 当用户从项目板块发起 AI 协作时，
 * UI 从树形结构中采集上下文，组装成此结构，
 * 附带在创建 Session 的请求体中。
 */

import type { Status } from './flow';

// ==================== 上下文主体 ====================

/**
 * 板块发起 AI 协作时附带的完整上下文。
 * 存储在 Session.flowContext 字段上，供 prompt-builder 在 Phase 1 使用。
 */
export interface FlowTaskContext {
  // ── 项目标识 ──

  /** 项目 key，对应 projects.json 和 flows 文件名 */
  projectKey: string;
  /** 项目显示名 */
  projectName: string;

  // ── 任务自身 ──

  /** 链路侧任务 ID，用于状态回写 */
  flowTaskId: string;
  /** 任务内容（短语） */
  taskContent: string;
  /** 任务描述（可选） */
  taskDescription?: string;

  // ── 所属位置 ──

  /** 所属板块 ID */
  sectionId: string;
  /** 所属板块名 */
  sectionName: string;
  /** 板块描述 */
  sectionDescription?: string;

  // ── 祖先路径（从板块根到任务父级） ──

  /** ancestors[0] 是板块的直接子项，ancestors[n-1] 是任务的父级 */
  ancestors: AncestorBrief[];

  // ── 周围上下文 ──

  /** 同级任务（排除自身） */
  siblings: SiblingBrief[];
  /** 项目中其他板块 */
  otherSections: SectionBrief[];
  /** 周期截止日期 */
  cycleDeadline?: string;
}

// ==================== 简要引用类型 ====================

export interface AncestorBrief {
  id: string;
  content: string;
  description?: string;
  status: Status;
}

export interface SiblingBrief {
  content: string;
  status: Status;
}

export interface SectionBrief {
  name: string;
  description?: string;
}

// ==================== 旧格式兼容（已有 Session 可能存旧字段） ====================

/** 旧格式 FlowTaskContext 中特有的字段，用于类型守卫 */
export interface LegacyFlowTaskContext {
  projectKey: string;
  projectName: string;
  flowTaskId: string;
  taskContent: string;
  flowId: string;
  flowName: string;
  flowDescription: string;
  nodeId: string;
  nodeName: string;
  nodeDescription: string;
  siblingTasks: Array<{ content: string; status: Status }>;
  predecessorNodes: Array<{ name: string; status: Status }>;
  crossCutting: Array<{ name: string; status: Status }>;
  cycleDeadline?: string;
}

/** 检测是否为旧格式 flowContext */
export function isLegacyFlowContext(
  fc: FlowTaskContext | LegacyFlowTaskContext,
): fc is LegacyFlowTaskContext {
  return 'flowId' in fc;
}
