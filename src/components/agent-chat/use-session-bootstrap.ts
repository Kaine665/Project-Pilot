import { useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { ChatMessage, ChatToolCall, ContentBlock } from '@/types';
import type { ChatAction } from './chat-reducer';
import type { SessionAction } from './session-reducer';
import type { SessionListItem } from './types';
import { popCachedState } from './agent-session-cache';

type RuntimeSnapshotData = {
  available?: boolean;
  status?: string;
  startedAt?: string;
  messages?: Array<{
    role: 'user' | 'assistant';
    content: string;
    images?: string[];
    contentBlocks?: ContentBlock[];
  }>;
};

type UseSessionBootstrapParams = {
  agentId: string;
  projectKey?: string | null;
  initialSessionId?: string | null;
  hasProject: boolean;
  cacheKey: string;
  initTokenRef: MutableRefObject<number>;
  streamAbortRef: MutableRefObject<AbortController | null>;
  setShowConfig: Dispatch<SetStateAction<boolean>>;
  setShowFolderExplorer: Dispatch<SetStateAction<boolean>>;
  setShowRuntimePanel: Dispatch<SetStateAction<boolean>>;
  setQueueExpanded: Dispatch<SetStateAction<boolean>>;
  resetState: () => void;
  fetchSessionList: (agentId: string, pk?: string | null) => Promise<SessionListItem[]>;
  setSessionIdSync: (id: string | null) => void;
  loadSessionData: (sid: string, token?: number) => Promise<void>;
  sessionDispatch: Dispatch<SessionAction>;
  markSessionRunning: (targetSessionId: string, startedAt?: string, title?: string) => void;
  chatDispatch: Dispatch<ChatAction>;
  blocksRef: MutableRefObject<ContentBlock[]>;
  fullTextRef: MutableRefObject<string>;
  toolCallsRef: MutableRefObject<ChatToolCall[]>;
  connectToStream: (targetSessionId: string, since: number) => void;
};

export function useSessionBootstrap(params: UseSessionBootstrapParams): void {
  const {
    agentId,
    projectKey,
    initialSessionId,
    hasProject,
    cacheKey,
    initTokenRef,
    streamAbortRef,
  } = params;

  // 始终指向最新回调，避免 connectToStream / loadSessionData / finalizeStream 链因父级 onSessionChange 等每帧变引用导致 effect 死循环
  const paramsRef = useRef(params);

  useEffect(() => {
    paramsRef.current = params;
  }, [params]);

  useEffect(() => {
    const {
      setShowConfig,
      setShowFolderExplorer,
      setShowRuntimePanel,
      setQueueExpanded,
      resetState,
      fetchSessionList,
      setSessionIdSync,
      loadSessionData,
      sessionDispatch,
      markSessionRunning,
      chatDispatch,
      blocksRef,
      fullTextRef,
      toolCallsRef,
      connectToStream,
    } = paramsRef.current;

    let cancelled = false;
    const token = ++initTokenRef.current;
    const isStale = () => cancelled || initTokenRef.current !== token;

    const cached = popCachedState(cacheKey);
    const cachedSessionId = cached?.sessionId ?? null;
    const cachedShouldReconnect = cached?.shouldReconnect === true;

    if (cached) {
      setShowConfig(cached.showConfig);
      setShowFolderExplorer(cached.showFolderExplorer);
      setShowRuntimePanel(cached.showRuntimePanel);
      setQueueExpanded(cached.queueExpanded);
    }

    resetState();
    if (cached) {
      setQueueExpanded(cached.queueExpanded);
    }

    if (hasProject && !projectKey) return;
    if (!hasProject && initialSessionId === null && !cachedSessionId) return;

    const fetchRuntimeSnapshot = async (sid: string): Promise<RuntimeSnapshotData> => {
      const res = await fetch(
        `/api/agent-chat/runtime-snapshot?sessionId=${sid}`,
        { cache: 'no-store' },
      );
      return (await res.json()) as RuntimeSnapshotData;
    };

    const reconnectRunning = async (sid: string, snapshotData: RuntimeSnapshotData) => {
      try {
        if (!snapshotData.available) {
          snapshotData = await fetchRuntimeSnapshot(sid);
        }
        if (isStale()) return;
        if (snapshotData.available && Array.isArray(snapshotData.messages) && snapshotData.messages.length > 0) {
          const restored: ChatMessage[] = snapshotData.messages.map((m, i) => ({
            id: `restored-${i}`,
            role: m.role,
            content: m.content,
            images: m.images,
            contentBlocks: m.contentBlocks,
            timestamp: '',
          }));
          chatDispatch({ type: 'SET_MESSAGES', messages: restored });
        }
      } catch {
        // Ignore transient runtime snapshot failures and reconnect the live stream anyway.
      }

      if (isStale()) return;
      markSessionRunning(sid, snapshotData.startedAt);
      chatDispatch({ type: 'SEND_START' });
      blocksRef.current = [];
      fullTextRef.current = '';
      toolCallsRef.current = [];
      connectToStream(sid, 0);
    };

    (async () => {
      const preferredSessionId = initialSessionId ?? cachedSessionId;

      if (preferredSessionId) {
        fetchSessionList(agentId, projectKey).catch(() => []);
        setSessionIdSync(preferredSessionId);
        const [, runtimeSnapshot] = await Promise.all([
          loadSessionData(preferredSessionId, token),
          fetchRuntimeSnapshot(preferredSessionId),
        ]);
        if (isStale()) return;
        try {
          if (runtimeSnapshot.status === 'running' || runtimeSnapshot.status === 'awaiting') {
            if (cachedShouldReconnect || preferredSessionId === initialSessionId) {
              await reconnectRunning(preferredSessionId, runtimeSnapshot);
            } else {
              markSessionRunning(preferredSessionId, runtimeSnapshot.startedAt);
            }
          }
        } catch {
          // Ignore transient bootstrap runtime failures.
        }
        return;
      }

      const sessions = await fetchSessionList(agentId, projectKey);
      if (isStale() || sessions.length === 0) return;

      const latest = sessions[0];
      setSessionIdSync(latest.id);
      sessionDispatch({ type: 'SET_TITLE', title: latest.title });
      const [, runtimeSnapshot] = await Promise.all([
        loadSessionData(latest.id, token),
        fetchRuntimeSnapshot(latest.id),
      ]);
      if (isStale()) return;
      try {
        if (runtimeSnapshot.status === 'running' || runtimeSnapshot.status === 'awaiting') {
          await reconnectRunning(latest.id, runtimeSnapshot);
          return;
        }
      } catch {
        // Ignore transient bootstrap runtime failures.
      }

      for (let i = 1; i < sessions.length; i += 1) {
        if (isStale()) return;
        const sid = sessions[i].id;
        const runtimeSnapshot = await fetchRuntimeSnapshot(sid);
        if (!isStale() && (runtimeSnapshot.status === 'running' || runtimeSnapshot.status === 'awaiting')) {
          setSessionIdSync(sid);
          sessionDispatch({ type: 'SET_TITLE', title: sessions[i].title });
          await loadSessionData(sid, token);
          if (isStale()) return;
          await reconnectRunning(sid, runtimeSnapshot);
          break;
        }
      }
    })();

    return () => {
      cancelled = true;
      if (initTokenRef.current === token) {
        initTokenRef.current += 1;
      }
      if (streamAbortRef.current) {
        streamAbortRef.current.abort();
        streamAbortRef.current = null;
      }
    };
    // 仅依赖「应重新 bootstrap」的结构输入；回调经 paramsRef 取最新，避免 Maximum update depth
  }, [agentId, cacheKey, hasProject, initialSessionId, initTokenRef, projectKey, streamAbortRef]);
}
