import type { SessionConfig } from '@/types/agent-chat';
import type { SessionNavLink } from '@/components/agent-session-utils';
import type { SessionListItem } from './types';

// ── Session list helpers ──

export function sortSessionList(items: SessionListItem[]): SessionListItem[] {
  return [...items].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
}

export function mergeSessionList(
  prev: SessionListItem[],
  remote: SessionListItem[],
): SessionListItem[] {
  const remoteIds = new Set(remote.map((s) => s.id));
  const localById = new Map(prev.map((s) => [s.id, s]));
  const mergedRemote = remote.map((item) => {
    const local = localById.get(item.id);
    if (!local?.isRunning && !local?.isAwaiting) return item;
    return {
      ...item,
      isRunning: local.isRunning || undefined,
      isAwaiting: local.isAwaiting || item.isAwaiting || undefined,
      runningStartedAt: local.runningStartedAt ?? item.runningStartedAt,
    };
  });
  const localOnly = prev.filter((s) => !remoteIds.has(s.id));
  return sortSessionList([...localOnly, ...mergedRemote]);
}

export function upsertSessionListItem(
  prev: SessionListItem[],
  item: SessionListItem,
): SessionListItem[] {
  const next = prev.filter((s) => s.id !== item.id);
  next.push(item);
  return sortSessionList(next);
}

export function patchSessionListItem(
  prev: SessionListItem[],
  sessionId: string,
  patch: Partial<SessionListItem>,
): SessionListItem[] {
  return sortSessionList(
    prev.map((s) => (s.id === sessionId ? { ...s, ...patch } : s)),
  );
}

// ── Session Reducer ──

export type SessionState = {
  id: string | null;
  title: string;
  list: SessionListItem[];
  config: SessionConfig;
  parentSession: SessionNavLink | null;
  childSessions: SessionNavLink[];
  showChildList: boolean;
};

export type SessionAction =
  | { type: 'SET_ID'; id: string | null }
  | { type: 'SET_TITLE'; title: string }
  | { type: 'SET_CONFIG'; config: SessionConfig }
  | { type: 'UPDATE_LIST'; updater: (prev: SessionListItem[]) => SessionListItem[] }
  | { type: 'MERGE_LIST'; remote: SessionListItem[] }
  | { type: 'SET_NAV'; parent: SessionNavLink | null; children: SessionNavLink[] }
  | { type: 'TOGGLE_CHILD_LIST' }
  | { type: 'CLOSE_CHILD_LIST' }
  | { type: 'SELECT'; id: string; title: string }
  | { type: 'NEW'; defaultTitle: string }
  | { type: 'RESET'; defaultTitle: string };

export function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case 'SET_ID':
      return { ...state, id: action.id };
    case 'SET_TITLE':
      return { ...state, title: action.title };
    case 'SET_CONFIG':
      return { ...state, config: action.config };
    case 'UPDATE_LIST':
      return { ...state, list: action.updater(state.list) };
    case 'MERGE_LIST':
      return { ...state, list: mergeSessionList(state.list, action.remote) };
    case 'SET_NAV':
      return { ...state, parentSession: action.parent, childSessions: action.children, showChildList: false };
    case 'TOGGLE_CHILD_LIST':
      return { ...state, showChildList: !state.showChildList };
    case 'CLOSE_CHILD_LIST':
      return { ...state, showChildList: false };
    case 'SELECT':
      return { ...state, id: action.id, title: action.title, config: {}, showChildList: false };
    case 'NEW':
      return {
        ...state,
        id: null,
        title: action.defaultTitle,
        config: {},
        parentSession: null,
        childSessions: [],
        showChildList: false,
      };
    case 'RESET':
      return {
        id: null,
        title: action.defaultTitle,
        list: [],
        config: {},
        parentSession: null,
        childSessions: [],
        showChildList: false,
      };
    default:
      return state;
  }
}
