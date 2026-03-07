/**
 * .ppagent 文件格式定义
 *
 * ProjectPilot Agent Package — 用于导出/导入 Agent 配置的标准格式。
 * 本质是 JSON，扩展名 .ppagent，包含元数据 + 完整提示词 + 内联上下文。
 */

import type { AgentCapabilities } from './index';

// ── 包内嵌上下文条目（内联化，脱离平台文件系统） ──

export interface PackagedContext {
  /** 上下文标签 */
  label: string;
  /** 一句话描述 */
  description: string;
  /** 内容格式 */
  format: 'json' | 'markdown' | 'text';
  /** 内联化的内容全文 */
  content: string;
}

// ── .ppagent 包格式 ──

export interface AgentPackage {
  /** 固定标识，用于识别文件格式 */
  format: 'ppagent';
  /** 格式版本，用于未来兼容性 */
  version: 1;
  /** 导出时间 */
  exportedAt: string;
  /** 导出来源的 ProjectPilot 版本（如有） */
  source?: string;

  /** Agent 元数据 */
  agent: {
    name: string;
    description?: string;
    icon?: string;
    capabilities?: AgentCapabilities;
    executionMode?: 'task' | 'chat';
    requiredParams?: string[];
  };

  /** 完整的 system prompt 文本 */
  systemPrompt: string;

  /** 内联化的上下文列表（导出时从 defaultResources 中的 context 类型解析而来） */
  contexts?: PackagedContext[];
}
