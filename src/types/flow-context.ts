/**
 * 历史「链路 / 板块」上下文：FlowTaskContext
 *
 * 树形看板 UI 已移除；旧数据或文档仍可能将 FlowTaskContext 挂在历史 **LegacyTaskWorkerSession.flowContext**（见 `types/index.ts`）上描述；Agent Chat 权威类型见 `AgentChatSession`。
 */

/** 与历史链路 JSON、FlowTaskContext 字段一致 */
export type Status = 'done' | 'doing' | 'todo';

export interface ContextItem {
  id: string;
  type: 'text' | 'file';
  label: string;
  content: string;
}

// ==================== 上下文主体 ====================

/**
 * 历史链路发起 AI 协作时附带的完整上下文（可选）。
 * 历史上可存于 LegacyTaskWorkerSession.flowContext；新 UI 不再采集，保留类型以兼容旧数据/工具。
 */
export interface FlowTaskContext {
  // ── 项目标识 ──

  /** 项目 key，对应 projects/index.json */
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

  // ── 用户附加上下文 ──

  /** 用户手动添加的上下文条目 */
  customContext?: ContextItem[];

  // ── 全局上下文 ──

  /** 用户选中的全局上下文条目 ID（历史会话字段） */
  globalContextIds?: string[];
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

// ==================== 旧格式兼容（历史会话记录可能存旧字段） ====================

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
