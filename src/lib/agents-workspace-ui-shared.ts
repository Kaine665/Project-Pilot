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

/**
 * 中间聊天主区允许的最小宽度（与 `AgentChatPanelView` 消息列表 `min-w-[min(100%,…)]` 对齐）。
 * Agents 页拖左右栏时以此为「留给主区」的下限，避免与 CSS 不一致导致窄窗下缩不到 240。
 */
export const AGENTS_PAGE_MAIN_CHAT_MIN_WIDTH_PX = 240;

/** 右侧 AgentsWorkspaceRail 总宽（lg+ 并排时；含活动栏 + 面板） */
export const AGENTS_PAGE_WORKSPACE_RAIL_WIDTH_KEY = 'pp.agentsPage.workspaceRailWidth.v1';
export const AGENTS_PAGE_WORKSPACE_RAIL_WIDTH_DEFAULT = 340;
export const AGENTS_PAGE_WORKSPACE_RAIL_WIDTH_MIN = 260;
export const AGENTS_PAGE_WORKSPACE_RAIL_WIDTH_MAX = 560;

export function readAgentsPageWorkspaceRailWidth(): number {
  if (typeof window === 'undefined') return AGENTS_PAGE_WORKSPACE_RAIL_WIDTH_DEFAULT;
  try {
    const raw = localStorage.getItem(AGENTS_PAGE_WORKSPACE_RAIL_WIDTH_KEY);
    if (!raw) return AGENTS_PAGE_WORKSPACE_RAIL_WIDTH_DEFAULT;
    const n = Number(raw);
    if (!Number.isFinite(n)) return AGENTS_PAGE_WORKSPACE_RAIL_WIDTH_DEFAULT;
    return Math.min(
      AGENTS_PAGE_WORKSPACE_RAIL_WIDTH_MAX,
      Math.max(AGENTS_PAGE_WORKSPACE_RAIL_WIDTH_MIN, Math.round(n)),
    );
  } catch {
    return AGENTS_PAGE_WORKSPACE_RAIL_WIDTH_DEFAULT;
  }
}

export function writeAgentsPageWorkspaceRailWidth(px: number): void {
  if (typeof window === 'undefined') return;
  try {
    const clamped = Math.min(
      AGENTS_PAGE_WORKSPACE_RAIL_WIDTH_MAX,
      Math.max(AGENTS_PAGE_WORKSPACE_RAIL_WIDTH_MIN, Math.round(px)),
    );
    localStorage.setItem(AGENTS_PAGE_WORKSPACE_RAIL_WIDTH_KEY, String(clamped));
  } catch {
    /* ignore */
  }
}

/** 左轨点击「Agents」且已在 Agents 页时派发，用于切换 Agent 列表（桌面：并排列收起/展开；窄屏：抽屉开关） */
export const PP_AGENTS_LIST_TOGGLE_EVENT = 'pp:agents-list-toggle';

/** 左侧 Agent 列表拖窄低于此宽度（px）则视为收起；仅 md+ 并排布局生效 */
export const AGENTS_PAGE_AGENT_LIST_COLLAPSE_SNAP_PX = 80;

const AGENTS_PAGE_AGENT_LIST_COLLAPSED_KEY = 'pp.agentsPage.agentListCollapsed.v1';

export function readAgentsPageAgentListCollapsed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(AGENTS_PAGE_AGENT_LIST_COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeAgentsPageAgentListCollapsed(collapsed: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (collapsed) {
      localStorage.setItem(AGENTS_PAGE_AGENT_LIST_COLLAPSED_KEY, '1');
    } else {
      localStorage.removeItem(AGENTS_PAGE_AGENT_LIST_COLLAPSED_KEY);
    }
  } catch {
    /* ignore */
  }
}
