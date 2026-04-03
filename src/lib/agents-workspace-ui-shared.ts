/**
 * Agents 工作区 UI 持久化（前后端共用类型与 project 键规则，无 Node 依赖）。
 */

export type AgentsWorkspaceActivePersist =
  | { kind: 'session'; agentId: string; sessionId: string | null }
  | { kind: 'agent'; agentId: string; mode: 'chat' | 'settings' };

/** 每个 Agent 上次停留的面板（键为 agentId），用于侧栏切回时恢复 */
export type AgentsWorkspacePerAgentFocusPersist =
  | { kind: 'agent'; mode: 'chat' | 'settings' }
  | { kind: 'session'; sessionId: string | null };

export interface AgentsWorkspaceProjectPersist {
  tabs: Array<{ agentId: string; sessionId: string | null }>;
  active: AgentsWorkspaceActivePersist | null;
  /** 可选；旧文件无此字段 */
  lastFocusByAgent?: Record<string, AgentsWorkspacePerAgentFocusPersist>;
}

export const AGENTS_WORKSPACE_UI_VERSION = 1 as const;

/** 与磁盘 `byProject` 键一致：无项目时用 `_global` */
export function agentsWorkspaceStorageKey(projectKey: string | null | undefined): string {
  if (projectKey === null || projectKey === undefined || projectKey === '') return '_global';
  return projectKey;
}
