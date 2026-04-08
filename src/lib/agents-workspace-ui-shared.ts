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

/** 桌面端 Agents 页右侧 `AgentsWorkspaceRail` 显隐（整页级，不按项目 / Agent） */
export const AGENTS_PAGE_WORKSPACE_RAIL_VISIBLE_KEY = 'pp.agentsPage.workspaceRailVisible.v1';
/** 偏好有效时长：超过则忽略缓存并恢复默认（收起） */
export const AGENTS_PAGE_WORKSPACE_RAIL_VISIBLE_TTL_MS = 3 * 60 * 60 * 1000;

type AgentsPageRailVisibleBlob = { visible: boolean; savedAt: number };

export function readAgentsPageWorkspaceRailVisible(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = localStorage.getItem(AGENTS_PAGE_WORKSPACE_RAIL_VISIBLE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as Partial<AgentsPageRailVisibleBlob>;
    if (typeof parsed.savedAt !== 'number' || typeof parsed.visible !== 'boolean') return false;
    if (Date.now() - parsed.savedAt > AGENTS_PAGE_WORKSPACE_RAIL_VISIBLE_TTL_MS) {
      localStorage.removeItem(AGENTS_PAGE_WORKSPACE_RAIL_VISIBLE_KEY);
      return false;
    }
    return parsed.visible;
  } catch {
    return false;
  }
}

export function writeAgentsPageWorkspaceRailVisible(visible: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    const blob: AgentsPageRailVisibleBlob = { visible, savedAt: Date.now() };
    localStorage.setItem(AGENTS_PAGE_WORKSPACE_RAIL_VISIBLE_KEY, JSON.stringify(blob));
  } catch {
    /* ignore quota / private mode */
  }
}

/** 左侧 Agent 列表列宽（md+ 内联布局；与抽屉宽度无关） */
export const AGENTS_PAGE_AGENT_LIST_WIDTH_KEY = 'pp.agentsPage.agentListWidth.v1';
/** 与历史 UI 一致 */
export const AGENTS_PAGE_AGENT_LIST_WIDTH_DEFAULT = 292;
/** 再窄则头像 + 名称/徽章/时间易重叠；约 15rem */
export const AGENTS_PAGE_AGENT_LIST_WIDTH_MIN = 240;
export const AGENTS_PAGE_AGENT_LIST_WIDTH_MAX = 520;

export function readAgentsPageAgentListWidth(): number {
  if (typeof window === 'undefined') return AGENTS_PAGE_AGENT_LIST_WIDTH_DEFAULT;
  try {
    const raw = localStorage.getItem(AGENTS_PAGE_AGENT_LIST_WIDTH_KEY);
    if (!raw) return AGENTS_PAGE_AGENT_LIST_WIDTH_DEFAULT;
    const n = Number(raw);
    if (!Number.isFinite(n)) return AGENTS_PAGE_AGENT_LIST_WIDTH_DEFAULT;
    return Math.min(
      AGENTS_PAGE_AGENT_LIST_WIDTH_MAX,
      Math.max(AGENTS_PAGE_AGENT_LIST_WIDTH_MIN, Math.round(n)),
    );
  } catch {
    return AGENTS_PAGE_AGENT_LIST_WIDTH_DEFAULT;
  }
}

export function writeAgentsPageAgentListWidth(px: number): void {
  if (typeof window === 'undefined') return;
  try {
    const clamped = Math.min(
      AGENTS_PAGE_AGENT_LIST_WIDTH_MAX,
      Math.max(AGENTS_PAGE_AGENT_LIST_WIDTH_MIN, Math.round(px)),
    );
    localStorage.setItem(AGENTS_PAGE_AGENT_LIST_WIDTH_KEY, String(clamped));
  } catch {
    /* ignore */
  }
}
