// ── Types ──

export interface AllSessionItem {
  id: string;
  title: string;
  updatedAt: string;
  agentId: string;
  agentName: string;
  /** 内置 Agent 的 slug，用于头像等展示 */
  agentSlug?: string;
  agentIcon?: string;
  unreadCount?: number;
  archived?: boolean;
  projectKey?: string;
  isRunning?: boolean;
  runningStartedAt?: string;
}

// Opened session instance: tracks a mounted AgentChatPanel
export interface OpenedSession {
  sessionId: string | null; // null = new session (not yet created)
  agentId: string;
  key: number; // stable key for React
}

// ── Session day-grouping helper ──

export function groupSessionsByDay<T extends { updatedAt: string }>(sessions: T[]) {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = todayStart - 86_400_000;

  const groups: Array<{ label: string; items: T[] }> = [];
  const map = new Map<string, T[]>();

  for (const s of sessions) {
    const d = new Date(s.updatedAt);
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

    let label: string;
    if (dayStart >= todayStart) label = '今天';
    else if (dayStart >= yesterdayStart) label = '昨天';
    else label = `${d.getMonth() + 1}月${d.getDate()}日`;

    if (!map.has(label)) map.set(label, []);
    map.get(label)!.push(s);
  }

  for (const [label, items] of map) {
    groups.push({ label, items });
  }

  return groups;
}

// ── Session navigation link info ──

export interface SessionNavLink {
  id: string;
  title: string;
  agentId: string;
  agentName?: string;
}

// ── URL param sync helper ──

export function syncUrlParams(params: Record<string, string | null | undefined>) {
  if (typeof window === 'undefined') return;

  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(params)) {
    if (value) {
      url.searchParams.set(key, value);
    } else {
      url.searchParams.delete(key);
    }
  }

  const next = url.toString();
  if (next === window.location.href) return;

  // Defer history update to avoid "setState during render" warnings from router internals.
  setTimeout(() => {
    if (window.location.href !== next) {
      window.history.replaceState({}, '', next);
    }
  }, 0);
}

/**
 * 构建跳转到指定会话的 URL。
 * 统一走 /flows/agents 路由，通过 query params 定位 agent + session。
 */
export function buildSessionUrl(agentId: string, sessionId: string, locale = 'zh'): string {
  return `/${locale}/flows/agents?agent=${encodeURIComponent(agentId)}&session=${encodeURIComponent(sessionId)}`;
}
