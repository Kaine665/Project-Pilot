/**
 * 将 Agents 工作区 UI 快照与当前注册表、会话索引对齐，去掉无效 agent/session、错误 project 归属。
 */

import { listAgents } from '@/lib/agents-store';
import { listAllSessions } from '@/lib/chat-managers/agent-chat-session-store';
import { isValidSessionId } from '@/lib/security-validation';
import type {
  AgentsWorkspaceActivePersist,
  AgentsWorkspacePerAgentFocusPersist,
  AgentsWorkspaceProjectPersist,
} from '@/lib/agents-workspace-ui-shared';

function tabKey(agentId: string, sessionId: string | null): string {
  return `${agentId}\0${sessionId ?? ''}`;
}

/**
 * @param projectKey 与 UI `byProject` 桶一致：null = 全局（无项目筛选）
 */
export async function sanitizeAgentsWorkspaceProjectState(
  projectKey: string | null,
  state: AgentsWorkspaceProjectPersist,
): Promise<AgentsWorkspaceProjectPersist> {
  const agents = await listAgents({ includeArchived: false });
  const scoped = projectKey !== null && projectKey !== '';
  const allowedAgentIds = new Set(
    agents
      .filter((a) => {
        if (!scoped) return true;
        return !a.projectKey || a.projectKey === projectKey;
      })
      .map((a) => a.id),
  );

  const sessions = await listAllSessions();
  const sessionById = new Map(sessions.map((s) => [s.id, s]));

  const agentAllowed = (agentId: string) => allowedAgentIds.has(agentId);

  const sessionOkForTab = (agentId: string, sessionId: string | null): boolean => {
    if (!agentAllowed(agentId)) return false;
    if (sessionId === null) return true;
    if (!isValidSessionId(sessionId)) return false;
    const meta = sessionById.get(sessionId);
    if (!meta || meta.agentId !== agentId) return false;
    if (scoped) {
      if (meta.projectKey !== projectKey) return false;
    }
    return true;
  };

  const seen = new Set<string>();
  const tabs = state.tabs.filter((t) => {
    if (!sessionOkForTab(t.agentId, t.sessionId)) return false;
    const k = tabKey(t.agentId, t.sessionId);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  let active: AgentsWorkspaceActivePersist | null = state.active;

  if (tabs.length === 0) {
    return { tabs: [], active: null, lastFocusByAgent: undefined };
  }

  const tabMatchesActiveSession = (act: { agentId: string; sessionId: string | null }) =>
    tabs.some((t) => t.agentId === act.agentId && t.sessionId === act.sessionId);

  if (active?.kind === 'session') {
    if (!tabMatchesActiveSession(active)) {
      active = {
        kind: 'session',
        agentId: tabs[0].agentId,
        sessionId: tabs[0].sessionId,
      };
    }
  } else if (active?.kind === 'agent') {
    if (!agentAllowed(active.agentId)) {
      active = {
        kind: 'session',
        agentId: tabs[0].agentId,
        sessionId: tabs[0].sessionId,
      };
    }
  } else {
    active = {
      kind: 'session',
      agentId: tabs[0].agentId,
      sessionId: tabs[0].sessionId,
    };
  }

  let lastFocusByAgent: Record<string, AgentsWorkspacePerAgentFocusPersist> | undefined;
  if (state.lastFocusByAgent) {
    const next: Record<string, AgentsWorkspacePerAgentFocusPersist> = {};
    for (const [aid, f] of Object.entries(state.lastFocusByAgent)) {
      if (!agentAllowed(aid)) continue;
      if (f.kind === 'session') {
        if (sessionOkForTab(aid, f.sessionId)) next[aid] = f;
      } else {
        next[aid] = f;
      }
    }
    if (Object.keys(next).length > 0) lastFocusByAgent = next;
  }

  return { tabs, active, lastFocusByAgent };
}
